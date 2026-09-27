/**
 * Generador de XML que produce directamente la forma canónica (C14N 1.0) que exige la firma:
 * sin espacios entre etiquetas, atributos ordenados, elementos vacíos como <a></a> y los
 * escapes exactos de C14N. Así el digest se calcula sobre el mismo texto que se envía.
 */

export interface Elemento {
  nombre: string;
  atributos: Record<string, string>;
  hijos: (Elemento | string)[];
}

export type Hijo = Elemento | string | number | null | undefined | false;

export function el(nombre: string, atributos: Record<string, string | undefined> | null, ...hijos: (Hijo | Hijo[])[]): Elemento {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(atributos ?? {})) if (v !== undefined) attrs[k] = v;
  const planos = hijos.flat().filter((h): h is Elemento | string | number => h !== null && h !== undefined && h !== false);
  return { nombre, atributos: attrs, hijos: planos.map((h) => (typeof h === "number" ? String(h) : h)) };
}

/** Elemento con texto; si el valor está vacío, no se genera (el SRI rechaza campos vacíos). */
export function campo(nombre: string, valor: string | number | null | undefined): Elemento | null {
  if (valor === null || valor === undefined) return null;
  const t = String(valor);
  return t === "" ? null : el(nombre, null, t);
}

// Caracteres que XML 1.0 no admite
const INVALIDOS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function escaparTexto(t: string): string {
  return t.replace(INVALIDOS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

export function escaparAtributo(t: string): string {
  return t.replace(INVALIDOS, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}

/** Orden C14N: primero las declaraciones de espacio de nombres (por prefijo), luego los atributos por nombre. */
function ordenarAtributos(a: Record<string, string>): [string, string][] {
  const ns = Object.entries(a).filter(([k]) => k === "xmlns" || k.startsWith("xmlns:"))
    .sort(([x], [y]) => (x === "xmlns" ? -1 : y === "xmlns" ? 1 : x.slice(6) < y.slice(6) ? -1 : 1));
  const resto = Object.entries(a).filter(([k]) => !(k === "xmlns" || k.startsWith("xmlns:")))
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return [...ns, ...resto];
}

/**
 * Serializa en forma canónica. `nsHeredados` agrega declaraciones al elemento raíz, como hace C14N
 * inclusivo cuando se canoniza un subárbol (por ejemplo SignedInfo dentro de ds:Signature).
 */
export function serializar(e: Elemento, nsHeredados: Record<string, string> = {}): string {
  const attrs = ordenarAtributos({ ...nsHeredados, ...e.atributos });
  let s = "<" + e.nombre;
  for (const [k, v] of attrs) s += ` ${k}="${escaparAtributo(v)}"`;
  s += ">";
  for (const h of e.hijos) s += typeof h === "string" ? escaparTexto(h) : serializar(h);
  return s + "</" + e.nombre + ">";
}

export const DECLARACION = '<?xml version="1.0" encoding="UTF-8"?>';

// ---------- Lectura (para el RIDE y las respuestas del SRI) ----------

/** Árbol simple de un XML generado por nosotros o por el SRI (sin DTD ni instrucciones raras). */
export interface NodoXml {
  nombre: string;   // sin prefijo
  atributos: Record<string, string>;
  hijos: NodoXml[];
  texto: string;
}

function desescapar(t: string): string {
  return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, c: string) => {
    if (c === "amp") return "&";
    if (c === "lt") return "<";
    if (c === "gt") return ">";
    if (c === "quot") return '"';
    if (c === "apos") return "'";
    return String.fromCodePoint(c[1] === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
  });
}

export function leerXml(xml: string): NodoXml {
  const raiz: NodoXml = { nombre: "#doc", atributos: {}, hijos: [], texto: "" };
  const pila: NodoXml[] = [raiz];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const actual = pila[pila.length - 1]!;
    if (m[1] !== undefined) {
      actual.texto += m[1];
    } else if (m[2] !== undefined) {
      if (pila.length > 1) pila.pop();
    } else if (m[3] !== undefined) {
      const atributos: Record<string, string> = {};
      const ra = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ra.exec(m[4] ?? ""))) atributos[a[1]!.replace(/^.*:/, "")] = desescapar(a[2] ?? a[3] ?? "");
      const n: NodoXml = { nombre: m[3].replace(/^.*:/, ""), atributos, hijos: [], texto: "" };
      actual.hijos.push(n);
      if (m[5] !== "/") pila.push(n);
    } else if (m[6] !== undefined) {
      actual.texto += desescapar(m[6]);
    }
  }
  return raiz.hijos[0] ?? raiz;
}

/** Primer descendiente con ese nombre (búsqueda en profundidad). */
export function buscar(n: NodoXml | undefined, nombre: string): NodoXml | undefined {
  if (!n) return undefined;
  for (const h of n.hijos) {
    if (h.nombre === nombre) return h;
    const r = buscar(h, nombre);
    if (r) return r;
  }
  return undefined;
}

export function buscarTodos(n: NodoXml | undefined, nombre: string, out: NodoXml[] = []): NodoXml[] {
  if (!n) return out;
  for (const h of n.hijos) {
    if (h.nombre === nombre) out.push(h);
    buscarTodos(h, nombre, out);
  }
  return out;
}

export function textoDe(n: NodoXml | undefined, nombre: string): string {
  return buscar(n, nombre)?.texto.trim() ?? "";
}
