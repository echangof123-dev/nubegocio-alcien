/**
 * Tanda 4 de módulos (servicios): profesionales, citas y agenda (M11), comisiones (M12),
 * órdenes de trabajo (M13), reservas por fecha (M26) y membresías (M22).
 */
import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import type { ServicioSri } from "../sri/servicio.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import { booleano, lista, numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional } from "../http/validar.js";
import { facturarSiToca, leerComprobante, leerPagos } from "./comun.js";

const h = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soloGestion = (rol: string) => {
  if (rol !== "dueno" && rol !== "administrador") throw prohibido("Solo el dueño o un administrador pueden cambiar esto");
};

function fechaHora(v: unknown, campo: string): string {
  const t = texto(v, campo, { max: 40 });
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw invalido(`${campo} no es una fecha válida`);
  return d.toISOString();
}
function fechaOpcional(v: unknown, campo: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  const t = texto(v, campo, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw invalido(`${campo} no es una fecha válida`);
  return t;
}
function itemsSimples(v: unknown, conPrecio = false) {
  return lista(v, "Los productos", { min: 1, max: 100 }).map((x, i) => {
    const it = objeto(x, `Producto ${i + 1}`);
    const r: Record<string, unknown> = {
      producto_id: uuid(it.producto_id, `Producto ${i + 1}`),
      cantidad: numeroOpcional(it.cantidad, `La cantidad del producto ${i + 1}`, { min: 0.001, max: 10_000, decimales: 3 }) ?? 1,
    };
    if (conPrecio) {
      const precio = numeroOpcional(it.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 });
      if (precio !== null) r.precio = precio;
      r.tipo = it.tipo === "mano_obra" ? "mano_obra" : "repuesto";
    }
    return r;
  });
}

const ESTADOS_CITA = ["agendada", "confirmada", "atendida", "no_vino", "cancelada"] as const;
const ESTADOS_ORDEN = ["recibida", "diagnostico", "esperando_repuesto", "en_reparacion", "lista", "entregada", "cancelada"] as const;
const ESTADOS_RESERVA = ["reservada", "confirmada", "en_curso", "finalizada", "cancelada"] as const;

export function rutasServicios(r: Router, dep: { pool: Pool; sri: ServicioSri }) {
  // ---------- Profesionales ----------

  r.negocio("GET", "/profesionales", async (_p, { db }) => {
    const { rows } = await db.query(
      `select pr.id, pr.nombre, pr.celular, pr.comision_pct, pr.color, pr.activo,
              coalesce((select sum(monto) from app.comision c where c.profesional_id = pr.id and c.estado = 'pendiente'), 0) as por_pagar
       from app.profesional pr order by pr.activo desc, pr.nombre`);
    return { profesionales: rows };
  });

  r.negocio("POST", "/profesionales", async (p, { db, rol }) => {
    soloGestion(rol);
    const c = objeto(p.cuerpo);
    const { rows } = await db.query(
      `insert into app.profesional (negocio_id, nombre, celular, comision_pct, color)
       values (app.negocio_actual(), $1, $2, $3, coalesce($4, '#1847c2')) returning id, nombre, comision_pct, color, activo`,
      [texto(c.nombre, "El nombre", { max: 80 }), textoOpcional(c.celular, "El celular", { max: 20 }),
       numeroOpcional(c.comision_pct, "La comisión", { min: 0, max: 100, decimales: 2 }) ?? 0,
       typeof c.color === "string" && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : null]);
    return { status: 201, cuerpo: { profesional: rows[0] } };
  });

  r.negocio("PATCH", "/profesionales/:id", async (p, { db, rol }) => {
    soloGestion(rol);
    const c = objeto(p.cuerpo);
    const res = await db.query(
      `update app.profesional set nombre = coalesce($2, nombre), comision_pct = coalesce($3, comision_pct),
         activo = coalesce($4, activo), celular = coalesce($5, celular) where id = $1`,
      [uuid(p.params.id, "El profesional"), textoOpcional(c.nombre, "El nombre", { max: 80 }),
       numeroOpcional(c.comision_pct, "La comisión", { min: 0, max: 100, decimales: 2 }),
       c.activo === undefined ? null : booleano(c.activo, "Activo"), textoOpcional(c.celular, "El celular", { max: 20 })]);
    if (!res.rowCount) throw noEncontrado("Profesional no encontrado");
    return { guardado: true };
  });

  // ---------- Comisiones ----------

  r.negocio("GET", "/comisiones", async (p, { db, rol }) => {
    soloGestion(rol);
    const prof = uuidOpcional(p.query.get("profesional") ?? undefined, "El profesional");
    const { rows: resumen } = await db.query(
      `select pr.id, pr.nombre,
              coalesce(sum(c.monto) filter (where c.estado = 'pendiente'), 0) as pendiente,
              coalesce(sum(c.monto) filter (where c.estado = 'pagada' and c.pagada_en >= date_trunc('month', now())), 0) as pagado_mes,
              coalesce(sum(c.base) filter (where c.estado <> 'anulada' and c.creado_en >= date_trunc('month', now())), 0) as vendido_mes
       from app.profesional pr left join app.comision c on c.profesional_id = pr.id
       group by pr.id order by pr.nombre`);
    const { rows: detalle } = await db.query(
      `select c.id, c.descripcion, c.base, c.pct, c.monto, c.estado, c.creado_en, v.numero as venta_numero, pr.nombre as profesional
       from app.comision c join app.profesional pr on pr.id = c.profesional_id join app.venta v on v.id = c.venta_id
       where ($1::uuid is null or c.profesional_id = $1) order by c.creado_en desc limit 200`, [prof]);
    return { resumen, detalle };
  });

  r.negocio("POST", "/profesionales/:id/pagar", async (p, { db }) => {
    const c = objeto(p.cuerpo ?? {});
    const metodo = c.metodo === undefined ? "efectivo" : opcion(c.metodo, "El método", ["efectivo", "transferencia"] as const);
    const { rows } = await db.query<{ total: number }>("select app.pagar_comisiones($1, $2) as total", [uuid(p.params.id, "El profesional"), metodo]);
    return { pagado: rows[0]!.total };
  });

  // ---------- Citas ----------

  r.negocio("GET", "/citas", async (p, { db }) => {
    const desde = fechaOpcional(p.query.get("desde") ?? undefined, "Desde") ?? new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const dias = Math.min(31, Math.max(1, Number(p.query.get("dias") ?? 1) || 1));
    const { rows } = await db.query(
      `select c.id, c.nombre, c.celular, c.inicio, c.fin, c.estado, c.nota, c.venta_id, c.cliente_id,
              c.profesional_id, pr.nombre as profesional, pr.color,
              c.servicio_id, s.nombre as servicio, s.precio as servicio_precio
       from app.cita c left join app.profesional pr on pr.id = c.profesional_id left join app.producto s on s.id = c.servicio_id
       where c.inicio >= ($1::date::timestamp at time zone 'America/Guayaquil')
         and c.inicio < (($1::date + $2::int)::timestamp at time zone 'America/Guayaquil')
       order by c.inicio`, [desde, dias]);
    return { citas: rows, desde };
  });

  r.negocio("POST", "/citas", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.agendar_cita($1::jsonb) as id", [{
      cliente_id: uuidOpcional(c.cliente_id, "El cliente"),
      nombre: textoOpcional(c.nombre, "El nombre", { max: 120 }),
      celular: textoOpcional(c.celular, "El celular", { max: 20 }),
      profesional_id: uuidOpcional(c.profesional_id, "El profesional"),
      servicio_id: uuidOpcional(c.servicio_id, "El servicio"),
      inicio: fechaHora(c.inicio, "La hora"),
      duracion_min: numeroOpcional(c.duracion_min, "La duración", { min: 5, max: 1440, decimales: 0 }),
      nota: textoOpcional(c.nota, "La nota", { max: 300 }),
    }]);
    return { status: 201, cuerpo: { cita: { id: rows[0]!.id } } };
  });

  r.negocio("PATCH", "/citas/:id", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    await db.query("select app.cambiar_cita($1, $2, $3)", [
      uuid(p.params.id, "La cita"), opcion(c.estado, "El estado", ESTADOS_CITA),
      c.inicio === undefined ? null : fechaHora(c.inicio, "La hora")]);
    return { guardada: true };
  });

  r.negocio("POST", "/citas/:id/cobrar", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const items = c.items === undefined || (Array.isArray(c.items) && !c.items.length) ? [] : itemsSimples(c.items);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.cobrar_cita($1, $2::jsonb, $3::jsonb, $4)",
      [uuid(p.params.id, "La cita"), items, leerPagos(c.pagos), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  // ---------- Órdenes de trabajo ----------

  r.negocio("GET", "/ordenes", async (p, { db }) => {
    const estado = p.query.get("estado");
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const { rows } = await db.query(
      `select o.id, o.numero, o.nombre, o.celular, o.equipo, o.identificador, o.problema, o.estado, o.fecha_prometida,
              o.creado_en, o.venta_id, t.nombre as tecnico,
              coalesce((select sum(round(i.cantidad * i.precio, 2)) from app.orden_item i where i.orden_id = o.id), 0) as total
       from app.orden o left join app.profesional t on t.id = o.tecnico_id
       where ($1::text is null or ($1 = 'abiertas' and o.estado not in ('entregada', 'cancelada')) or o.estado = $1)
         and ($2 = '' or o.numero::text = $2 or o.nombre ilike '%' || $2 || '%' or o.equipo ilike '%' || $2 || '%'
              or o.identificador ilike '%' || $2 || '%')
       order by o.creado_en desc limit 200`, [estado, q]);
    return { ordenes: rows };
  });

  r.negocio("GET", "/ordenes/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "La orden");
    const { rows } = await db.query(
      `select o.*, t.nombre as tecnico from app.orden o left join app.profesional t on t.id = o.tecnico_id where o.id = $1`, [id]);
    if (!rows[0]) throw noEncontrado("Orden no encontrada");
    const { rows: items } = await db.query(
      "select id, producto_id, nombre, tipo, cantidad, precio, round(cantidad * precio, 2) as total from app.orden_item where orden_id = $1 order by id", [id]);
    const { rows: historial } = await db.query(
      "select estado, nota, creado_en from app.orden_evento where orden_id = $1 order by id", [id]);
    return { orden: rows[0], items, historial };
  });

  r.negocio("POST", "/ordenes", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.crear_orden($1::jsonb) as id", [{
      cliente_id: uuidOpcional(c.cliente_id, "El cliente"),
      nombre: textoOpcional(c.nombre, "El nombre", { max: 120 }),
      celular: textoOpcional(c.celular, "El celular", { max: 20 }),
      equipo: texto(c.equipo, "El equipo", { max: 120 }),
      identificador: textoOpcional(c.identificador, "La placa o serie", { max: 60 }),
      problema: texto(c.problema, "El problema", { max: 500 }),
      tecnico_id: uuidOpcional(c.tecnico_id, "El técnico"),
      fecha_prometida: fechaOpcional(c.fecha_prometida, "La fecha de entrega"),
    }]);
    const { rows: o } = await db.query("select id, numero, token_publico from app.orden where id = $1", [rows[0]!.id]);
    return { status: 201, cuerpo: { orden: o[0] } };
  });

  r.negocio("POST", "/ordenes/:id/estado", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    await db.query("select app.estado_orden($1, $2, $3, $4)", [
      uuid(p.params.id, "La orden"), opcion(c.estado, "El estado", ESTADOS_ORDEN),
      textoOpcional(c.nota, "La nota", { max: 300 }), textoOpcional(c.diagnostico, "El diagnóstico", { max: 1000 })]);
    return { guardado: true };
  });

  r.negocio("POST", "/ordenes/:id/items", async (p, { db }) => {
    await db.query("select app.agregar_a_orden($1, $2::jsonb)", [uuid(p.params.id, "La orden"), itemsSimples(objeto(p.cuerpo).items, true)]);
    return { status: 201, cuerpo: { agregado: true } };
  });

  r.negocio("DELETE", "/ordenes/:id/items/:item", async (p, { db }) => {
    const res = await db.query(
      `delete from app.orden_item i using app.orden o
       where i.id = $2 and i.orden_id = $1 and o.id = i.orden_id and o.venta_id is null and o.estado not in ('entregada', 'cancelada')`,
      [uuid(p.params.id, "La orden"), numero(Number(p.params.item), "La línea", { min: 1, decimales: 0 })]);
    if (!res.rowCount) throw noEncontrado("No se pudo quitar esa línea");
    return { quitado: true };
  });

  r.negocio("POST", "/ordenes/:id/cobrar", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.cobrar_orden($1, $2::jsonb, $3)",
      [uuid(p.params.id, "La orden"), leerPagos(c.pagos), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  // Seguimiento público de la orden (el cliente lo abre desde WhatsApp)
  r.publico("GET", "/o/:token", async (p) => {
    const token = p.params.token!;
    if (!/^[0-9a-f]{36}$/.test(token)) throw noEncontrado("Orden no encontrada");
    const { rows } = await dep.pool.query<{ o: Record<string, any> | null }>("select app.orden_publica($1) as o", [token]);
    const o = rows[0]?.o;
    if (!o) throw noEncontrado("Orden no encontrada");
    const NOMBRES: Record<string, string> = {
      recibida: "Recibida", diagnostico: "En diagnóstico", esperando_repuesto: "Esperando repuesto", en_reparacion: "En reparación",
      lista: "Lista para retirar", entregada: "Entregada", cancelada: "Cancelada",
    };
    const dinero = (n: unknown) => "$ " + Number(n ?? 0).toFixed(2).replace(".", ",");
    const fecha = (d: unknown) => new Date(String(d)).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "medium", timeStyle: "short" });
    const items = (o.items ?? []) as { nombre: string; cantidad: number; precio: number }[];
    const historial = (o.historial ?? []) as { estado: string; nota: string | null; fecha: string }[];
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Orden N.º ${h(o.numero)} · ${h(o.negocio)}</title>
<style>
  body{margin:0;padding:16px;background:#f3f5f9;color:#0b1b33;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .hoja{max-width:560px;margin:0 auto;background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:20px}
  h1{font-size:18px;margin:0}.suave{color:#5b6b82}.estado{display:inline-block;margin:12px 0;padding:6px 12px;border-radius:999px;background:#e7eefc;color:#1847c2;font-weight:700}
  .estado.lista{background:#dcf5e6;color:#11703b}ol{padding-left:18px}li{margin:6px 0}table{width:100%;border-collapse:collapse;margin-top:8px}
  td{padding:6px 2px;border-bottom:1px solid #d9e0ea}.n{text-align:right;white-space:nowrap}
</style></head><body><main class="hoja">
<h1>${h(o.negocio)}</h1><div class="suave">Orden de trabajo N.º ${h(o.numero)} · recibida ${h(fecha(o.recibida))}</div>
<div class="estado${o.estado === "lista" ? " lista" : ""}">${h(NOMBRES[o.estado] ?? o.estado)}</div>
<p><strong>${h(o.equipo)}</strong>${o.identificador ? ` · ${h(o.identificador)}` : ""}<br><span class="suave">${h(o.problema)}</span></p>
${o.diagnostico ? `<p><strong>Diagnóstico:</strong> ${h(o.diagnostico)}</p>` : ""}
${o.fecha_prometida ? `<p class="suave">Entrega estimada: ${h(o.fecha_prometida)}</p>` : ""}
${items.length ? `<table>${items.map((i) => `<tr><td>${h(Number(i.cantidad) !== 1 ? `${Number(i.cantidad)} × ` : "")}${h(i.nombre)}</td><td class="n">${h(dinero(i.cantidad * i.precio))}</td></tr>`).join("")}
<tr><td><strong>Total</strong></td><td class="n"><strong>${h(dinero(o.total))}</strong></td></tr></table>` : ""}
<h2 style="font-size:15px;margin-top:20px">Historial</h2>
<ol>${historial.map((e) => `<li>${h(NOMBRES[e.estado] ?? e.estado)} <span class="suave">· ${h(fecha(e.fecha))}</span>${e.nota ? `<br><span class="suave">${h(e.nota)}</span>` : ""}</li>`).join("")}</ol>
</main></body></html>`;
    return { crudo: { tipo: "text/html; charset=utf-8", cuerpo: html } };
  });

  // ---------- Reservas ----------

  r.negocio("GET", "/recursos", async (_p, { db }) => {
    const { rows } = await db.query("select id, nombre, tipo, unidad, precio, capacidad, activo from app.recurso order by activo desc, nombre");
    return { recursos: rows };
  });

  r.negocio("POST", "/recursos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.crear_recurso($1, $2, $3, $4, $5) as id", [
      texto(c.nombre, "El nombre", { max: 80 }), textoOpcional(c.tipo, "El tipo", { max: 40 }),
      opcion(c.unidad ?? "noche", "Se cobra por", ["noche", "dia", "hora"] as const),
      numero(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 }),
      numeroOpcional(c.capacidad, "La capacidad", { min: 1, max: 10_000, decimales: 0 })]);
    return { status: 201, cuerpo: { recurso: { id: rows[0]!.id } } };
  });

  r.negocio("GET", "/reservas", async (p, { db }) => {
    const desde = fechaOpcional(p.query.get("desde") ?? undefined, "Desde") ?? new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const dias = Math.min(62, Math.max(1, Number(p.query.get("dias") ?? 14) || 14));
    const { rows } = await db.query(
      `select v.id, v.numero, v.recurso_id, rc.nombre as recurso, rc.unidad, v.nombre, v.celular, v.desde, v.hasta, v.unidades,
              v.precio, v.total, v.estado, v.personas, v.nota, v.venta_id
       from app.reserva v join app.recurso rc on rc.id = v.recurso_id
       where v.hasta > ($1::date::timestamp at time zone 'America/Guayaquil')
         and v.desde < (($1::date + $2::int)::timestamp at time zone 'America/Guayaquil')
       order by v.desde`, [desde, dias]);
    return { reservas: rows, desde, dias };
  });

  r.negocio("POST", "/reservas", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.reservar($1::jsonb) as id", [{
      recurso_id: uuid(c.recurso_id, "Lo que se reserva"),
      cliente_id: uuidOpcional(c.cliente_id, "El cliente"),
      nombre: textoOpcional(c.nombre, "El nombre", { max: 120 }),
      celular: textoOpcional(c.celular, "El celular", { max: 20 }),
      desde: fechaHora(c.desde, "Desde"), hasta: fechaHora(c.hasta, "Hasta"),
      personas: numeroOpcional(c.personas, "Las personas", { min: 1, max: 10_000, decimales: 0 }),
      nota: textoOpcional(c.nota, "La nota", { max: 300 }),
      precio: numeroOpcional(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 }),
    }]);
    const { rows: v } = await db.query("select id, numero, unidades, total from app.reserva where id = $1", [rows[0]!.id]);
    return { status: 201, cuerpo: { reserva: v[0] } };
  });

  r.negocio("POST", "/reservas/:id/estado", async (p, { db }) => {
    await db.query("select app.estado_reserva($1, $2)", [uuid(p.params.id, "La reserva"), opcion(objeto(p.cuerpo).estado, "El estado", ESTADOS_RESERVA)]);
    return { guardado: true };
  });

  r.negocio("POST", "/reservas/:id/cobrar", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.cobrar_reserva($1, $2::jsonb, $3)",
      [uuid(p.params.id, "La reserva"), leerPagos(c.pagos), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  // ---------- Membresías ----------

  r.negocio("GET", "/planes-membresia", async (_p, { db }) => {
    const { rows } = await db.query(
      `select pl.id, pl.nombre, pl.precio, pl.duracion_dias, pl.sesiones, pl.activo,
              (select count(*)::int from app.membresia_cliente m where m.plan_id = pl.id and m.estado = 'activa' and m.hasta >= current_date) as vigentes
       from app.plan_membresia pl order by pl.activo desc, pl.precio`);
    return { planes: rows };
  });

  r.negocio("POST", "/planes-membresia", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.crear_plan_membresia($1, $2, $3, $4) as id", [
      texto(c.nombre, "El nombre", { max: 80 }), numero(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 }),
      numero(c.duracion_dias, "La duración", { min: 1, max: 3660, decimales: 0 }),
      numeroOpcional(c.sesiones, "Las sesiones", { min: 1, max: 10_000, decimales: 0 })]);
    return { status: 201, cuerpo: { plan: { id: rows[0]!.id } } };
  });

  /** Socios con su membresía más reciente: vigente, por vencer o vencida. */
  r.negocio("GET", "/socios", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const { rows } = await db.query(
      `select distinct on (c.id) c.id as cliente_id, c.nombre, c.celular, m.id as membresia_id, pl.nombre as plan, m.desde, m.hasta,
              m.sesiones_restantes,
              case when m.hasta < (now() at time zone 'America/Guayaquil')::date then 'vencida'
                   when m.sesiones_restantes = 0 then 'sin_sesiones'
                   when m.hasta <= (now() at time zone 'America/Guayaquil')::date + 5 then 'por_vencer'
                   else 'vigente' end as situacion,
              (select max(a.creado_en) from app.asistencia a where a.cliente_id = c.id) as ultima_visita
       from app.membresia_cliente m join app.cliente c on c.id = m.cliente_id join app.plan_membresia pl on pl.id = m.plan_id
       where m.estado = 'activa'
         and ($1 = '' or catalogo.normalizar(c.nombre) like '%' || catalogo.normalizar($1) || '%' or c.celular like '%' || $1 || '%')
       order by c.id, m.hasta desc`, [q]);
    rows.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
    return { socios: rows };
  });

  r.negocio("POST", "/membresias", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.vender_membresia($1, $2, $3::jsonb, $4)", [
      uuid(c.cliente_id, "El cliente"), uuid(c.plan_id, "El plan"), leerPagos(c.pagos), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  r.negocio("POST", "/asistencias", async (p, { db }) => {
    const { rows } = await db.query<{ r: Record<string, unknown> }>("select app.registrar_asistencia($1) as r", [uuid(objeto(p.cuerpo).cliente_id, "El cliente")]);
    return { status: 201, cuerpo: { asistencia: rows[0]!.r } };
  });

  r.negocio("GET", "/asistencias", async (_p, { db }) => {
    const { rows } = await db.query(
      `select a.id, a.creado_en, c.nombre from app.asistencia a join app.cliente c on c.id = a.cliente_id
       where a.creado_en >= (now() at time zone 'America/Guayaquil')::date::timestamp at time zone 'America/Guayaquil'
       order by a.creado_en desc limit 300`);
    return { asistencias: rows };
  });
}
