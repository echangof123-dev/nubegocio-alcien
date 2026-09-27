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
  tipo?: "venta" | "insumo";
  tiene_receta?: boolean;
}

export interface LineaCarrito { producto: Producto; cantidad: number }

export interface Cliente {
  id: string;
  nombre: string;
  celular: string | null;
  limite_credito: number | null;
  saldo: number;
  identificacion?: string | null;
  tipo_identificacion?: "cedula" | "ruc" | "pasaporte" | null;
  correo?: string | null;
  direccion?: string | null;
}

export type EstadoComprobante = "por_firmar" | "firmado" | "recibido" | "autorizado" | "devuelto" | "no_autorizado" | "anulado";

export interface MensajeSri { identificador?: string; mensaje: string; informacionAdicional?: string; tipo?: string }

export interface Comprobante {
  id: string;
  venta_id: string;
  venta_numero: number;
  tipo: "factura" | "nota_credito";
  numero: string;
  estado: EstadoComprobante;
  ambiente: 1 | 2;
  clave_acceso: string;
  fecha_emision: string;
  total: number;
  comprador: { tipo_identificacion: string; identificacion: string; razon_social: string; telefono?: string; correo?: string };
  mensajes: MensajeSri[];
  numero_autorizacion: string | null;
  fecha_autorizacion: string | null;
  intentos: number;
  token_publico: string;
  motivo: string | null;
  creado_en: string;
}

export interface ConfigSri {
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  dir_matriz: string;
  dir_establecimiento: string;
  estab: string;
  pto_emi: string;
  obligado_contabilidad: boolean;
  contribuyente_especial: string | null;
  agente_retencion: string | null;
  regimen: "general" | "rimpe_emprendedor" | "rimpe_popular";
  ambiente: 1 | 2;
  tiene_firma: boolean;
  firma_titular: string | null;
  firma_emisor: string | null;
  firma_vence: string | null;
  siguiente_factura: number | null;
}

export interface EstadoSri { config: ConfigSri | null; plan_incluye: boolean; listo: boolean }

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
