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
  // "*": pantallas de todos los negocios (como en Treinta)
  { modulo: "*", ruta: "/asistente", nombre: "Asistente", descripcion: "Pregunta cómo va tu negocio o anota ventas escribiendo" },
  { modulo: "*", ruta: "/deudas", nombre: "Deudas", descripcion: "Lo que te deben y lo que debes" },
  { modulo: "*", ruta: "/clientes", nombre: "Clientes", descripcion: "Historial, notas y quién te debe" },
  { modulo: "*", ruta: "/gastos", nombre: "Gastos", descripcion: "Arriendo, servicios, nómina y más" },
  { modulo: "M04", ruta: "/inventario", nombre: "Inventario", descripcion: "Valor, stock bajo y carga desde Excel" },
  { modulo: "*", ruta: "/reportes", nombre: "Ventas del día", descripcion: "Ventas, facturas y anulaciones" },
  { modulo: "M09", ruta: "/mesas", nombre: "Mesas", descripcion: "Cuentas abiertas, comandas y cobro por mesa" },
  { modulo: "M10", ruta: "/pedidos", nombre: "Pedidos", descripcion: "Para llevar y a domicilio" },
  { modulo: "M09|M10", ruta: "/cocina", nombre: "Cocina", descripcion: "Lo que hay que preparar" },
  { modulo: "M08", ruta: "/recetas", nombre: "Recetas", descripcion: "Insumos y costo de cada plato" },
  { modulo: "M11", ruta: "/agenda", nombre: "Agenda", descripcion: "Citas por profesional y recordatorios" },
  { modulo: "M13", ruta: "/ordenes", nombre: "Órdenes de trabajo", descripcion: "Equipos en el taller, repuestos y entrega" },
  { modulo: "M26", ruta: "/reservas", nombre: "Reservas", descripcion: "Habitaciones, canchas o salones por fecha" },
  { modulo: "M22", ruta: "/membresias", nombre: "Membresías", descripcion: "Planes, asistencia y vencimientos" },
  { modulo: "M11|M12|M13", ruta: "/profesionales", nombre: "Profesionales", descripcion: "Quién atiende y sus comisiones" },
  { modulo: "M25", ruta: "/acopio", nombre: "Acopio", descripcion: "Compra a productores por peso y humedad" },
  { modulo: "M21", ruta: "/estadisticas", nombre: "Reportes por periodo", descripcion: "Ventas, utilidad, gastos y más vendidos" },
  { modulo: "M17", ruta: "/listas", nombre: "Listas de precios", descripcion: "Mayorista, distribuidor y por volumen" },
  { modulo: "M23", ruta: "/series", nombre: "Series", descripcion: "Series, IMEI y garantías" },
  { modulo: "M18", ruta: "/catalogo", nombre: "Catálogo en línea", descripcion: "Tu tienda para compartir por WhatsApp" },
  { modulo: "M15", ruta: "/compras", nombre: "Compras", descripcion: "Proveedores, compras y lo que debes" },
  { modulo: "M16", ruta: "/lotes", nombre: "Por vencer", descripcion: "Lotes vencidos o por vencer" },
  { modulo: "M24", ruta: "/cotizaciones", nombre: "Cotizaciones", descripcion: "Proformas que se vuelven venta" },
  { modulo: "M19", ruta: "/facturacion", nombre: "Facturación", descripcion: "SRI, firma y comprobantes" },
  { modulo: "M20", ruta: "/equipo", nombre: "Equipo", descripcion: "Cajeros, bodegueros y administradores" },
  { modulo: "*", ruta: "/ajustes", nombre: "Ajustes", descripcion: "Recibo, impresora, pagos y tu cuenta" },
];

/** Módulos que funcionan dentro de otras pantallas (no tienen una propia). */
export const INCLUIDOS: Record<string, string> = {
  M01: "En Vender", M02: "En Caja", M03: "En Caja", M04: "En Productos", M06: "En Vender",
  M07: "En Vender y Productos", M05: "En Productos",
};

export const tienePantalla = (modulo: string) => PANTALLAS.some((p) => p.modulo.split("|").includes(modulo)) || modulo in INCLUIDOS;

/** Una pantalla con "M09|M10" aparece si el negocio tiene cualquiera de los dos. */
export function pantallasActivas(info: InfoNegocio): PantallaModulo[] {
  return PANTALLAS.filter((p) => p.modulo === "*" || p.modulo.split("|").some((m) => tieneModulo(info, m)));
}

/** "productos" → "Productos"; "platos" → "Platos" */
export const titulo = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);
