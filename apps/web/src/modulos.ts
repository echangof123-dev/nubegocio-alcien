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
  { modulo: "M09", ruta: "/mesas", nombre: "Mesas", descripcion: "Cuentas abiertas, comandas y cobro por mesa" },
  { modulo: "M10", ruta: "/pedidos", nombre: "Pedidos", descripcion: "Para llevar y a domicilio" },
  { modulo: "M09|M10", ruta: "/cocina", nombre: "Cocina", descripcion: "Lo que hay que preparar" },
  { modulo: "M08", ruta: "/recetas", nombre: "Recetas", descripcion: "Insumos y costo de cada plato" },
  { modulo: "M17", ruta: "/listas", nombre: "Listas de precios", descripcion: "Mayorista, distribuidor y por volumen" },
  { modulo: "M23", ruta: "/series", nombre: "Series", descripcion: "Series, IMEI y garantías" },
  { modulo: "M18", ruta: "/catalogo", nombre: "Catálogo en línea", descripcion: "Tu tienda para compartir por WhatsApp" },
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
  M07: "En Vender y Productos", M21: "En Reportes", M05: "En Productos",
};

export const tienePantalla = (modulo: string) => PANTALLAS.some((p) => p.modulo.split("|").includes(modulo)) || modulo in INCLUIDOS;

/** Una pantalla con "M09|M10" aparece si el negocio tiene cualquiera de los dos. */
export function pantallasActivas(info: InfoNegocio): PantallaModulo[] {
  return PANTALLAS.filter((p) => p.modulo.split("|").some((m) => tieneModulo(info, m)));
}

/** "productos" → "Productos"; "platos" → "Platos" */
export const titulo = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
