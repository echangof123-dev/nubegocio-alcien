/**
 * Lector mínimo de ASN.1 (DER y BER) para abrir firmas .p12.
 * Acepta longitudes indefinidas y OCTET STRING construidos, que usan algunos .p12 de Windows y Java.
 */

export interface Nodo {
  /** Primer byte de la etiqueta (clase + construido + número). */
  tag: number;
  construido: boolean;
  /** Contenido crudo (para primitivos). */
  valor: Buffer;
  hijos: Nodo[];
}

export class ErrorAsn1 extends Error {}

function leer(buf: Buffer, pos: number, fin: number): { nodo: Nodo; siguiente: number } {
  if (pos + 2 > fin) throw new ErrorAsn1("ASN.1 truncado");
  const tag = buf[pos]!;
  let p = pos + 1;
  if ((tag & 0x1f) === 0x1f) {
    // Etiqueta de número alto: se salta (no aparece en .p12, pero no debe romper)
    while (p < fin && buf[p]! & 0x80) p++;
    p++;
  }
  const construido = (tag & 0x20) !== 0;
  let largo = buf[p++]!;
  let indefinido = false;
  if (largo === 0x80) {
    indefinido = true;
    largo = -1;
  } else if (largo & 0x80) {
    const n = largo & 0x7f;
    if (n > 4 || p + n > fin) throw new ErrorAsn1("Longitud ASN.1 inválida");
    largo = 0;
    for (let i = 0; i < n; i++) largo = largo * 256 + buf[p++]!;
  }

  if (indefinido) {
    if (!construido) throw new ErrorAsn1("Longitud indefinida en un primitivo");
    const hijos: Nodo[] = [];
    while (true) {
      if (p + 2 > fin) throw new ErrorAsn1("Falta el fin de contenido");
      if (buf[p] === 0 && buf[p + 1] === 0) { p += 2; break; }
      const r = leer(buf, p, fin);
      hijos.push(r.nodo);
      p = r.siguiente;
    }
    return { nodo: { tag, construido, valor: Buffer.alloc(0), hijos }, siguiente: p };
  }

  const finValor = p + largo;
  if (finValor > fin) throw new ErrorAsn1("ASN.1 más corto de lo declarado");
  const valor = buf.subarray(p, finValor);
  const hijos: Nodo[] = [];
  if (construido) {
    let q = p;
    while (q < finValor) {
      const r = leer(buf, q, finValor);
      hijos.push(r.nodo);
      q = r.siguiente;
    }
  }
  return { nodo: { tag, construido, valor, hijos }, siguiente: finValor };
}

export function parsear(buf: Buffer): Nodo {
  return leer(buf, 0, buf.length).nodo;
}

export function hijo(n: Nodo, i: number, que = "elemento"): Nodo {
  const h = n.hijos[i];
  if (!h) throw new ErrorAsn1(`Falta ${que} en la estructura`);
  return h;
}

/** Contenido de un OCTET STRING (o de una etiqueta implícita), juntando los trozos si es construido. */
export function octetos(n: Nodo): Buffer {
  if (!n.construido) return n.valor;
  return Buffer.concat(n.hijos.map(octetos));
}

export function oid(n: Nodo): string {
  if (n.tag !== 0x06) throw new ErrorAsn1("Se esperaba un identificador de objeto");
  const b = n.valor;
  const partes = [Math.floor(b[0]! / 40), b[0]! % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i]! & 0x7f);
    if (!(b[i]! & 0x80)) { partes.push(v); v = 0; }
  }
  return partes.join(".");
}

export function entero(n: Nodo): number {
  if (n.tag !== 0x02) throw new ErrorAsn1("Se esperaba un entero");
  let v = 0;
  for (const x of n.valor) v = v * 256 + x;
  return v;
}

/** Contenido de un [0] EXPLICIT: el único hijo. */
export function explicito(n: Nodo): Nodo {
  return hijo(n, 0, "el contenido explícito");
}
