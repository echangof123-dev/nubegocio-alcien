/**
 * Lee la primera hoja de un .xlsx (o un .csv) en el navegador, sin librerías: el .xlsx es un ZIP con
 * XML adentro; se descomprime con DecompressionStream("deflate-raw").
 */

export type Fila = Record<string, string>;

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const escritor = ds.writable.getWriter();
  void escritor.write(datos as Uint8Array<ArrayBuffer>);
  void escritor.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function leerZip(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const v = new DataView(buf);
  let fin = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx) válido");
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const archivos = new Map<string, () => Promise<string>>();
  const dec = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("El archivo Excel está dañado");
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(buf, p + 46, largoNombre));
    archivos.set(nombre, async () => {
      const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const datos = new Uint8Array(buf, inicio, comprimido);
      return dec.decode(metodo === 8 ? await inflar(datos) : datos);
    });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

const columna = (ref: string) => {
  const letras = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function leerXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const zip = await leerZip(buf);
  const xml = (t: string) => new DOMParser().parseFromString(t, "application/xml");
  const compartidas: string[] = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) {
    for (const si of Array.from(xml(await ss()).getElementsByTagName("si"))) {
      compartidas.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    }
  }
  // La primera hoja según el libro; si no, la primera que aparezca
  let ruta = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.slice(19)) - parseInt(b.slice(19)))[0];
  const wb = zip.get("xl/workbook.xml"), rels = zip.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const hoja = xml(await wb()).getElementsByTagName("sheet")[0];
    const rid = hoja?.getAttribute("r:id") ?? hoja?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = Array.from(xml(await rels()).getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    const destino = rel?.getAttribute("Target");
    if (destino) ruta = destino.startsWith("/") ? destino.slice(1) : "xl/" + destino.replace(/^\.\//, "");
  }
  const hoja = ruta ? zip.get(ruta) : undefined;
  if (!hoja) throw new Error("El Excel no tiene hojas");
  const filas: string[][] = [];
  for (const fila of Array.from(xml(await hoja()).getElementsByTagName("row"))) {
    const valores: string[] = [];
    for (const c of Array.from(fila.getElementsByTagName("c"))) {
      const t = c.getAttribute("t");
      const vEl = c.getElementsByTagName("v")[0];
      let valor = "";
      if (t === "s") valor = compartidas[Number(vEl?.textContent)] ?? "";
      else if (t === "inlineStr") valor = Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("");
      else if (t === "b") valor = vEl?.textContent === "1" ? "VERDADERO" : "FALSO";
      else valor = vEl?.textContent ?? "";
      const ref = c.getAttribute("r");
      valores[ref ? columna(ref) : valores.length] = valor;
    }
    filas.push(Array.from(valores, (x) => (x ?? "").trim()));
  }
  return filas;
}

function leerCsv(texto: string): string[][] {
  texto = texto.replace(/^﻿/, "");
  const primera = texto.split(/\r?\n/)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [], celda = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda.trim()); celda = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda.trim()); filas.push(fila); fila = []; celda = "";
    } else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda.trim()); filas.push(fila); }
  return filas;
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const COLUMNAS: [string, RegExp][] = [
  ["codigo_barras", /^(codigo( de)?( barras)?|cod barras|ean|sku)$/],
  ["stock_minimo", /^(stock min(imo)?|minimo|cantidad minima|alerta)$/],
  ["nombre", /^(nombre|producto|nombre del producto|descripcion|articulo)$/],
  ["categoria", /^(categoria|grupo|linea|familia)$/],
  ["unidad", /^(unidad|unidad de medida|medida)$/],
  ["precio", /^(precio|precio de venta|precio venta|pvp|valor|precio unitario)$/],
  ["costo", /^(costo|costo unitario|precio de compra|precio compra|costo de compra)$/],
  ["stock", /^(stock|cantidad|existencias|existencia|inventario|unidades)$/],
];

/** Productos del archivo, con los encabezados reconocidos. Devuelve también los que no se reconocieron. */
export async function leerProductos(archivo: File): Promise<{ filas: Fila[]; columnas: string[]; ignoradas: string[] }> {
  const esCsv = /\.(csv|txt)$/i.test(archivo.name) || archivo.type === "text/csv";
  const tabla = esCsv ? leerCsv(await archivo.text()) : await leerXlsx(await archivo.arrayBuffer());
  const inicio = tabla.findIndex((f) => f.some((c) => COLUMNAS.some(([k, re]) => k === "nombre" && re.test(normalizar(c)))));
  if (inicio < 0) throw new Error("No encontramos la columna «Nombre». Usa la plantilla.");
  const encabezados = tabla[inicio]!.map((c) => COLUMNAS.find(([, re]) => re.test(normalizar(c)))?.[0] ?? null);
  const filas: Fila[] = [];
  for (const f of tabla.slice(inicio + 1)) {
    if (!f.some((c) => c)) continue;
    const fila: Fila = {};
    encabezados.forEach((k, i) => { if (k && f[i]) fila[k] = f[i]!; });
    if (Object.keys(fila).length) filas.push(fila);
  }
  return {
    filas,
    columnas: [...new Set(encabezados.filter((x): x is string => !!x))],
    ignoradas: tabla[inicio]!.filter((_, i) => !encabezados[i]).filter(Boolean),
  };
}

/** Plantilla para llenar en Excel (CSV con punto y coma, que Excel abre directo). */
export function descargarPlantilla() {
  const csv = "﻿Nombre;Categoría;Unidad;Precio de venta;Costo;Stock;Stock mínimo;Código de barras\r\n" +
    "Arroz 1 kg;Granos;Unidad;1,35;1,05;40;10;7861234567890\r\nAceite 1 litro;Aceites;Unidad;2,90;2,30;12;5;\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-productos-al-cien.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
