/** Validación de cédula y RUC de Ecuador. */

function provinciaValida(d: string): boolean {
  const p = Number(d.slice(0, 2));
  return (p >= 1 && p <= 24) || p === 30;
}

/** Cédula: 10 dígitos, provincia válida, tercer dígito < 6 y verificador módulo 10. */
export function cedulaValida(c: string): boolean {
  if (!/^[0-9]{10}$/.test(c) || !provinciaValida(c) || Number(c[2]) >= 6) return false;
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(c[i]) * (i % 2 === 0 ? 2 : 1);
    if (x > 9) x -= 9;
    suma += x;
  }
  return (10 - (suma % 10)) % 10 === Number(c[9]);
}

/**
 * RUC: 13 dígitos. Persona natural = cédula válida + 001.
 * Sociedades (tercer dígito 9) y entidades públicas (6): solo se revisa la forma, porque el SRI
 * ha emitido RUC de sociedades que no cumplen el antiguo dígito verificador.
 */
export function rucValido(r: string): boolean {
  if (!/^[0-9]{13}$/.test(r) || !provinciaValida(r)) return false;
  const t = Number(r[2]);
  if (t < 6) return cedulaValida(r.slice(0, 10)) && r.endsWith("001");
  if (t === 6) return r.endsWith("0001") || r.endsWith("001");
  if (t === 9) return r.endsWith("001");
  return false;
}

export type TipoIdentificacion = "cedula" | "ruc" | "pasaporte";

/** Deduce el tipo y valida. Devuelve null si es inválida. */
export function clasificar(id: string): TipoIdentificacion | null {
  const s = id.trim().toUpperCase();
  if (/^[0-9]{10}$/.test(s)) return cedulaValida(s) ? "cedula" : null;
  if (/^[0-9]{13}$/.test(s)) return rucValido(s) ? "ruc" : null;
  if (/^[A-Z0-9]{5,20}$/.test(s)) return "pasaporte";
  return null;
}
