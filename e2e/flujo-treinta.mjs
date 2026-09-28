// Recorrido "como Treinta": balance, gasto, venta libre con recibo, carga de productos desde un Excel
// real (.xlsx), foto de producto, clientes con notas y ajustes del recibo.
//   BASE=http://localhost:8080 node e2e/flujo-treinta.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "treinta");
fs.mkdirSync(CAPTURAS, { recursive: true });

/** Un .xlsx mínimo de verdad (ZIP con deflate), como lo guarda Excel, con textos compartidos. */
function crearXlsx(filas) {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const textos = [];
  const idx = (t) => { let i = textos.indexOf(t); if (i < 0) { i = textos.length; textos.push(t); } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const hoja = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => v === "" ? "" : typeof v === "number"
      ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const archivos = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": hoja,
  };
  archivos["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos.map((t) => `<si><t>${esc(t)}</t></si>`).join("")}</sst>`;
  const locales = [], centrales = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, "utf8");
    const comp = zlib.deflateRawSync(datos);
    const n = Buffer.from(nombre, "utf8");
    const crc = zlib.crc32(datos);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    locales.push(loc, n, comp);
    centrales.push(cen, n);
    offset += 30 + n.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dir, fin]);
}
// PNG de 2×2 (rojo) para la foto
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

const celular = "09" + String(Date.now() + 57).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC", timezoneId: "America/Guayaquil" });
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
  await pagina.getByLabel("Tipo de negocio").fill("bazar");
  await pagina.getByRole("listitem").first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Bazar Lupita");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await esperarTexto("La caja está cerrada");
  await api("POST", "/caja/abrir", { monto: 20 });
  await pagina.reload();

  // Ajustes: datos del recibo
  await pagina.goto(BASE + "/ajustes");
  await pagina.getByLabel("Dirección").fill("Av. Quito y Colón, Guayaquil");
  await pagina.getByLabel("Mensaje al final del recibo").fill("¡Vuelve pronto, vecino!");
  await pagina.getByRole("button", { name: "Guardar ajustes" }).click();
  await esperarTexto("Ajustes guardados");

  // Balance: gasto y venta libre
  await pagina.getByRole("link", { name: "Balance" }).click();
  await esperarTexto("Ingresos");
  await pagina.getByRole("button", { name: "Nuevo gasto" }).click();
  await pagina.getByLabel("Valor del gasto").fill("12,50");
  await pagina.getByRole("button", { name: "Servicios públicos" }).click();
  await pagina.getByLabel("Descripción (opcional)").fill("Luz");
  await foto("nuevo-gasto");
  await pagina.getByRole("button", { name: /Registrar gasto de \$ 12,50/ }).click();
  await esperarTexto("Gasto registrado");
  await esperarTexto("− $ 12,50");
  await pagina.getByRole("button", { name: "Venta libre (sin productos)" }).click();
  await pagina.getByLabel("Valor de la venta").fill("8");
  await pagina.getByLabel("Concepto (opcional)").fill("Copias e impresiones");
  await pagina.getByRole("button", { name: "Cobrar $ 8,00" }).click();
  await pagina.getByRole("button", { name: "Cobrar $ 8,00" }).click();
  await esperarTexto("Venta registrada");
  const [recibo] = await Promise.all([contexto.waitForEvent("page"), pagina.getByRole("button", { name: "Imprimir" }).first().click()]);
  await esperarTexto("Copias e impresiones", recibo);
  await esperarTexto("Av. Quito y Colón", recibo);
  await esperarTexto("¡Vuelve pronto, vecino!", recibo);
  await foto("recibo", recibo);
  await recibo.close();
  await pagina.getByRole("button", { name: "Listo" }).click();
  await esperarTexto("+ $ 8,00");
  await foto("balance");

  // Inventario: carga desde un Excel real
  const xlsx = path.join(os.tmpdir(), "productos-alcien.xlsx");
  fs.writeFileSync(xlsx, crearXlsx([
    ["Lista de precios del bazar"],
    ["Nombre", "Categoría", "Precio de venta", "Costo", "Stock", "Stock mínimo", "Color"],
    ["Cuaderno 100 hojas", "Útiles", 1.5, 0.9, 20, 5, "azul"],
    ["Esfero azul", "Útiles", 0.4, 0.15, 3, 10, ""],
    ["Pega blanca", "Útiles", "1,20", "0,70", 8, "", ""],
  ]));
  await pagina.goto(BASE + "/inventario");
  await pagina.getByRole("button", { name: "Cargar desde Excel" }).click();
  await pagina.locator("#excel-archivo").setInputFiles(xlsx);
  await esperarTexto("productos-alcien.xlsx: 3 productos");
  await esperarTexto("No se usan: Color");
  await foto("excel");
  await pagina.getByRole("button", { name: "Cargar 3 productos" }).click();
  await esperarTexto("3 productos nuevos");
  await pagina.getByRole("button", { name: "Listo" }).click();
  await esperarTexto("Esfero azul");            // por acabarse: 3 de mínimo 10
  await foto("inventario");
  await pagina.getByRole("button", { name: /Esfero azul/ }).click();
  await esperarTexto("Stock inicial");
  await pagina.keyboard.press("Escape");

  // Foto del producto
  const png = path.join(os.tmpdir(), "foto-alcien.png");
  fs.writeFileSync(png, PNG);
  await pagina.getByRole("link", { name: "Productos" }).click();
  await pagina.getByRole("button", { name: /Cuaderno 100 hojas/ }).click();
  await pagina.locator("input[type=file]").setInputFiles(png);
  await pagina.getByRole("img", { name: "Foto del producto" }).waitFor();
  await pagina.keyboard.press("Escape");
  await pagina.getByRole("link", { name: "Vender" }).click();
  await pagina.locator("button.producto img.foto").first().waitFor();
  await foto("vender-con-foto");

  // Clientes: notas y compras
  await pagina.goto(BASE + "/clientes");
  await pagina.getByRole("button", { name: "Nuevo cliente" }).click();
  await pagina.getByRole("button", { name: "Nuevo cliente" }).last().click();
  await pagina.getByLabel("Nombre", { exact: true }).fill("Vecina Marta");
  await pagina.getByRole("button", { name: "Guardar cliente" }).click();
  await esperarTexto("Cliente guardado");
  await pagina.getByRole("button", { name: /Vecina Marta/ }).click();
  await pagina.getByRole("button", { name: "Editar datos" }).click();
  await pagina.getByLabel("Notas y preferencias").fill("Compra útiles para 3 hijos");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await esperarTexto("Compra útiles para 3 hijos");
  await foto("cliente");

  // Asistente: pregunta y registra una venta escribiendo
  await pagina.goto(BASE + "/asistente");
  await pagina.getByLabel("Escribe tu pregunta").fill("vendí 2 cuadernos y un esfero en efectivo");
  await pagina.getByRole("button", { name: "Enviar" }).click();
  await esperarTexto("¿Registro esta venta en efectivo?");
  await pagina.getByRole("button", { name: "Registrar venta de $ 3,40" }).click();
  await esperarTexto("Listo: venta N.º 2");
  await pagina.getByRole("button", { name: "¿Cuánto vendí hoy?" }).last().click().catch(async () => {
    await pagina.getByLabel("Escribe tu pregunta").fill("¿Cuánto vendí hoy?");
    await pagina.getByRole("button", { name: "Enviar" }).click();
  });
  await esperarTexto("Hoy vendiste $ 11,40 en 2 ventas");
  await foto("asistente");

  // Permisos: el cajero puede anular ventas
  await pagina.goto(BASE + "/equipo");
  await pagina.getByRole("button", { name: "Agregar persona" }).click();
  await pagina.getByLabel("Nombre").fill("Cajero Luis");
  await pagina.getByLabel("Celular").fill("09" + String(Date.now() + 61).slice(-8));
  await pagina.getByRole("button", { name: "Agregar", exact: true }).click();
  await esperarTexto("Cajero Luis");
  await pagina.getByRole("button", { name: "Cambiar" }).click();
  await pagina.getByLabel(/Anular ventas/).check();
  await esperarTexto("1 permisos extra");
  await foto("permisos");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido como Treinta sin errores (${n} capturas en e2e/capturas/treinta)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
