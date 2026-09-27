/**
 * Validación de entradas, pequeña y explícita. Cada función recibe el valor crudo
 * y el nombre del campo (para el mensaje) y devuelve el valor ya limpio o lanza 422.
 */
import { invalido } from "./errores.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function objeto(v: unknown, campo = "cuerpo"): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw invalido(`${campo} debe ser un objeto`);
  return v as Record<string, unknown>;
}

export function texto(v: unknown, campo: string, opc: { min?: number; max?: number } = {}): string {
  if (typeof v !== "string") throw invalido(`Falta ${campo}`);
  const s = v.trim();
  const min = opc.min ?? 1, max = opc.max ?? 200;
  if (s.length < min) throw invalido(`${campo} es muy corto`);
  if (s.length > max) throw invalido(`${campo} es muy largo (máximo ${max})`);
  return s;
}

export function textoOpcional(v: unknown, campo: string, opc: { max?: number } = {}): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  return texto(v, campo, { min: 1, max: opc.max ?? 200 });
}

export function numero(v: unknown, campo: string, opc: { min?: number; max?: number; decimales?: number } = {}): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw invalido(`${campo} debe ser un número`);
  if (opc.min !== undefined && n < opc.min) throw invalido(`${campo} debe ser al menos ${opc.min}`);
  if (opc.max !== undefined && n > opc.max) throw invalido(`${campo} no puede pasar de ${opc.max}`);
  if (opc.decimales !== undefined) {
    const f = 10 ** opc.decimales;
    if (Math.abs(Math.round(n * f) - n * f) > 1e-6) throw invalido(`${campo} admite hasta ${opc.decimales} decimales`);
  }
  return n;
}

export function numeroOpcional(v: unknown, campo: string, opc: Parameters<typeof numero>[2] = {}): number | null {
  if (v === undefined || v === null || v === "") return null;
  return numero(v, campo, opc);
}

export function uuid(v: unknown, campo: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw invalido(`${campo} no es válido`);
  return v.toLowerCase();
}

export function uuidOpcional(v: unknown, campo: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  return uuid(v, campo);
}

export function opcion<T extends string>(v: unknown, campo: string, opciones: readonly T[]): T {
  if (typeof v !== "string" || !opciones.includes(v as T)) {
    throw invalido(`${campo} debe ser: ${opciones.join(", ")}`);
  }
  return v as T;
}

export function booleano(v: unknown, campo: string): boolean {
  if (typeof v !== "boolean") throw invalido(`${campo} debe ser verdadero o falso`);
  return v;
}

export function lista(v: unknown, campo: string, opc: { min?: number; max?: number } = {}): unknown[] {
  if (!Array.isArray(v)) throw invalido(`${campo} debe ser una lista`);
  if (v.length < (opc.min ?? 0)) throw invalido(`${campo} está vacío`);
  if (v.length > (opc.max ?? 200)) throw invalido(`${campo} tiene demasiados elementos`);
  return v;
}

/**
 * Normaliza un celular a formato internacional E.164.
 * Acepta números de Ecuador como 0991234567 o 991234567, y cualquier +código de país.
 */
export function celular(v: unknown): string {
  if (typeof v !== "string") throw invalido("Escribe tu número de celular");
  const limpio = v.replace(/[\s\-().]/g, "");
  let e164: string;
  if (/^\+[1-9]\d{7,14}$/.test(limpio)) e164 = limpio;
  else if (/^09\d{8}$/.test(limpio)) e164 = "+593" + limpio.slice(1);
  else if (/^9\d{8}$/.test(limpio)) e164 = "+593" + limpio;
  else if (/^5939\d{8}$/.test(limpio)) e164 = "+" + limpio;
  else throw invalido("Ese número de celular no parece válido");
  if (e164.startsWith("+593") && !/^\+5939\d{8}$/.test(e164)) throw invalido("Ese número de celular no parece válido");
  return e164;
}
