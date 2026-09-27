/** Qué pantalla tiene cada módulo. Los que no tienen pantalla propia viven dentro de otra. */
import type { InfoNegocio } from "./tipos";
import { tieneModulo } from "./tipos";

export interface PantallaModulo {
  modulo: string;
  ruta: string;
  nombre: string;
  descripcion: string;
}

export const PANTALLAS: PantallaModulo[] = [
  { modulo: "M14", ruta: "/fiados", nombre: "Fiados", descripcion: "Quién te debe y sus abonos" },
  { modulo: "M15", ruta: "/compras", nombre: "Compras", descripcion: "Proveedores, compras y lo que debes" },
  { modulo: "M16", ruta: "/lotes", nombre: "Por vencer", descripcion: "Lotes vencidos o por vencer" },
  { modulo: "M24", ruta: "/cotizaciones", nombre: "Cotizaciones", descripcion: "Proformas que se vuelven venta" },
  { modulo: "M19", ruta: "/facturacion", nombre: "Facturación", descripcion: "SRI, firma y comprobantes" },
  { modulo: "M20", ruta: "/equipo", nombre: "Equipo", descripcion: "Cajeros, bodegueros y administradores" },
];

/** Módulos que funcionan dentro de otras pantallas (no tienen una propia). */
export const INCLUIDOS: Record<string, string> = {
  M01: "En Vender", M02: "En Caja", M03: "En Caja", M04: "En Productos", M06: "En Vender",
  M07: "En Vender y Productos", M21: "En Reportes",
};

export const tienePantalla = (modulo: string) => PANTALLAS.some((p) => p.modulo === modulo) || modulo in INCLUIDOS;

export function pantallasActivas(info: InfoNegocio): PantallaModulo[] {
  return PANTALLAS.filter((p) => tieneModulo(info, p.modulo));
}

/** "productos" → "Productos"; "platos" → "Platos" */
export const titulo = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
