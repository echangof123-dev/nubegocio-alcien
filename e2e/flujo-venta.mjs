// Recorrido completo en un navegador real, en tamaño de celular:
// entrar con código → registrar el negocio → abrir caja → poner precios → vender → cobrar → cuadrar la caja.
//
//   BASE=http://localhost:8080 node e2e/flujo-venta.mjs
// Necesita la API en modo desarrollo (el código de acceso aparece en pantalla).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas");
fs.mkdirSync(CAPTURAS, { recursive: true });

const celular = "09" + String(Date.now()).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC" });
pagina.on("pageerror", (e) => errores.push(e.message));
// Un 401 al abrir es normal: la app pregunta si hay sesión antes de mostrar el acceso
pagina.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errores.push(m.text()); });

let n = 0;
const foto = async (nombre) => pagina.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`), fullPage: false });
const esperarTexto = (t) => pagina.getByText(t, { exact: false }).first().waitFor({ timeout: 10_000 });

try {
  // 1. Entrar con código
  await pagina.goto(BASE);
  await esperarTexto("Tu negocio al cien");
  await foto("acceso");
  await pagina.getByLabel("Tu número de celular").fill(celular);
  await pagina.getByRole("button", { name: "Enviar código por WhatsApp" }).click();
  await esperarTexto("Modo de prueba");
  const aviso = await pagina.getByText("Tu código es").innerText();
  const codigo = aviso.match(/\d{6}/)[0];
  await pagina.getByLabel("Código de 6 dígitos").fill(codigo);
  await foto("codigo");
  await pagina.getByRole("button", { name: "Entrar" }).click();

  // 2. ¿Qué negocio tienes?
  await esperarTexto("¿Qué negocio tienes?");
  await pagina.getByLabel("Tipo de negocio").fill("tienda de bario");
  await pagina.getByRole("listitem").filter({ hasText: "Tienda de barrio" }).first().waitFor();
  await foto("registro-tipo");
  await pagina.getByRole("listitem").filter({ hasText: "Tienda de barrio" }).first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Tienda Doña Rosa");
  await foto("registro-nombre");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();

  // 3. Vender: la caja está cerrada
  await esperarTexto("La caja está cerrada");
  await foto("vender-inicio");
  await pagina.getByRole("button", { name: "Abrir caja" }).first().click();
  await pagina.getByLabel("Efectivo inicial").fill("20");
  await pagina.getByRole("button", { name: "Abrir caja" }).click();
  await esperarTexto("Cierre de caja");
  await pagina.getByRole("link", { name: "Vender" }).click();

  // 4. Poner precios y armar la venta
  const tocar = (nombre) => pagina.locator("button.producto").filter({ hasText: nombre }).first().click();
  await tocar("Arroz 1 kg");
  await pagina.getByLabel(/Precio por/).fill("1,35");
  await foto("poner-precio");
  await pagina.getByRole("button", { name: "Guardar y agregar a la venta" }).click();
  await tocar("Leche 1 L");
  await pagina.getByLabel(/Precio por/).fill("1");
  await pagina.getByRole("button", { name: "Guardar y agregar a la venta" }).click();
  await tocar("Leche 1 L");
  await tocar("Queso fresco");
  await pagina.getByLabel(/Precio por/).fill("3");
  await pagina.getByRole("button", { name: "Guardar y agregar a la venta" }).click();
  await pagina.getByLabel(/Cuántas/).fill("0,5");
  await foto("venta-por-peso");
  await pagina.getByRole("button", { name: "Agregar a la venta" }).click();
  await esperarTexto("$ 4,85");
  await foto("vender-carrito");

  // 5. Cobrar en efectivo con $ 5
  await pagina.locator(".barra-cobro").getByRole("button", { name: "Cobrar" }).click();
  await esperarTexto("Total a cobrar");
  await pagina.getByRole("button", { name: "$ 5", exact: true }).click();
  await esperarTexto("Vuelto");
  await foto("cobrar");
  await pagina.getByRole("button", { name: "Cobrar $ 4,85" }).click();
  await esperarTexto("¡Venta registrada!");
  await foto("venta-registrada");
  await pagina.getByRole("button", { name: "Nueva venta" }).click();

  // 6. Cuadrar la caja: 20 + 4,85 = 24,85
  await pagina.getByRole("link", { name: "Caja" }).click();
  await esperarTexto("Efectivo esperado");
  await pagina.getByLabel("Efectivo que contaste").fill("24,85");
  await esperarTexto("¡Caja cuadrada!");
  await foto("cierre-caja");
  await pagina.getByRole("button", { name: "Cerrar caja" }).click();
  await esperarTexto("Vendiste $ 4,85");

  // 7. Reportes del día
  await pagina.getByRole("link", { name: "Reportes" }).click();
  await esperarTexto("Ventas de hoy");
  await foto("reportes");

  // 8. En computador
  await pagina.setViewportSize({ width: 1280, height: 800 });
  await pagina.getByRole("link", { name: "Vender" }).click();
  await esperarTexto("Buscar producto");
  await foto("vender-computador");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido completo sin errores (${n} capturas en e2e/capturas)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
