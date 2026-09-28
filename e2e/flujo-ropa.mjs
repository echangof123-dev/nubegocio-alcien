// Recorrido de una tienda de ropa: variantes, lista de precios mayorista y catálogo en línea
// con un pedido hecho por un cliente sin cuenta.
//   BASE=http://localhost:8080 node e2e/flujo-ropa.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "ropa");
fs.mkdirSync(CAPTURAS, { recursive: true });

const celular = "09" + String(Date.now() + 13).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC" });
const pagina = await contexto.newPage();
const vigilar = (p) => {
  p.on("pageerror", (e) => errores.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/status of 40[14]/.test(m.text())) errores.push(m.text()); });
};
vigilar(pagina);

let n = 0;
const foto = async (nombre, p = pagina) => p.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`) });
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
  await pagina.getByLabel("Tipo de negocio").fill("tienda de ropa");
  await pagina.getByRole("listitem").filter({ hasText: "Tienda de ropa" }).first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Moda Andina");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await esperarTexto("La caja está cerrada");

  const r = await api("POST", "/productos", { nombre: "Jean clásico", precio: 25, costo: 12 });
  if (r.status !== 201) throw new Error(JSON.stringify(r.datos));
  for (const m of ["M17", "M18", "M10"]) await api("POST", `/negocio/modulos/${m}`, { activo: true });
  await api("POST", "/caja/abrir", { monto: 50 });
  await pagina.reload();

  // Variantes desde Productos
  await pagina.getByRole("link", { name: "Productos" }).click();
  await pagina.getByRole("button", { name: /Jean clásico/ }).click();
  await pagina.getByRole("button", { name: "Tiene tallas, colores u opciones" }).click();
  await pagina.getByLabel(/Tallas/).fill("28, 30, 32");
  await pagina.getByLabel(/Colores/).fill("Azul, Negro");
  await pagina.getByLabel(/Stock de cada una/).fill("4");
  await foto("variantes");
  await pagina.getByRole("button", { name: "Crear 6 variantes" }).click();
  await esperarTexto("6 variantes");

  // Vender una variante
  await pagina.getByRole("link", { name: "Vender" }).click();
  await pagina.locator("button.producto").filter({ hasText: "Jean clásico" }).click();
  await esperarTexto("30 · Negro");
  await foto("elegir-variante");
  await pagina.getByRole("button", { name: /30 · Negro/ }).click();
  await pagina.locator("button.producto").filter({ hasText: "Jean clásico" }).click();
  await pagina.getByRole("button", { name: /32 · Azul/ }).click();
  await esperarTexto("$ 50,00");

  // Lista mayorista
  await pagina.getByRole("link", { name: "Más" }).click();
  await pagina.getByRole("button", { name: /Listas de precios/ }).click();
  await pagina.getByRole("button", { name: "Nueva lista" }).click();
  await pagina.getByLabel(/Descuento general/).fill("10");
  await pagina.getByRole("button", { name: "Crear lista" }).click();
  await esperarTexto("10 % menos");
  await pagina.getByRole("link", { name: "Vender" }).click();
  await pagina.locator(".barra-cobro").getByRole("button", { name: "Cobrar" }).click();
  await pagina.getByRole("button", { name: "Mayorista" }).click();
  await esperarTexto("Cobrar $ 45,00");
  await foto("cobrar-mayorista");
  await pagina.getByRole("button", { name: "Cobrar $ 45,00" }).click();
  await esperarTexto("¡Venta registrada!");

  // Catálogo en línea
  await pagina.goto(BASE + "/catalogo");
  await pagina.getByLabel(/WhatsApp donde recibes/).fill("0991112233");
  await pagina.getByRole("button", { name: "Publicar catálogo" }).click();
  await esperarTexto("/t/moda-andina");
  await foto("catalogo-config");

  // Un cliente sin cuenta abre el catálogo y pide
  const cliente = await (await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC" })).newPage();
  vigilar(cliente);
  await cliente.goto(BASE + "/t/moda-andina");
  await esperarTexto("Moda Andina", cliente);
  await foto("catalogo-cliente", cliente);
  await cliente.locator("button.producto").filter({ hasText: "Jean clásico" }).click();
  await cliente.getByRole("button", { name: /28 · Azul/ }).click();
  await cliente.getByRole("button", { name: "Listo" }).click();
  await cliente.getByRole("button", { name: "Hacer pedido" }).click();
  await cliente.getByLabel("Tu nombre").fill("Lucía Pérez");
  await cliente.getByLabel("Tu celular").fill("0998887766");
  await foto("catalogo-pedido", cliente);
  await cliente.getByRole("button", { name: /Pedir \$ 25,00/ }).click();
  await esperarTexto("Recibimos tu pedido N.º 1", cliente);
  await foto("catalogo-gracias", cliente);

  // Le llega al negocio en Pedidos
  await pagina.goto(BASE + "/pedidos");
  await esperarTexto("Lucía Pérez");
  await foto("pedido-desde-catalogo");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido de la tienda de ropa sin errores (${n} capturas en e2e/capturas/ropa)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
