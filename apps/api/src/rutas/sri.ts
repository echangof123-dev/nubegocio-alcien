import crypto from "node:crypto";
import type { Router } from "../http/servidor.js";
import { ErrorApp, invalido, noEncontrado, prohibido } from "../http/errores.js";
import { booleano, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional } from "../http/validar.js";
import type { Pool } from "../db/pool.js";
import type { ServicioSri } from "../sri/servicio.js";
import { abrirP12, ErrorFirma } from "../sri/p12.js";
import { cifrar } from "../sri/cifrado.js";
import { rucValido } from "../sri/identificacion.js";
import { htmlRide, xmlAutorizado, type DatosRide } from "../sri/ride.js";

export interface DepSri {
  pool: Pool;
  sri: ServicioSri;
  claveFirmas: Buffer;
  /** Token para la tarea programada que reintenta envíos (Cloud Scheduler). */
  tokenTareas?: string;
}

const REGIMENES = ["general", "rimpe_emprendedor", "rimpe_popular"] as const;
const TAMANO_MAX_FIRMA = 60 * 1024;

const COLUMNAS_COMPROBANTE = `c.id, c.venta_id, c.tipo, c.numero, c.estado, c.ambiente, c.clave_acceso, c.fecha_emision,
  c.total, c.comprador, c.mensajes, c.numero_autorizacion, c.fecha_autorizacion, c.intentos, c.proximo_intento,
  c.token_publico, c.doc_modificado_id, c.motivo, c.creado_en, v.numero as venta_numero`;

function tresDigitos(v: unknown, campo: string): string {
  const s = texto(v ?? "001", campo, { max: 3 });
  if (!/^[0-9]{3}$/.test(s) || s === "000") throw invalido(`${campo} debe tener 3 dígitos (por ejemplo 001)`);
  return s;
}

export function rutasSri(r: Router, dep: DepSri) {
  const soloDueño = (rol: string) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido("Solo el dueño o un administrador pueden configurar la facturación");
  };

  // ---------- Configuración ----------

  r.negocio("GET", "/sri/config", async (_p, { db }) => {
    const { rows } = await db.query(
      `select ruc, razon_social, nombre_comercial, dir_matriz, dir_establecimiento, estab, pto_emi,
              obligado_contabilidad, contribuyente_especial, agente_retencion, regimen, ambiente,
              firma_cifrada is not null as tiene_firma, firma_titular, firma_emisor, firma_vence, actualizado_en,
              (select valor + 1 from app.contador
                where clave = app.sri_clave_contador(s.ambiente, '01', s.estab, s.pto_emi)) as siguiente_factura
       from app.sri_config s`);
    const { rows: m } = await db.query<{ activo: boolean }>("select app.modulo_activo('M19') as activo");
    const cfg = rows[0] ?? null;
    return {
      config: cfg,
      plan_incluye: m[0]?.activo ?? false,
      listo: Boolean(cfg && (cfg as { tiene_firma: boolean }).tiene_firma && m[0]?.activo),
    };
  });

  r.negocio("POST", "/sri/config", async (p, { db, rol }) => {
    soloDueño(rol);
    const c = objeto(p.cuerpo);
    const ruc = texto(c.ruc, "El RUC", { max: 13 });
    if (!rucValido(ruc)) throw invalido("El RUC no es válido");
    const especial = textoOpcional(c.contribuyente_especial, "El número de contribuyente especial", { max: 13 });
    if (especial && !/^[0-9]{1,13}$/.test(especial)) throw invalido("El número de contribuyente especial solo lleva dígitos");
    const agente = textoOpcional(c.agente_retencion, "La resolución de agente de retención", { max: 8 });
    if (agente && !/^[0-9]{1,8}$/.test(agente)) throw invalido("La resolución de agente de retención solo lleva dígitos");
    const siguiente = (v: unknown, campo: string) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 999_999_999) throw invalido(`${campo} debe ser un número entre 1 y 999999999`);
      return n;
    };

    await db.query("select app.sri_guardar_datos($1)", [{
      ruc,
      razon_social: texto(c.razon_social, "La razón social", { min: 3, max: 300 }),
      nombre_comercial: textoOpcional(c.nombre_comercial, "El nombre comercial", { max: 300 }),
      dir_matriz: texto(c.dir_matriz, "La dirección matriz", { min: 3, max: 300 }),
      dir_establecimiento: texto(c.dir_establecimiento ?? c.dir_matriz, "La dirección del establecimiento", { min: 3, max: 300 }),
      estab: tresDigitos(c.estab, "El establecimiento"),
      pto_emi: tresDigitos(c.pto_emi, "El punto de emisión"),
      obligado_contabilidad: c.obligado_contabilidad === undefined ? false : booleano(c.obligado_contabilidad, "Obligado a llevar contabilidad"),
      contribuyente_especial: especial,
      agente_retencion: agente,
      regimen: c.regimen === undefined ? "general" : opcion(c.regimen, "El régimen", REGIMENES),
      ambiente: c.ambiente === undefined ? 1 : Number(opcion(String(c.ambiente), "El ambiente", ["1", "2"] as const)),
      siguiente_factura: siguiente(c.siguiente_factura, "El número de la siguiente factura"),
      siguiente_nota_credito: siguiente(c.siguiente_nota_credito, "El número de la siguiente nota de crédito"),
    }]);
    return { guardado: true };
  });

  r.negocio("POST", "/sri/firma", async (p, { db, rol, negocioId }) => {
    soloDueño(rol);
    const c = objeto(p.cuerpo);
    const archivo = texto(c.archivo, "El archivo de la firma", { max: 100_000 });
    const clave = typeof c.clave === "string" ? c.clave : "";
    if (!clave) throw invalido("Escribe la contraseña de la firma");
    const p12 = Buffer.from(archivo.replace(/^data:[^,]*,/, ""), "base64");
    if (p12.length < 100 || p12.length > TAMANO_MAX_FIRMA) throw invalido("El archivo no parece una firma .p12");

    let firma;
    try {
      firma = abrirP12(p12, clave);
    } catch (e) {
      if (e instanceof ErrorFirma) throw invalido(e.message);
      throw e;
    }
    if (firma.vence.getTime() < Date.now()) throw invalido(`Esta firma venció el ${firma.vence.toLocaleDateString("es-EC")}`);
    if (firma.desde.getTime() > Date.now()) throw invalido("Esta firma todavía no está vigente");
    // Prueba de que la llave firma de verdad
    const prueba = crypto.sign("sha1", Buffer.from("alcien"), firma.llave);
    if (!crypto.verify("sha1", Buffer.from("alcien"), firma.certificado.publicKey, prueba)) {
      throw invalido("La llave de la firma no corresponde a su certificado");
    }

    await db.query("select app.sri_guardar_firma($1, $2, $3, $4, $5, $6)", [
      cifrar(dep.claveFirmas, negocioId, p12),
      cifrar(dep.claveFirmas, negocioId, Buffer.from(clave, "utf8")),
      firma.titular, firma.emisor, firma.serie, firma.vence,
    ]);
    return { firma: { titular: firma.titular, emisor: firma.emisor, vence: firma.vence.toISOString() } };
  });

  // ---------- Comprobantes ----------

  r.negocio("GET", "/comprobantes", async (p, { db }) => {
    const estado = p.query.get("estado");
    const pendientes = p.query.get("pendientes") === "1";
    const { rows } = await db.query(
      `select ${COLUMNAS_COMPROBANTE}
       from app.comprobante c join app.venta v on v.id = c.venta_id
       where ($1::text is null or c.estado = $1)
         and (not $2 or c.estado in ('firmado', 'recibido', 'devuelto', 'no_autorizado'))
       order by c.creado_en desc limit 300`, [estado, pendientes]);
    const { rows: resumen } = await db.query(
      `select count(*) filter (where estado in ('firmado', 'recibido'))::int as en_proceso,
              count(*) filter (where estado in ('devuelto', 'no_autorizado'))::int as con_problemas
       from app.comprobante`);
    return { comprobantes: rows, resumen: resumen[0] };
  });

  r.negocio("GET", "/comprobantes/:id", async (p, { db }) => {
    const { rows } = await db.query(
      `select ${COLUMNAS_COMPROBANTE} from app.comprobante c join app.venta v on v.id = c.venta_id where c.id = $1`,
      [uuid(p.params.id, "El comprobante")]);
    if (!rows[0]) throw noEncontrado("Comprobante no encontrado");
    return { comprobante: rows[0] };
  });

  /** Reintenta ya el envío (espera la respuesta del SRI). */
  r.negocio("POST", "/comprobantes/:id/enviar", async (p, { db }) => {
    const id = uuid(p.params.id, "El comprobante");
    const { rows } = await db.query<{ estado: string }>("select estado from app.comprobante where id = $1", [id]);
    if (!rows[0]) throw noEncontrado("Comprobante no encontrado");
    if (rows[0].estado !== "firmado" && rows[0].estado !== "recibido") {
      throw new ErrorApp(409, "Ese comprobante no está pendiente de envío", "estado");
    }
    await dep.sri.enviar([id]);   // usa otras conexiones: el comprobante ya está confirmado
    const { rows: c } = await db.query(
      `select ${COLUMNAS_COMPROBANTE} from app.comprobante c join app.venta v on v.id = c.venta_id where c.id = $1`, [id]);
    return { comprobante: c[0] };
  });

  /** Vuelve a emitir (con otro número) una factura devuelta o no autorizada. */
  r.negocio("POST", "/comprobantes/:id/reemitir", async (p, { db, alConfirmar }) => {
    const id = uuid(p.params.id, "El comprobante");
    const { rows } = await db.query<{ id: string }>("select (app.sri_reemitir($1)).id", [id]);
    const firmados = await dep.sri.firmarPendientes(db);
    alConfirmar(() => dep.sri.enviar(firmados));
    return { status: 201, cuerpo: { comprobante_id: rows[0]!.id } };
  });

  /** Factura una venta ya hecha (el cliente pidió factura después). */
  r.negocio("POST", "/ventas/:id/facturar", async (p, { db, alConfirmar }) => {
    const id = uuid(p.params.id, "La venta");
    const cliente = uuidOpcional(objeto(p.cuerpo).cliente_id, "El cliente");
    if (cliente) {
      const { rowCount } = await db.query(
        "update app.venta set cliente_id = $2 where id = $1 and estado = 'completada'", [id, cliente]);
      if (!rowCount) throw noEncontrado("Venta no encontrada");
    }
    const { rows } = await db.query<{ id: string }>("select (app.sri_reservar($1, 'factura')).id", [id]);
    const firmados = await dep.sri.firmarPendientes(db);
    alConfirmar(() => dep.sri.enviar(firmados));
    return { status: 201, cuerpo: { comprobante_id: rows[0]!.id } };
  });

  // ---------- Enlace público del comprobante (RIDE) ----------

  const publico = async (token: string): Promise<DatosRide> => {
    if (!/^[0-9a-f]{36}$/.test(token)) throw noEncontrado("Comprobante no encontrado");
    const { rows } = await dep.pool.query<DatosRide>("select * from app.sri_publico($1)", [token]);
    if (!rows[0]) throw noEncontrado("Comprobante no encontrado");
    return rows[0];
  };

  r.publico("GET", "/c/:token", async (p) => {
    const d = await publico(p.params.token!);
    return { crudo: { tipo: "text/html; charset=utf-8", cuerpo: htmlRide(d, `/api/c/${p.params.token}/xml`) } };
  });

  r.publico("GET", "/c/:token/xml", async (p) => {
    const d = await publico(p.params.token!);
    return {
      crudo: {
        tipo: "application/xml; charset=utf-8",
        cuerpo: xmlAutorizado(d),
        descarga: `${d.tipo === "factura" ? "factura" : "nota-credito"}-${d.numero}.xml`,
      },
    };
  });

  // ---------- Tarea programada (Cloud Scheduler) ----------

  r.publico("POST", "/tareas/sri", async (p) => {
    const token = String(p.headers.authorization ?? "").replace(/^Bearer /, "");
    const esperado = dep.tokenTareas ?? "";
    const ok = esperado.length >= 32 && token.length === esperado.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
    if (!ok) throw noEncontrado("Ruta no encontrada");
    const procesados = await dep.sri.procesarPendientes(50);
    return { procesados };
  });
}
