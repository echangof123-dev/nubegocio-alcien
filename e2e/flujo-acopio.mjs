// Recorrido de un centro de acopio de cacao: precio del día, productor nuevo, pesaje con humedad,
// liquidación impresa, reportes por periodo con descarga para Excel y cambio de rol en el equipo.
//   BASE=http://localhost:8080 node e2e/flujo-acopio.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "acopio");
fs.mkdirSync(CAPTURAS, { recursive: true });

const celular = "09" + String(Date.now() + 41).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC", timezoneId: "America/Guayaquil", acceptDownloads: true });
const pagina = await contexto.newPage();
pagina.on("pageerror", (e) => errores.push(e.message));
pagina.on("console", (m) => { if (m.type() === "error" && !/status of 40[149]/.test(m.text())) errores.push(m.text()); });

let n = 0;
const foto = async (nombre, p = pagina) => p.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`), fullPage: true });
const esperarTexto = (t, p = pagina) => p.getByText(t, { exact: false }).first().waitFor({ timeout: 10_000 });
const api = (metodo, ruta, cuerpo) => pagina.evaluate(async ([metodo, ruta, cuerpo]) => {
  const r = await fetch("/api" + ruta, {
    method: metodo, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-negocio": localStorage.getItem("alcien.negocio") ?? "" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}, [metodo, ruta, cuerpo]);

try {
  await pagina.goto(BASE);
  await pagina.getByLabel("Tu número de celular").fill(celular);
  await pagina.getByRole("button", { name: "Enviar código por WhatsApp" }).click();
  await esperarTexto("Modo de prueba");
  const codigo = (await pagina.getByText("Tu código es").innerText()).match(/\d{6}/)[0];
  await pagina.getByLabel("Código de 6 dígitos").fill(codigo);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  await pagina.getByLabel("Tipo de negocio").fill("acopio de cacao");
  await pagina.getByRole("listitem").filter({ hasText: "Centro de acopio de cacao" }).first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Acopio El Guabo");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await esperarTexto("La caja está cerrada");

  const cacao = await api("POST", "/productos", { nombre: "Cacao CCN51 seco", unidad: "Quintal", precio: 140 });
  if (cacao.status !== 201) throw new Error(JSON.stringify(cacao.datos));
  const saco = await api("POST", "/productos", { nombre: "Saco de yute", precio: 1.5, costo: 0.6, stock_inicial: 100 });
  const m = await api("POST", "/negocio/modulos/M25", { activo: true });
  if (m.status !== 200) throw new Error(JSON.stringify(m.datos));
  await api("POST", "/caja/abrir", { monto: 3000 });
  await api("POST", "/ventas", { items: [{ producto_id: saco.datos.producto.id, cantidad: 20 }], pagos: [{ metodo: "efectivo", monto: 30 }] });
  await pagina.reload();

  // Precio del día
  await pagina.getByRole("link", { name: "Más" }).click();
  await pagina.getByRole("button", { name: /Acopio/ }).click();
  await pagina.getByRole("button", { name: "Poner precios" }).click();
  await pagina.getByRole("button", { name: "Agregar producto que compras" }).click();
  await pagina.getByLabel("Buscar", { exact: true }).fill("CCN51");
  await pagina.getByRole("button", { name: /Cacao CCN51 seco/ }).click();
  await pagina.getByLabel(/Precio del día/).fill("120");
  await pagina.getByLabel(/Humedad de referencia/).fill("7");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await esperarTexto("$ 120,00 / quintal");
  await foto("precios");

  // Pesaje: 10 qq, 0,5 de tara, 9 % de humedad
  await pagina.getByRole("tab", { name: "Comprar" }).click();
  await pagina.getByRole("button", { name: /Elegir productor/ }).click();
  await pagina.getByRole("button", { name: "Nuevo productor" }).click();
  await pagina.getByLabel("Nombre completo").fill("Rosa Aguilar");
  await pagina.getByLabel("Cédula").fill("0926687856");
  await pagina.getByRole("button", { name: "Guardar productor" }).click();
  await pagina.getByLabel(/Peso bruto/).fill("10");
  await pagina.getByLabel(/Tara/).fill("0,5");
  await pagina.getByLabel(/Humedad %/).fill("9");
  await esperarTexto("9,296 quintal");
  await esperarTexto("$ 1.115,52");
  await foto("pesaje");
  await pagina.getByRole("button", { name: /Pagar \$ 1\.115,52/ }).click();
  await esperarTexto("Rosa Aguilar");
  await esperarTexto("Pagada");
  await foto("liquidaciones");

  // Liquidación para imprimir
  const [liq] = await Promise.all([contexto.waitForEvent("page"), pagina.getByRole("button", { name: "Ver liquidación" }).click()]);
  await esperarTexto("Liquidación de compra N.º 1", liq);
  await esperarTexto("Recibí conforme", liq);
  await foto("liquidacion", liq);
  await liq.close();

  // Reportes por periodo
  await pagina.getByRole("link", { name: "Reportes" }).click();
  await pagina.getByRole("button", { name: "Ver reportes por periodo" }).click();
  await esperarTexto("Utilidad bruta");
  await esperarTexto("Saco de yute");
  await esperarTexto("$ 1.115,52");   // compras del periodo
  await foto("estadisticas");
  const [descarga] = await Promise.all([pagina.waitForEvent("download"), pagina.getByRole("button", { name: "Descargar ventas para Excel" }).click()]);
  const csv = fs.readFileSync(await descarga.path(), "utf8");
  if (!csv.includes("Saco de yute;20")) throw new Error("El CSV no trae la venta:\n" + csv.slice(0, 300));

  // Equipo: agregar bodeguero y volverlo cajero
  await pagina.goto(BASE + "/equipo");
  await pagina.getByRole("button", { name: "Agregar persona" }).click();
  await pagina.getByLabel("Nombre").fill("Kevin");
  await pagina.getByLabel("Celular").fill("09" + String(Date.now() + 43).slice(-8));
  await pagina.getByRole("button", { name: /Bodeguero/ }).click();
  await pagina.getByRole("button", { name: "Agregar", exact: true }).click();
  await esperarTexto("Kevin");
  await pagina.getByRole("button", { name: "Cambiar" }).click();
  await pagina.getByRole("button", { name: /^Cajero/ }).click();
  await esperarTexto("Ahora es cajero");
  await foto("equipo");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido del centro de acopio sin errores (${n} capturas en e2e/capturas/acopio)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
