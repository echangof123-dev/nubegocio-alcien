// Recorrido de la tanda 7: logo, deudas (me deben / debo), combo, jornada del empleado y una venta
// hecha con el internet cortado que se envía sola al volver la señal.
//   BASE=http://localhost:8080 node e2e/flujo-sin-internet.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "sin-internet");
fs.mkdirSync(CAPTURAS, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

const celular = "09" + String(Date.now() + 71).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC", timezoneId: "America/Guayaquil" });
const pagina = await contexto.newPage();
pagina.on("pageerror", (e) => errores.push(e.message));
// Sin red, el navegador registra los fetch fallidos: no son errores de la app
pagina.on("console", (m) => { if (m.type() === "error" && !/status of 40[149]|Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errores.push(m.text()); });

let n = 0;
const foto = async (nombre, p = pagina) => p.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`), fullPage: true });
const esperarTexto = (t, p = pagina, timeout = 10_000) => p.getByText(t, { exact: false }).first().waitFor({ timeout });
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
  await pagina.getByLabel("Tipo de negocio").fill("cafeteria");
  await pagina.getByRole("listitem").first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Café Sin Señal");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await pagina.getByRole("link", { name: "Más" }).waitFor();
  await api("POST", "/caja/abrir", { monto: 20 });
  const cafe = (await api("POST", "/productos", { nombre: "Café pasado", precio: 1, costo: 0.3, stock_inicial: 30 })).datos.producto.id;
  await api("POST", "/productos", { nombre: "Humita", precio: 1.25, costo: 0.5, stock_inicial: 30 });
  await api("POST", "/productos", { nombre: "Combo mañanero", precio: 2, maneja_stock: false });
  await pagina.reload();

  // Logo
  const png = path.join(os.tmpdir(), "logo-alcien.png");
  fs.writeFileSync(png, PNG);
  await pagina.goto(BASE + "/ajustes");
  await pagina.locator("#aj-logo").setInputFiles(png);
  await esperarTexto("Logo guardado");
  await pagina.getByRole("img", { name: "Logo del negocio" }).waitFor();

  // Combo: café + humita
  await pagina.getByRole("link", { name: /Productos|Platos/ }).click();
  await pagina.getByRole("button", { name: /Combo mañanero/ }).click();
  await pagina.getByRole("button", { name: "Es un combo (armado con otros productos)" }).click();
  for (const nombre of ["Café pasado", "Humita"]) {
    await pagina.getByRole("button", { name: "Agregar producto al combo" }).click();
    await pagina.locator("#sel-prod").fill(nombre);
    await pagina.getByRole("dialog").last().getByRole("button", { name: new RegExp(nombre) }).click();
  }
  await esperarTexto("Por separado cuestan $ 2,25");
  await foto("combo");
  await pagina.getByRole("button", { name: "Guardar combo" }).click();
  await pagina.keyboard.press("Escape");

  // Deudas: me deben y debo
  await pagina.goto(BASE + "/deudas");
  await pagina.getByRole("button", { name: "Nueva deuda" }).click();
  await pagina.getByRole("button", { name: /Elegir cliente/ }).click();
  await pagina.getByRole("button", { name: "Nuevo cliente" }).click();
  await pagina.getByLabel("Nombre", { exact: true }).fill("Doña Carmen");
  await pagina.getByRole("button", { name: "Guardar cliente" }).click();
  await pagina.getByLabel("Valor de la deuda").fill("15");
  await pagina.getByLabel("Concepto").fill("Desayunos de la semana");
  await pagina.getByRole("button", { name: "Anotar deuda" }).click();
  await esperarTexto("Doña Carmen te debe $ 15,00");
  await pagina.getByRole("button", { name: "Nueva deuda" }).click();
  await pagina.getByRole("button", { name: "Yo debo" }).click();
  await pagina.getByLabel("Proveedor").selectOption("nuevo");
  await pagina.getByLabel("Nombre del proveedor").fill("Lácteos del Valle");
  await pagina.getByLabel("Valor de la deuda").fill("60");
  await pagina.getByLabel("Concepto").fill("Leche y queso");
  await pagina.getByRole("button", { name: "Anotar deuda" }).click();
  await esperarTexto("Lácteos del Valle");
  await pagina.getByRole("button", { name: "Pagar", exact: true }).click();
  await pagina.getByLabel("Monto a pagar").fill("20");
  await pagina.getByRole("button", { name: "Transferencia" }).click();
  await pagina.getByRole("button", { name: "Pagar $ 20,00" }).click();
  await esperarTexto("Queda $ 40,00");
  await foto("deudas");

  // Jornada
  await pagina.goto(BASE + "/equipo");
  await pagina.getByRole("button", { name: "Marcar entrada" }).click();
  await esperarTexto("Entrada marcada");
  await esperarTexto("trabajando");
  await foto("jornada");

  // Venta sin internet
  await pagina.getByRole("link", { name: "Vender" }).click();
  await pagina.locator("button.producto").filter({ hasText: "Combo mañanero" }).waitFor();
  await contexto.setOffline(true);
  await pagina.locator("button.producto").filter({ hasText: "Combo mañanero" }).click();
  await pagina.locator(".barra-cobro").getByRole("button", { name: "Cobrar" }).click();
  await pagina.getByRole("button", { name: /Cobrar \$ 2,00/ }).click();
  await esperarTexto("Guardada sin internet");
  await esperarTexto("1 venta por enviar");
  await foto("venta-sin-internet");
  await contexto.setOffline(false);
  await esperarTexto("Se envió 1 venta hecha sin internet", pagina, 20_000);
  const bal = await api("GET", "/balance");
  if (Number(bal.datos.balance.ingresos) !== 2) throw new Error("La venta sin internet no llegó: " + JSON.stringify(bal.datos.balance));
  const stock = await api("GET", `/productos/${cafe}/movimientos`);
  if (!stock.datos.movimientos.some((m) => m.tipo === "venta")) throw new Error("El combo no descontó el café");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido sin internet, deudas y combos sin errores (${n} capturas en e2e/capturas/sin-internet)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
