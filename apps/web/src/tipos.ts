export type Rol = "dueno" | "administrador" | "cajero" | "bodeguero";

export interface Usuario { id: string; nombre: string | null; celular: string }
export interface NegocioResumen { negocio_id: string; nombre: string; rol: Rol; familia: string }
export interface Sesion { usuario: Usuario; negocios: NegocioResumen[] }

export interface Modulo {
  modulo: string;
  nombre: string;
  estado: "activo" | "bloqueado" | "sugerido";
  plan_requerido: string | null;
  origen: string;
}

export interface Negocio {
  id: string;
  nombre: string;
  familia: string;
  familia_nombre: string;
  tipo: string;
  ruc: string | null;
  plan: string;
  plan_vigente: string;
  suscripcion: "prueba" | "activa" | "gracia" | "vencida";
  vence_en: string;
  palabra_items: string;
  unidad_defecto: string;
  iva_defecto: number;
  metodos_pago: string[];
  permite_vender_sin_stock: boolean;
  exige_caja_abierta: boolean;
}

export interface InfoNegocio { negocio: Negocio; rol: Rol; modulos: Modulo[] }

export interface Categoria { id: string; nombre: string; orden: number; productos: number }

export interface Producto {
  id: string;
  nombre: string;
  categoria_id: string | null;
  categoria: string | null;
  unidad: string;
  precio: number | null;
  costo: number | null;
  codigo_barras: string | null;
  maneja_stock: boolean;
  stock: number;
  stock_minimo: number | null;
  variantes: string | null;
  es_ejemplo: boolean;
}

export interface LineaCarrito { producto: Producto; cantidad: number }

export interface Cliente { id: string; nombre: string; celular: string | null; limite_credito: number | null; saldo: number }

export interface ResumenCaja {
  turno_id: string;
  estado: "abierto" | "cerrado";
  abierto_en: string;
  monto_apertura: number;
  ventas_cantidad: number;
  ventas_total: number;
  efectivo_ventas: number;
  transferencia: number;
  tarjeta: number;
  deuna: number;
  fiado: number;
  abonos_efectivo: number;
  ingresos: number;
  retiros: number;
  gastos_efectivo: number;
  efectivo_esperado: number;
  efectivo_contado: number | null;
  diferencia: number | null;
}

export const tieneModulo = (info: InfoNegocio, m: string) =>
  info.modulos.some((x) => x.modulo === m && x.estado === "activo");

export const puedeGestionar = (rol: Rol) => rol === "dueno" || rol === "administrador";

/** Unidades que se venden con decimales (por peso o medida). */
export const esPorPeso = (unidad: string) =>
  /^(kilo|kg|libra|lb|litro|l|gal[oó]n|quintal|metro|metro cuadrado|onza)$/i.test(unidad.trim());
