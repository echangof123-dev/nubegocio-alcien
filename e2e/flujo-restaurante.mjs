// Recorrido de un restaurante en el navegador: mesas, comanda, cocina, cobro dividido,
// recetas y un pedido a domicilio.
//   BASE=http://localhost:8080 node e2e/flujo-restaurante.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "restaurante");
fs.mkdirSync(CAPTURAS, { recursive: true });

const celular = "09" + String(Date.now() + 7).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC" });
pagina.on("pageerror", (e) => errores.push(e.message));
pagina.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errores.push(m.text()); });

let n = 0;
const foto = async (nombre) => pagina.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`) });
const esperarTexto = (t) => pagina.getByText(t, { exact: false }).first().waitFor({ timeout: 10_000 });
const api = (metodo, ruta, cuerpo) => pagina.evaluate(async ([metodo, ruta, cuerpo]) => {
  const r = await fetch("/api" + ruta, {
    method: metodo, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-negocio": localStorage.getItem("alcien.negocio") ?? "" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}, [metodo, ruta, cuerpo]);

try {
  // Entrar y crear el restaurante
  await pagina.goto(BASE);
  await pagina.getByLabel("Tu número de celular").fill(celular);
  await pagina.getByRole("button", { name: "Enviar código por WhatsApp" }).click();
  await esperarTexto("Modo de prueba");
  const codigo = (await pagina.getByText("Tu código es").innerText()).match(/\d{6}/)[0];
  await pagina.getByLabel("Código de 6 dígitos").fill(codigo);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  await esperarTexto("¿Qué negocio tienes?");
  await pagina.getByLabel("Tipo de negocio").fill("restaurante");
  await pagina.getByRole("listitem").filter({ hasText: "Restaurante" }).first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Sabor Manabita");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await esperarTexto("La caja está cerrada");

  // Menú e insumos (por la API, para ir rápido)
  for (const p of [
    { nombre: "Seco de pollo", unidad: "Plato", precio: 4.5 },
    { nombre: "Encebollado", unidad: "Plato", precio: 3.5 },
    { nombre: "Jugo natural", unidad: "Vaso", precio: 1.25, maneja_stock: false },
    { nombre: "Pollo", unidad: "Kilo", costo: 3.8, tipo: "insumo", stock_inicial: 8 },
    { nombre: "Arroz", unidad: "Kilo", costo: 1.1, tipo: "insumo", stock_inicial: 20 },
  ]) {
    const r = await api("POST", "/productos", p);
    if (r.status !== 201) throw new Error(`producto ${p.nombre}: ${JSON.stringify(r.datos)}`);
  }
  await api("POST", "/caja/abrir", { monto: 30 });
  await pagina.reload();

  // Más → Recetas
  await pagina.getByRole("link", { name: "Más" }).click();
  await esperarTexto("Mesas");
  await foto("mas-restaurante");
  await pagina.getByRole("button", { name: /^Recetas/ }).click();
  await pagina.getByRole("button", { name: /Seco de pollo/ }).click();
  await pagina.getByRole("button", { name: "Agregar insumo" }).click();
  await pagina.getByRole("button", { name: /Pollo/ }).click();
  await pagina.getByLabel(/Pollo \(kilo\)/).fill("0,25");
  await pagina.getByRole("button", { name: "Agregar insumo" }).click();
  await pagina.getByRole("button", { name: /Arroz/ }).click();
  await pagina.getByLabel(/Arroz \(kilo\)/).fill("0,2");
  await esperarTexto("ganas");
  await foto("receta");
  await pagina.getByRole("button", { name: "Guardar receta" }).click();
  await esperarTexto("Receta guardada");

  // Mesas
  await pagina.getByRole("link", { name: "Más" }).click();
  await pagina.getByRole("button", { name: /^Mesas/ }).click();
  await pagina.getByRole("button", { name: "Agregar mesas" }).click();
  await pagina.getByLabel("¿Cuántas?").fill("8");
  await pagina.getByLabel("Zona (opcional)").fill("Salón");
  await pagina.getByRole("button", { name: /Agregar 8 mesas/ }).click();
  await esperarTexto("0 de 8 ocupadas");
  await pagina.getByRole("button", { name: /^Mesa 3, libre/ }).click();
  await esperarTexto("Mesa 3");
  const agregar = async (producto, cantidad, nota) => {
    await pagina.getByRole("button", { name: "Agregar", exact: true }).click();
    await pagina.getByRole("button", { name: new RegExp(producto) }).click();
    await pagina.getByRole("button", { name: cantidad, exact: true }).click();
    if (nota) await pagina.getByLabel(/Nota para cocina/).fill(nota);
    await pagina.getByRole("button", { name: /^Agregar \$/ }).click();
    await esperarTexto(producto);
  };
  await agregar("Seco de pollo", "2", "uno sin maduro");
  await agregar("Jugo natural", "2");
  await foto("cuenta-mesa");
  await pagina.getByRole("button", { name: /Enviar a cocina/ }).click();
  await esperarTexto("En cocina");

  // Cocina
  await pagina.goto(BASE + "/cocina");
  await esperarTexto("Mesa 3");
  await foto("cocina");
  await pagina.getByRole("button", { name: "Listo" }).first().click();
  await esperarTexto("Servido");

  // Volver a la mesa y dividir la cuenta
  await pagina.goto(BASE + "/mesas");
  await esperarTexto("1 de 8 ocupadas");
  await foto("mesas");
  await pagina.getByRole("button", { name: /^Mesa 3, ocupada/ }).click();
  await pagina.getByRole("button", { name: "Dividir" }).click();
  await pagina.getByLabel("Cobrar Jugo natural").check();
  await pagina.getByRole("button", { name: "Cobrar $ 2,50" }).click();
  await pagina.getByRole("button", { name: "Transferencia" }).click();
  await pagina.getByRole("dialog").getByRole("button", { name: "Cobrar $ 2,50" }).click();
  await esperarTexto("registrada");
  await pagina.getByRole("button", { name: "Cobrar $ 9,00" }).click();
  await pagina.getByLabel("Recibido (opcional)").fill("10");
  await esperarTexto("Vuelto");
  await foto("cobrar-mesa");
  await pagina.getByRole("dialog").getByRole("button", { name: "Cobrar $ 9,00" }).click();
  await esperarTexto("0 de 8 ocupadas");

  // Pedido a domicilio
  await pagina.goto(BASE + "/pedidos");
  await pagina.getByRole("button", { name: "Nuevo pedido" }).click();
  await pagina.getByRole("button", { name: "A domicilio" }).click();
  await pagina.getByLabel("Nombre").fill("Ana Zambrano");
  await pagina.getByLabel("Celular").fill("0991112233");
  await pagina.getByLabel("Dirección").fill("Av. 4 de Noviembre y calle 12");
  await pagina.getByLabel("Costo del envío").fill("1,50");
  await pagina.getByRole("button", { name: "Agregar producto" }).click();
  await pagina.getByRole("button", { name: /Encebollado/ }).click();
  await foto("pedido-nuevo");
  await pagina.getByRole("button", { name: /Guardar pedido de \$ 5,00/ }).click();
  await esperarTexto("Pedido N.º 1 recibido");
  await pagina.getByRole("button", { name: "Preparando" }).click();
  await esperarTexto("Listo");
  await foto("pedidos");

  // Los insumos bajaron: 2 secos × 0,25 kg de pollo
  const pollo = (await api("GET", "/productos?tipo=insumo")).datos.productos.find((p) => p.nombre === "Pollo");
  if (pollo.stock !== 7.5) throw new Error(`el pollo debía quedar en 7,5 y quedó en ${pollo.stock}`);

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido del restaurante sin errores (${n} capturas en e2e/capturas/restaurante)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
