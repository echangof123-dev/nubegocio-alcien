/**
 * Tanda 7 (lo que faltaba de Treinta): deudas por cobrar y por pagar, logo del negocio, combos,
 * resumen de todos tus negocios (sucursales) y jornada de empleados.
 */
import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import { lista, numero, objeto, opcion, texto, textoOpcional, uuid } from "../http/validar.js";
import { puede } from "./comun.js";

const fecha = (v: unknown, campo: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalido(`${campo} debe ser AAAA-MM-DD`);
  return v;
};
const hoyEc = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

/** Revisa que la imagen sea lo que dice ser. */
function imagen(c: Record<string, unknown>, maxBytes: number): { tipo: string; datos: Buffer } {
  const tipo = opcion(c.tipo, "El tipo de imagen", ["image/jpeg", "image/webp", "image/png"] as const);
  const b64 = texto(c.datos, "La imagen", { max: Math.ceil(maxBytes * 1.4) });
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw invalido("La imagen no es válida");
  const datos = Buffer.from(b64, "base64");
  const ok = tipo === "image/jpeg" ? datos[0] === 0xff && datos[1] === 0xd8
    : tipo === "image/png" ? datos.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : datos.subarray(0, 4).toString("latin1") === "RIFF" && datos.subarray(8, 12).toString("latin1") === "WEBP";
  if (!ok) throw invalido("La imagen no es válida");
  if (datos.length > maxBytes) throw invalido(`La imagen es muy pesada (máximo ${Math.round(maxBytes / 1000)} KB)`);
  return { tipo, datos };
}

export function rutasDeudas(r: Router, dep: { pool: Pool }) {
  // ---------- Deudas ----------

  r.negocio("GET", "/deudas", async (_p, { db, rol }) => {
    const { rows: cobrar } = await db.query(
      `select s.cliente_id as id, s.nombre, s.celular, s.saldo, s.ultimo_cargo, c.fecha_pago
       from app.cliente_saldo s join app.cliente c on c.id = s.cliente_id
       where s.saldo > 0 order by c.fecha_pago nulls last, s.saldo desc limit 500`);
    let pagar: unknown[] = [];
    if (rol !== "cajero") {
      const { rows } = await db.query(
        `select 'compra' as tipo, c.id, pr.nombre as proveedor, 'Compra N.º ' || c.numero as concepto, c.fecha, null::date as vence,
                c.total as monto, c.total - c.pagado as saldo
         from app.compra c left join app.proveedor pr on pr.id = c.proveedor_id
         where c.estado = 'recibida' and c.total > c.pagado
         union all
         select 'deuda', d.id, pr.nombre, d.concepto, d.fecha, d.vence, d.monto, d.monto - d.pagado
         from app.deuda_proveedor d join app.proveedor pr on pr.id = d.proveedor_id
         where d.estado = 'pendiente'
         order by vence nulls last, fecha`);
      pagar = rows;
    }
    const suma = (xs: unknown[]) => Math.round(xs.reduce((s: number, x) => s + Number((x as { saldo: number }).saldo), 0) * 100) / 100;
    return { por_cobrar: cobrar, total_cobrar: suma(cobrar), por_pagar: pagar, total_pagar: suma(pagar) };
  });

  r.negocio("POST", "/clientes/:id/deudas", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ saldo: number }>("select app.registrar_deuda_cliente($1, $2, $3, $4) as saldo", [
      uuid(p.params.id, "El cliente"), numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      texto(c.concepto, "El concepto", { max: 200 }), fecha(c.fecha_pago, "La fecha de pago")]);
    return { status: 201, cuerpo: { saldo: rows[0]!.saldo } };
  });

  r.negocio("POST", "/deudas-proveedor", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.registrar_deuda_proveedor($1, $2, $3, $4) as id", [
      uuid(c.proveedor_id, "El proveedor"), numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      texto(c.concepto, "El concepto", { max: 200 }), fecha(c.vence, "La fecha de pago")]);
    return { status: 201, cuerpo: { deuda: { id: rows[0]!.id } } };
  });

  r.negocio("POST", "/deudas-proveedor/:id/pagar", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ saldo: number }>("select app.pagar_deuda_proveedor($1, $2, $3) as saldo", [
      uuid(p.params.id, "La deuda"), numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      opcion(c.metodo ?? "efectivo", "La forma de pago", ["efectivo", "transferencia", "tarjeta"] as const)]);
    return { saldo: rows[0]!.saldo };
  });

  // ---------- Logo del negocio ----------

  r.negocio("POST", "/negocio/logo", async (p, { db, rol }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido();
    const { tipo, datos } = imagen(objeto(p.cuerpo), 200_000);
    await db.query(
      `insert into app.negocio_logo (negocio_id, tipo, datos) values (app.negocio_actual(), $1, $2)
       on conflict (negocio_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_en = now()`, [tipo, datos]);
    const { rows } = await db.query<{ v: number }>(
      "update app.negocio_config set logo_version = coalesce(logo_version, 0) + 1 where negocio_id = app.negocio_actual() returning logo_version as v");
    return { status: 201, cuerpo: { logo_version: rows[0]!.v } };
  });

  r.negocio("DELETE", "/negocio/logo", async (_p, { db, rol }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido();
    await db.query("delete from app.negocio_logo where negocio_id = app.negocio_actual()");
    await db.query("update app.negocio_config set logo_version = null where negocio_id = app.negocio_actual()");
    return { quitado: true };
  });

  r.publico("GET", "/logo/:negocio", async (p) => {
    const id = p.params.negocio!;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw noEncontrado("Logo no encontrado");
    const { rows } = await dep.pool.query<{ tipo: string; datos: Buffer }>("select * from app.logo_publico($1)", [id]);
    if (!rows[0]) throw noEncontrado("Logo no encontrado");
    return { crudo: { tipo: rows[0].tipo, cuerpo: rows[0].datos, cache: p.query.get("v") ? "public, max-age=31536000, immutable" : "public, max-age=300" } };
  });

  // ---------- Combos ----------

  r.negocio("GET", "/productos/:id/combo", async (p, { db }) => {
    const { rows } = await db.query(
      `select r.insumo_id as producto_id, i.nombre, r.cantidad, i.precio, i.costo, i.stock
       from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = $1 order by i.nombre`, [uuid(p.params.id, "El producto")]);
    return { componentes: rows };
  });

  r.negocio("POST", "/productos/:id/combo", async (p, { db }) => {
    const componentes = lista(objeto(p.cuerpo).componentes, "Los productos del combo", { min: 1, max: 30 }).map((x) => {
      const c = objeto(x, "Producto del combo");
      return { producto_id: uuid(c.producto_id, "El producto"), cantidad: numero(c.cantidad ?? 1, "La cantidad", { min: 0.001, max: 1000, decimales: 3 }) };
    });
    const { rows } = await db.query<{ costo: number }>("select app.guardar_combo($1, $2::jsonb) as costo", [uuid(p.params.id, "El producto"), componentes]);
    return { costo: rows[0]!.costo };
  });

  r.negocio("DELETE", "/productos/:id/combo", async (p, { db }) => {
    await db.query("select app.deshacer_combo($1)", [uuid(p.params.id, "El producto")]);
    return { quitado: true };
  });

  // ---------- Tus negocios (sucursales) ----------

  r.sesion("GET", "/mis-negocios/resumen", async (p) => {
    const { rows } = await dep.pool.query<{ negocio_id: string; nombre: string; rol: string }>("select * from app.mis_negocios($1)", [p.usuarioId]);
    const resumen = [];
    for (const n of rows.slice(0, 20)) {
      if (n.rol !== "dueno" && n.rol !== "administrador") { resumen.push({ ...n, ventas: null, total: null }); continue; }
      const r = await dep.pool.enNegocio(p.usuarioId!, n.negocio_id, async ({ db }) => {
        const { rows: h } = await db.query<{ ventas: number; total: number }>("select ventas, total from app.resumen_hoy()");
        const { rows: m } = await db.query<{ total: number }>(
          `select coalesce(sum(total), 0) as total from app.venta v join app.negocio n on n.id = v.negocio_id
           where v.estado <> 'anulada' and v.creado_en >= date_trunc('month', now() at time zone n.zona_horaria) at time zone n.zona_horaria`);
        return { ventas: Number(h[0]!.ventas), total: Number(h[0]!.total), mes: Number(m[0]!.total) };
      });
      resumen.push({ ...n, ...r });
    }
    return { negocios: resumen };
  });

  // ---------- Jornada de empleados ----------

  r.negocio("GET", "/jornada", async (_p, { db, usuarioId }) => {
    const { rows } = await db.query("select id, entrada from app.jornada where usuario_id = $1 and salida is null", [usuarioId]);
    return { abierta: rows[0] ?? null };
  });

  r.negocio("POST", "/jornada", async (_p, { db }) => {
    const { rows } = await db.query<{ j: unknown }>("select app.marcar_jornada() as j");
    return { status: 201, cuerpo: { jornada: rows[0]!.j } };
  });

  /** Horas trabajadas y ventas por empleado en el periodo. */
  r.negocio("GET", "/jornadas", async (p, ctx) => {
    if (!puede(ctx, "reportes")) throw prohibido("Solo el dueño o un administrador ven el horario del equipo");
    const hasta = fecha(p.query.get("hasta"), "Hasta") ?? hoyEc();
    const desde = fecha(p.query.get("desde"), "Desde") ?? hasta;
    const { rows } = await ctx.db.query(
      `with rango as (
         select ($1::date::timestamp at time zone n.zona_horaria) as ini, (($2::date + 1)::timestamp at time zone n.zona_horaria) as fin
         from app.negocio n where n.id = app.negocio_actual())
       select u.id, coalesce(u.nombre, u.celular) as nombre, m.rol,
              round(coalesce(sum(extract(epoch from coalesce(j.salida, now()) - j.entrada) / 3600), 0)::numeric, 2) as horas,
              count(j.id)::int as jornadas,
              bool_or(j.salida is null) as trabajando,
              (select count(*)::int from app.venta v, rango where v.vendedor_id = u.id and v.estado <> 'anulada' and v.creado_en >= rango.ini and v.creado_en < rango.fin) as ventas,
              (select coalesce(sum(v.total), 0) from app.venta v, rango where v.vendedor_id = u.id and v.estado <> 'anulada' and v.creado_en >= rango.ini and v.creado_en < rango.fin) as vendido,
              (select count(*)::int from app.venta v, rango where v.anulada_por = u.id and v.anulada_en >= rango.ini and v.anulada_en < rango.fin) as anulaciones
       from app.membresia m join auth.usuario u on u.id = m.usuario_id
       left join app.jornada j on j.usuario_id = u.id and j.entrada >= (select ini from rango) and j.entrada < (select fin from rango)
       where m.activo group by u.id, m.rol order by horas desc, nombre`, [desde, hasta]);
    const { rows: detalle } = await ctx.db.query(
      `select j.id, coalesce(u.nombre, u.celular) as nombre, j.entrada, j.salida
       from app.jornada j join auth.usuario u on u.id = j.usuario_id join app.negocio n on n.id = j.negocio_id
       where j.entrada >= ($1::date::timestamp at time zone n.zona_horaria) and j.entrada < (($2::date + 1)::timestamp at time zone n.zona_horaria)
       order by j.entrada desc limit 300`, [desde, hasta]);
    return { equipo: rows, jornadas: detalle, desde, hasta };
  });

  // Notas cortas del cliente en la deuda (el concepto) salen en /clientes/:id; aquí, la fecha de pago de un proveedor
  r.negocio("PATCH", "/deudas-proveedor/:id", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const res = await db.query("update app.deuda_proveedor set vence = $2, concepto = coalesce($3, concepto) where id = $1 and estado = 'pendiente'", [
      uuid(p.params.id, "La deuda"), fecha(c.vence, "La fecha de pago"), textoOpcional(c.concepto, "El concepto", { max: 200 })]);
    if (!res.rowCount) throw noEncontrado("Deuda no encontrada");
    return { guardada: true };
  });
}
