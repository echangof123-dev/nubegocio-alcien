/**
 * Arma el XML de la factura (versión 1.1.0) y de la nota de crédito (1.1.0) según la ficha
 * técnica de comprobantes electrónicos del SRI, esquema offline.
 */
import { el, campo, type Elemento } from "./xml.js";

export type Regimen = "general" | "rimpe_emprendedor" | "rimpe_popular";

export interface Emisor {
  ambiente: number;
  ruc: string;
  razonSocial: string;
  nombreComercial?: string | null;
  estab: string;
  ptoEmi: string;
  dirMatriz: string;
  dirEstablecimiento: string;
  obligadoContabilidad: boolean;
  contribuyenteEspecial?: string | null;
  agenteRetencion?: string | null;
  regimen: Regimen;
}

export interface Comprador {
  tipo_identificacion: string;   // 04 RUC · 05 cédula · 06 pasaporte · 07 consumidor final
  identificacion: string;
  razon_social: string;
  direccion?: string;
  correo?: string;
  telefono?: string;
}

export interface Linea {
  codigo?: string | null;
  descripcion: string;
  cantidad: number | string;
  tarifa: number | string;       // porcentaje de IVA
  base: number | string;         // sin IVA, ya con descuento
  iva: number | string;
}

export interface Pago {
  metodo: string;
  monto: number | string;
}

export interface DatosComprobante {
  claveAcceso: string;
  secuencial: number | string;
  fechaEmision: string;          // AAAA-MM-DD
  emisor: Emisor;
  comprador: Comprador;
  lineas: Linea[];
  total: number | string;
  pagos?: Pago[];
  infoAdicional?: Record<string, string | null | undefined>;
  /** Solo nota de crédito */
  docModificado?: { numero: string; fecha: string };
  motivo?: string;
}

export class ErrorComprobante extends Error {}

export const LEYENDA_RIMPE: Record<Regimen, string | null> = {
  general: null,
  rimpe_emprendedor: "CONTRIBUYENTE RÉGIMEN RIMPE",
  rimpe_popular: "CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE",
};

/** Código de porcentaje de IVA (tabla 17 de la ficha técnica). */
const CODIGO_IVA: Record<string, string> = {
  "0": "0", "5": "5", "8": "8", "12": "2", "13": "10", "14": "3", "15": "4",
};

/** Formas de pago (tabla 24): 01 sin sistema financiero, 19 tarjeta de crédito, 20 otros con sistema financiero. */
const FORMA_PAGO: Record<string, string> = {
  efectivo: "01", fiado: "01", transferencia: "20", deuna: "20", tarjeta: "19",
};

const centavos = (x: number | string) => Math.round(Number(x) * 100);
const dinero = (c: number) => (c / 100).toFixed(2);
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function numeroTarifa(t: number | string): string {
  const n = Number(t);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function codigoIva(t: number | string): string {
  const c = CODIGO_IVA[numeroTarifa(t)];
  if (!c) throw new ErrorComprobante(`El SRI no tiene la tarifa de IVA ${t} %`);
  return c;
}

function texto(t: string | null | undefined, max: number): string | undefined {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function infoTributaria(d: DatosComprobante, codDoc: string): Elemento {
  const e = d.emisor;
  return el("infoTributaria", null,
    campo("ambiente", e.ambiente),
    campo("tipoEmision", "1"),
    campo("razonSocial", texto(e.razonSocial, 300)),
    campo("nombreComercial", texto(e.nombreComercial, 300)),
    campo("ruc", e.ruc),
    campo("claveAcceso", d.claveAcceso),
    campo("codDoc", codDoc),
    campo("estab", e.estab),
    campo("ptoEmi", e.ptoEmi),
    campo("secuencial", String(d.secuencial).padStart(9, "0")),
    campo("dirMatriz", texto(e.dirMatriz, 300)),
    campo("agenteRetencion", e.agenteRetencion),
    campo("contribuyenteRimpe", LEYENDA_RIMPE[e.regimen]),
  );
}

interface Totales {
  sinImpuestos: number;
  iva: number;
  total: number;
  porCodigo: Map<string, { base: number; valor: number }>;
}

function detalles(d: DatosComprobante, nota: boolean): { elemento: Elemento; totales: Totales } {
  if (!d.lineas.length) throw new ErrorComprobante("El comprobante no tiene productos");
  const porCodigo = new Map<string, { base: number; valor: number }>();
  let sinImpuestos = 0;
  let iva = 0;

  const filas = d.lineas.map((l, i) => {
    const base = centavos(l.base);
    const valor = centavos(l.iva);
    const cantidad = Number(l.cantidad);
    if (!(cantidad > 0)) throw new ErrorComprobante(`Cantidad inválida en la línea ${i + 1}`);
    const codigo = codigoIva(l.tarifa);
    const t = porCodigo.get(codigo) ?? { base: 0, valor: 0 };
    t.base += base;
    t.valor += valor;
    porCodigo.set(codigo, t);
    sinImpuestos += base;
    iva += valor;

    // Precio unitario sin IVA con 6 decimales: cantidad × precio redondeado a 2 da la base exacta
    const precioUnitario = (base / 100 / cantidad).toFixed(6);
    const codigoProducto = texto(l.codigo, 25) ?? `P${String(i + 1).padStart(3, "0")}`;
    return el("detalle", null,
      campo(nota ? "codigoInterno" : "codigoPrincipal", codigoProducto),
      campo("descripcion", texto(l.descripcion, 300) ?? "Producto"),
      campo("cantidad", cantidad.toFixed(6)),
      campo("precioUnitario", precioUnitario),
      campo("descuento", "0.00"),
      campo("precioTotalSinImpuesto", dinero(base)),
      el("impuestos", null,
        el("impuesto", null,
          campo("codigo", "2"),
          campo("codigoPorcentaje", codigo),
          campo("tarifa", numeroTarifa(l.tarifa)),
          campo("baseImponible", dinero(base)),
          campo("valor", dinero(valor)))));
  });

  const total = sinImpuestos + iva;
  if (total !== centavos(d.total)) {
    throw new ErrorComprobante(`Los productos suman ${dinero(total)} pero el total es ${dinero(centavos(d.total))}`);
  }
  return { elemento: el("detalles", null, filas), totales: { sinImpuestos, iva, total, porCodigo } };
}

function totalConImpuestos(t: Totales): Elemento {
  return el("totalConImpuestos", null, [...t.porCodigo.entries()].map(([codigo, v]) =>
    el("totalImpuesto", null,
      campo("codigo", "2"),
      campo("codigoPorcentaje", codigo),
      campo("baseImponible", dinero(v.base)),
      campo("valor", dinero(v.valor)))));
}

function infoAdicional(d: DatosComprobante): Elemento | null {
  const campos: [string, string][] = [];
  const agregar = (nombre: string, valor: string | null | undefined) => {
    const v = texto(valor, 300);
    if (v && campos.length < 15) campos.push([nombre, v]);
  };
  agregar("Dirección", d.comprador.direccion);
  agregar("Correo", d.comprador.correo);
  agregar("Teléfono", d.comprador.telefono);
  for (const [k, v] of Object.entries(d.infoAdicional ?? {})) agregar(k, v);
  if (!campos.length) return null;
  return el("infoAdicional", null, campos.map(([n, v]) => el("campoAdicional", { nombre: n }, v)));
}

function datosComprador(c: Comprador) {
  if (!/^0[4-8]$/.test(c.tipo_identificacion)) throw new ErrorComprobante("Tipo de identificación del comprador inválido");
  return {
    tipo: campo("tipoIdentificacionComprador", c.tipo_identificacion),
    razon: campo("razonSocialComprador", texto(c.razon_social, 300) ?? "CONSUMIDOR FINAL"),
    id: campo("identificacionComprador", c.identificacion),
  };
}

export function construirFactura(d: DatosComprobante): Elemento {
  const e = d.emisor;
  const { elemento, totales } = detalles(d, false);
  const c = datosComprador(d.comprador);

  const pagos = new Map<string, number>();
  for (const p of d.pagos ?? []) {
    const fp = FORMA_PAGO[p.metodo] ?? "01";
    pagos.set(fp, (pagos.get(fp) ?? 0) + centavos(p.monto));
  }
  if (!pagos.size) pagos.set("01", totales.total);

  return el("factura", { id: "comprobante", version: "1.1.0" },
    infoTributaria(d, "01"),
    el("infoFactura", null,
      campo("fechaEmision", fecha(d.fechaEmision)),
      campo("dirEstablecimiento", texto(e.dirEstablecimiento, 300)),
      campo("contribuyenteEspecial", e.contribuyenteEspecial),
      campo("obligadoContabilidad", e.obligadoContabilidad ? "SI" : "NO"),
      c.tipo,
      c.razon,
      c.id,
      campo("direccionComprador", texto(d.comprador.direccion, 300)),
      campo("totalSinImpuestos", dinero(totales.sinImpuestos)),
      campo("totalDescuento", "0.00"),
      totalConImpuestos(totales),
      campo("propina", "0.00"),
      campo("importeTotal", dinero(totales.total)),
      campo("moneda", "DOLAR"),
      el("pagos", null, [...pagos.entries()].map(([fp, monto]) =>
        el("pago", null, campo("formaPago", fp), campo("total", dinero(monto)))))),
    elemento,
    infoAdicional(d));
}

export function construirNotaCredito(d: DatosComprobante): Elemento {
  const e = d.emisor;
  if (!d.docModificado || !d.motivo) throw new ErrorComprobante("La nota de crédito necesita la factura y el motivo");
  if (d.comprador.tipo_identificacion === "07") throw new ErrorComprobante("El SRI no permite notas de crédito a consumidor final");
  const { elemento, totales } = detalles(d, true);
  const c = datosComprador(d.comprador);

  return el("notaCredito", { id: "comprobante", version: "1.1.0" },
    infoTributaria(d, "04"),
    el("infoNotaCredito", null,
      campo("fechaEmision", fecha(d.fechaEmision)),
      campo("dirEstablecimiento", texto(e.dirEstablecimiento, 300)),
      c.tipo,
      c.razon,
      c.id,
      campo("contribuyenteEspecial", e.contribuyenteEspecial),
      campo("obligadoContabilidad", e.obligadoContabilidad ? "SI" : "NO"),
      campo("codDocModificado", "01"),
      campo("numDocModificado", d.docModificado.numero),
      campo("fechaEmisionDocSustento", fecha(d.docModificado.fecha)),
      campo("totalSinImpuestos", dinero(totales.sinImpuestos)),
      campo("valorModificacion", dinero(totales.total)),
      campo("moneda", "DOLAR"),
      totalConImpuestos(totales),
      campo("motivo", texto(d.motivo, 300))),
    elemento,
    infoAdicional(d));
}
