/**
 * Facturación electrónica: firmar dentro de la transacción de la venta y enviar al SRI después.
 *
 *   venta (transacción) → app.sri_reservar → XML → firma → app.sri_guardar_firmado → COMMIT
 *   después del COMMIT  → recepción → autorización → app.sri_registrar_resultado
 *
 * Si el SRI no responde, el comprobante queda "firmado" o "recibido" y el proceso periódico
 * (o el botón "Enviar ahora") lo reintenta con espera creciente.
 */
import type { Consultable, Pool } from "../db/pool.js";
import { ErrorApp } from "../http/errores.js";
import { abrirP12, type Firma } from "./p12.js";
import { descifrar } from "./cifrado.js";
import { construirFactura, construirNotaCredito, ErrorComprobante, type DatosComprobante, type Emisor } from "./comprobantes.js";
import { firmarComprobante } from "./xades.js";
import { ErrorConexionSri, type ClienteSri, type MensajeSri } from "./cliente.js";

type Log = (nivel: "info" | "error", msg: string, extra?: Record<string, unknown>) => void;

interface FilaConfig {
  negocio_id: string;
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
  regimen: Emisor["regimen"];
  ambiente: number;
  firma_cifrada: Buffer | null;
  clave_firma_cifrada: Buffer | null;
  actualizado_en: string;
}

interface FilaComprobante {
  id: string;
  venta_id: string;
  tipo: "factura" | "nota_credito";
  ambiente: number;
  secuencial: number;
  clave_acceso: string;
  fecha_emision: string;
  comprador: DatosComprobante["comprador"];
  total: number;
  doc_modificado_id: string | null;
  motivo: string | null;
}

export interface Pendiente {
  id: string;
  negocio_id: string;
  estado: "firmado" | "recibido";
  ambiente: number;
  clave_acceso: string;
  xml_firmado: string;
}

export class ServicioSri {
  private firmas = new Map<string, { version: string; firma: Firma }>();
  private enCurso = false;

  constructor(
    private readonly pool: Pool,
    private readonly claveFirmas: Buffer,
    private readonly cliente: ClienteSri,
    private readonly log: Log = () => {},
    private readonly esperaAutorizacionMs = 2000,
  ) {}

  /** Abre la firma del negocio (con caché en memoria mientras no cambie). */
  private firmaDe(cfg: FilaConfig): Firma {
    if (!cfg.firma_cifrada || !cfg.clave_firma_cifrada) {
      throw new ErrorApp(409, "Sube tu firma electrónica para facturar", "estado");
    }
    const guardada = this.firmas.get(cfg.negocio_id);
    if (guardada && guardada.version === cfg.actualizado_en) return guardada.firma;
    const p12 = descifrar(this.claveFirmas, cfg.negocio_id, cfg.firma_cifrada);
    const clave = descifrar(this.claveFirmas, cfg.negocio_id, cfg.clave_firma_cifrada).toString("utf8");
    const firma = abrirP12(p12, clave);
    this.firmas.set(cfg.negocio_id, { version: cfg.actualizado_en, firma });
    return firma;
  }

  /**
   * Firma los comprobantes "por firmar" del negocio actual (dentro de la transacción de la petición).
   * Devuelve los ids firmados para enviarlos después del COMMIT.
   */
  async firmarPendientes(db: Consultable): Promise<string[]> {
    const { rows: pendientes } = await db.query<FilaComprobante>(
      `select id, venta_id, tipo, ambiente, secuencial, clave_acceso, fecha_emision::text as fecha_emision,
              comprador, total, doc_modificado_id, motivo
       from app.comprobante where estado = 'por_firmar' order by creado_en`);
    if (!pendientes.length) return [];

    const { rows: c } = await db.query<FilaConfig>("select * from app.sri_config where negocio_id = app.negocio_actual()");
    if (!c[0]) throw new ErrorApp(409, "Configura la facturación electrónica antes de facturar", "estado");
    const cfg = c[0];
    const firma = this.firmaDe(cfg);
    if (firma.vence.getTime() < Date.now()) {
      throw new ErrorApp(409, "Tu firma electrónica está vencida. Sube la nueva para seguir facturando", "estado");
    }

    const emisor: Emisor = {
      ambiente: cfg.ambiente, ruc: cfg.ruc, razonSocial: cfg.razon_social, nombreComercial: cfg.nombre_comercial,
      estab: cfg.estab, ptoEmi: cfg.pto_emi, dirMatriz: cfg.dir_matriz, dirEstablecimiento: cfg.dir_establecimiento,
      obligadoContabilidad: cfg.obligado_contabilidad, contribuyenteEspecial: cfg.contribuyente_especial,
      agenteRetencion: cfg.agente_retencion, regimen: cfg.regimen,
    };

    const firmados: string[] = [];
    for (const comp of pendientes) {
      const { rows: lineas } = await db.query<{ codigo: string | null; descripcion: string; cantidad: number; tarifa: number; base: number; iva: number }>(
        `select coalesce(p.codigo_barras, left(replace(d.producto_id::text, '-', ''), 12)) as codigo,
                d.nombre as descripcion, d.cantidad, d.tarifa_iva as tarifa, d.base, d.iva
         from app.venta_detalle d left join app.producto p on p.id = d.producto_id
         where d.venta_id = $1 order by d.id`, [comp.venta_id]);
      const { rows: pagos } = await db.query<{ metodo: string; monto: number }>(
        "select metodo, monto from app.pago where venta_id = $1 order by id", [comp.venta_id]);
      const { rows: v } = await db.query<{ numero: number }>("select numero from app.venta where id = $1", [comp.venta_id]);

      const datos: DatosComprobante = {
        claveAcceso: comp.clave_acceso,
        secuencial: comp.secuencial,
        fechaEmision: comp.fecha_emision,
        emisor,
        comprador: comp.comprador,
        lineas,
        total: comp.total,
        pagos,
        infoAdicional: { "Venta": v[0] ? `N° ${v[0].numero}` : undefined },
      };

      let raiz;
      try {
        if (comp.tipo === "nota_credito") {
          const { rows: m } = await db.query<{ numero: string; fecha: string }>(
            "select numero, fecha_emision::text as fecha from app.comprobante where id = $1", [comp.doc_modificado_id]);
          raiz = construirNotaCredito({ ...datos, pagos: undefined, docModificado: m[0], motivo: comp.motivo ?? "" });
        } else {
          raiz = construirFactura(datos);
        }
      } catch (e) {
        if (e instanceof ErrorComprobante) throw new ErrorApp(422, e.message, "datos_invalidos");
        throw e;
      }

      await db.query("select app.sri_guardar_firmado($1, $2)", [comp.id, firmarComprobante(raiz, firma)]);
      firmados.push(comp.id);
    }
    return firmados;
  }

  /** Envía al SRI comprobantes concretos (después del COMMIT). */
  async enviar(ids: string[]): Promise<void> {
    for (const id of ids) {
      const { rows } = await this.pool.query<Pendiente>("select * from app.sri_tomar_pendientes(1, $1)", [id]);
      if (rows[0]) await this.procesar(rows[0]);
    }
  }

  /** Proceso periódico: toma lo que toca reintentar en todos los negocios. */
  async procesarPendientes(limite = 20): Promise<number> {
    if (this.enCurso) return 0;
    this.enCurso = true;
    try {
      const { rows } = await this.pool.query<Pendiente>("select * from app.sri_tomar_pendientes($1)", [limite]);
      // De a 4 en paralelo para no saturar al SRI
      for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map((p) => this.procesar(p)));
      return rows.length;
    } finally {
      this.enCurso = false;
    }
  }

  private async registrar(id: string, estado: string, mensajes: MensajeSri[], numero?: string, fecha?: string) {
    await this.pool.query("select app.sri_registrar_resultado($1, $2, $3, $4, $5)",
      [id, estado, mensajes, numero ?? null, fecha ?? null]);
  }

  async procesar(p: Pendiente): Promise<void> {
    let estado: string = p.estado;
    let mensajes: MensajeSri[] = [];
    try {
      if (estado === "firmado") {
        const r = await this.cliente.recibir(p.ambiente, p.xml_firmado);
        // 43: clave ya registrada · 70: en procesamiento → el SRI ya lo tiene, se consulta la autorización
        const yaLoTiene = r.mensajes.some((m) => m.identificador === "43" || m.identificador === "70");
        if (r.estado === "DEVUELTA" && !yaLoTiene) {
          await this.registrar(p.id, "devuelto", r.mensajes);
          this.log("info", "SRI devolvió comprobante", { id: p.id, mensajes: r.mensajes });
          return;
        }
        estado = "recibido";
        mensajes = r.mensajes;
        if (this.esperaAutorizacionMs) await new Promise((ok) => setTimeout(ok, this.esperaAutorizacionMs));
      }

      const a = await this.cliente.autorizar(p.ambiente, p.clave_acceso);
      if (a.estado === "AUTORIZADO") {
        await this.registrar(p.id, "autorizado", a.mensajes, a.numero ?? p.clave_acceso, a.fecha);
      } else if (a.estado === "NO AUTORIZADO") {
        await this.registrar(p.id, "no_autorizado", a.mensajes);
        this.log("info", "SRI no autorizó comprobante", { id: p.id, mensajes: a.mensajes });
      } else {
        await this.registrar(p.id, "recibido", [...mensajes, ...a.mensajes]);
      }
    } catch (e) {
      const mensaje = e instanceof ErrorConexionSri ? e.message : "Error inesperado al enviar al SRI";
      if (!(e instanceof ErrorConexionSri)) this.log("error", "envío al SRI falló", { id: p.id, error: String((e as Error)?.stack ?? e) });
      await this.registrar(p.id, estado, [{ mensaje, tipo: "ADVERTENCIA" }]).catch(() => {});
    }
  }
}
