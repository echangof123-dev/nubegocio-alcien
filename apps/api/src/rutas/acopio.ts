/**
 * Tanda 5 de módulos: compras a productores / acopio (M25) y reportes por periodo (M21).
 */
import type { Router } from "../http/servidor.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import { numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid } from "../http/validar.js";
import { clasificar } from "../sri/identificacion.js";

const h = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soloGestion = (rol: string) => {
  if (rol !== "dueno" && rol !== "administrador") throw prohibido("Solo el dueño o un administrador ven esto");
};
const fechaIso = (v: string | null, campo: string, defecto: string) => {
  const t = v ?? defecto;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw invalido(`${campo} no es una fecha válida`);
  return t;
};
const hoyEc = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const num = (n: unknown, d = 2) => Number(n ?? 0).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
/** 2 decimales, salvo que el precio tenga fracciones de centavo */
const decimalesPrecio = (p: unknown) => (Math.abs(Number(p) * 100 - Math.round(Number(p) * 100)) > 1e-6 ? 4 : 2);

export function rutasAcopio(r: Router) {
  // ---------- Productores y anticipos ----------

  r.negocio("GET", "/productores", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const { rows } = await db.query(
      `select pr.id, pr.nombre, pr.ruc as cedula, pr.celular,
              coalesce((select sum(saldo) from app.anticipo a where a.proveedor_id = pr.id and a.estado = 'vigente'), 0) as anticipo,
              coalesce((select sum(total - pagado) from app.compra c where c.proveedor_id = pr.id and c.estado = 'recibida'), 0) as por_pagar,
              (select max(creado_en) from app.acopio a where a.proveedor_id = pr.id and a.estado = 'vigente') as ultima_entrega
       from app.proveedor pr
       where pr.activo and pr.es_productor
         and ($1 = '' or catalogo.normalizar(pr.nombre) like '%' || catalogo.normalizar($1) || '%' or pr.ruc like $1 || '%')
       order by pr.nombre limit 300`, [q]);
    return { productores: rows };
  });

  r.negocio("POST", "/productores", async (p, { db }) => {
    await db.query("select app.exigir_modulo('M25')");
    const c = objeto(p.cuerpo);
    const cedula = textoOpcional(c.cedula, "La cédula o RUC", { max: 13 });
    if (cedula && !clasificar(cedula)) throw invalido("La cédula o el RUC no es válido");
    const { rows } = await db.query(
      `insert into app.proveedor (negocio_id, nombre, ruc, celular, es_productor) values (app.negocio_actual(), $1, $2, $3, true)
       on conflict (negocio_id, nombre) do update set es_productor = true, ruc = coalesce(excluded.ruc, app.proveedor.ruc),
         celular = coalesce(excluded.celular, app.proveedor.celular), activo = true
       returning id, nombre, ruc as cedula, celular`,
      [texto(c.nombre, "El nombre", { max: 120 }), cedula, textoOpcional(c.celular, "El celular", { max: 20 })]);
    return { status: 201, cuerpo: { productor: { ...rows[0], anticipo: 0, por_pagar: 0 } } };
  });

  r.negocio("GET", "/anticipos", async (p, { db }) => {
    const { rows } = await db.query(
      `select a.id, a.monto, a.saldo, a.metodo, a.nota, a.creado_en, pr.nombre as productor
       from app.anticipo a join app.proveedor pr on pr.id = a.proveedor_id
       where a.estado = 'vigente' and ($1::uuid is null or a.proveedor_id = $1)
       order by a.creado_en desc limit 200`, [p.query.get("productor") ? uuid(p.query.get("productor"), "El productor") : null]);
    return { anticipos: rows };
  });

  r.negocio("POST", "/anticipos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.dar_anticipo($1, $2, $3, $4) as id", [
      uuid(c.productor_id, "El productor"), numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      c.metodo === undefined ? "efectivo" : opcion(c.metodo, "La forma de pago", ["efectivo", "transferencia"] as const),
      textoOpcional(c.nota, "La nota", { max: 200 })]);
    return { status: 201, cuerpo: { anticipo: { id: rows[0]!.id } } };
  });

  // ---------- Qué se acopia: humedad de referencia y precio del día ----------

  r.negocio("GET", "/acopio/productos", async (_p, { db }) => {
    const { rows } = await db.query(
      `select p.id, p.nombre, p.unidad, p.stock, p.costo, ap.humedad_base, ap.precio_dia, ap.actualizado_en
       from app.acopio_producto ap join app.producto p on p.id = ap.producto_id where p.activo order by p.nombre`);
    return { productos: rows };
  });

  r.negocio("POST", "/acopio/productos", async (p, { db, rol }) => {
    soloGestion(rol);
    await db.query("select app.exigir_modulo('M25')");
    const c = objeto(p.cuerpo);
    await db.query(
      `insert into app.acopio_producto (producto_id, negocio_id, humedad_base, precio_dia) values ($1, app.negocio_actual(), $2, $3)
       on conflict (producto_id) do update set humedad_base = excluded.humedad_base, precio_dia = excluded.precio_dia, actualizado_en = now()`,
      [uuid(c.producto_id, "El producto"), numeroOpcional(c.humedad_base, "La humedad", { min: 0, max: 89, decimales: 2 }) ?? 0,
       numeroOpcional(c.precio_dia, "El precio del día", { min: 0, max: 1_000_000, decimales: 4 })]);
    return { guardado: true };
  });

  // ---------- Liquidaciones ----------

  r.negocio("GET", "/acopio", async (p, { db }) => {
    const desde = fechaIso(p.query.get("desde"), "Desde", hoyEc());
    const hasta = fechaIso(p.query.get("hasta"), "Hasta", desde);
    const { rows } = await db.query<Record<string, any>>(
      `select a.id, a.numero, a.creado_en, a.sacos, a.peso_bruto, a.tara, a.humedad, a.humedad_base, a.impureza, a.peso_neto,
              a.precio, a.total, a.descontado, a.pagado, a.estado, pr.nombre as productor, p.nombre as producto, p.unidad,
              (c.total - c.pagado) as por_pagar
       from app.acopio a join app.proveedor pr on pr.id = a.proveedor_id join app.producto p on p.id = a.producto_id
       join app.compra c on c.id = a.compra_id
       where a.creado_en >= ($1::date::timestamp at time zone 'America/Guayaquil')
         and a.creado_en < (($2::date + 1)::timestamp at time zone 'America/Guayaquil')
       order by a.creado_en desc`, [desde, hasta]);
    const vig = rows.filter((x) => x.estado === "vigente");
    const porProducto = new Map<string, { producto: string; unidad: string; neto: number; total: number }>();
    for (const x of vig) {
      const e = porProducto.get(x.producto) ?? { producto: x.producto, unidad: x.unidad, neto: 0, total: 0 };
      e.neto += Number(x.peso_neto); e.total += Number(x.total);
      porProducto.set(x.producto, e);
    }
    return { acopios: rows, resumen: [...porProducto.values()], desde, hasta };
  });

  r.negocio("POST", "/acopio", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const peso = (v: unknown, campo: string) => numeroOpcional(v, campo, { min: 0, max: 1_000_000, decimales: 3 });
    const pct = (v: unknown, campo: string) => numeroOpcional(v, campo, { min: 0, max: 89, decimales: 2 });
    const { rows } = await db.query("select * from app.registrar_acopio($1::jsonb)", [{
      proveedor_id: uuid(c.productor_id, "El productor"),
      producto_id: uuid(c.producto_id, "Lo que se compra"),
      sacos: numeroOpcional(c.sacos, "Los sacos", { min: 0, max: 100_000, decimales: 0 }),
      peso_bruto: numero(c.peso_bruto, "El peso bruto", { min: 0.001, max: 1_000_000, decimales: 3 }),
      tara: peso(c.tara, "La tara") ?? 0,
      humedad: pct(c.humedad, "La humedad") ?? 0,
      humedad_base: pct(c.humedad_base, "La humedad de referencia"),
      impureza: pct(c.impureza, "La impureza") ?? 0,
      precio: numeroOpcional(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 4 }),
      metodo: c.metodo === undefined ? "efectivo" : opcion(c.metodo, "La forma de pago", ["efectivo", "transferencia", "credito"] as const),
      descontar_anticipo: numeroOpcional(c.descontar_anticipo, "El anticipo a descontar", { min: 0, max: 1_000_000, decimales: 2 }) ?? 0,
      nota: textoOpcional(c.nota, "La nota", { max: 200 }),
    }]);
    return { status: 201, cuerpo: { acopio: rows[0] } };
  });

  r.negocio("POST", "/acopio/:id/anular", async (p, { db }) => {
    await db.query("select app.anular_acopio($1, $2)", [uuid(p.params.id, "La liquidación"), texto(objeto(p.cuerpo).motivo, "El motivo", { min: 3, max: 200 })]);
    return { anulado: true };
  });

  /** Comprobante de liquidación para imprimir o enviar al productor. */
  r.negocio("GET", "/acopio/:id/liquidacion", async (p, { db }) => {
    const { rows } = await db.query<Record<string, any>>(
      `select a.*, pr.nombre as productor, pr.ruc as cedula, p.nombre as producto, p.unidad, n.nombre as negocio, n.ruc as negocio_ruc,
              (c.total - c.pagado) as por_pagar
       from app.acopio a join app.proveedor pr on pr.id = a.proveedor_id join app.producto p on p.id = a.producto_id
       join app.compra c on c.id = a.compra_id join app.negocio n on n.id = a.negocio_id where a.id = $1`, [uuid(p.params.id, "La liquidación")]);
    const a = rows[0];
    if (!a) throw noEncontrado("Liquidación no encontrada");
    const u = String(a.unidad).toLowerCase();
    const fila = (t: string, v: string, fuerte = false) => `<tr><td>${h(t)}</td><td class="n">${fuerte ? `<strong>${h(v)}</strong>` : h(v)}</td></tr>`;
    const fecha = new Date(a.creado_en).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "medium", timeStyle: "short" });
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liquidación N.º ${h(a.numero)} · ${h(a.productor)}</title>
<style>
  body{margin:0;padding:16px;background:#f3f5f9;color:#0b1b33;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .hoja{max-width:480px;margin:0 auto;background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:20px}
  h1{font-size:17px;margin:0}.suave{color:#5b6b82}table{width:100%;border-collapse:collapse;margin-top:12px}
  td{padding:6px 2px;border-bottom:1px solid #eef1f6}.n{text-align:right;white-space:nowrap}.aviso{background:#fde8e8;padding:8px;border-radius:8px;font-weight:700}
  .firmas{display:flex;gap:24px;margin-top:48px}.firmas div{flex:1;border-top:1px solid #0b1b33;text-align:center;padding-top:4px;font-size:12px}
  @media print{body{background:#fff;padding:0}.hoja{border:0}}
</style></head><body><main class="hoja">
${a.estado === "anulado" ? '<p class="aviso">Liquidación anulada</p>' : ""}
<h1>${h(a.negocio)}</h1>${a.negocio_ruc ? `<div class="suave">RUC ${h(a.negocio_ruc)}</div>` : ""}
<p><strong>Liquidación de compra N.º ${h(a.numero)}</strong><br><span class="suave">${h(fecha)}</span></p>
<p>Productor: <strong>${h(a.productor)}</strong>${a.cedula ? ` · ${h(a.cedula)}` : ""}<br>Producto: ${h(a.producto)}</p>
<table>
${a.sacos != null ? fila("Sacos", String(a.sacos)) : ""}
${fila("Peso bruto", `${num(a.peso_bruto, 3)} ${u}`)}
${Number(a.tara) ? fila("Tara", `− ${num(a.tara, 3)} ${u}`) : ""}
${fila("Humedad", `${num(a.humedad)} % (referencia ${num(a.humedad_base)} %)`)}
${Number(a.impureza) ? fila("Impureza", `${num(a.impureza)} %`) : ""}
${fila("Peso neto", `${num(a.peso_neto, 3)} ${u}`, true)}
${fila("Precio", `$ ${num(a.precio, decimalesPrecio(a.precio))} por ${u}`)}
${fila("Total", `$ ${num(a.total)}`, true)}
${Number(a.descontado) ? fila("Anticipo descontado", `− $ ${num(a.descontado)}`) : ""}
${fila("Pagado", `$ ${num(a.pagado)}`)}
${Number(a.por_pagar) > 0 ? fila("Queda por pagar", `$ ${num(a.por_pagar)}`, true) : ""}
</table>
<div class="firmas"><div>Entregué conforme</div><div>Recibí conforme</div></div>
</main></body></html>`;
    return { crudo: { tipo: "text/html; charset=utf-8", cuerpo: html } };
  });

  // ---------- Reportes por periodo ----------

  r.negocio("GET", "/reportes", async (p, { db, rol }) => {
    soloGestion(rol);
    const hasta = fechaIso(p.query.get("hasta"), "Hasta", hoyEc());
    const desde = fechaIso(p.query.get("desde"), "Desde", hasta);
    const { rows } = await db.query<{ r: unknown }>("select app.reporte_periodo($1, $2) as r", [desde, hasta]);
    return { reporte: rows[0]!.r };
  });

  /** Detalle de ventas del periodo en CSV (se abre en Excel). */
  r.negocio("GET", "/reportes/ventas.csv", async (p, { db, rol }) => {
    soloGestion(rol);
    const hasta = fechaIso(p.query.get("hasta"), "Hasta", hoyEc());
    const desde = fechaIso(p.query.get("desde"), "Desde", hasta);
    const { rows } = await db.query<Record<string, unknown>>(
      `select to_char(v.creado_en at time zone n.zona_horaria, 'YYYY-MM-DD HH24:MI') as fecha, v.numero, v.estado,
              coalesce(cl.nombre, '') as cliente, coalesce(u.nombre, u.celular) as vendedor, d.nombre as producto,
              d.cantidad, d.precio_unitario, d.descuento, d.base, d.iva, d.total, d.costo_unitario,
              (select string_agg(distinct pg.metodo, '+') from app.pago pg where pg.venta_id = v.id) as pago
       from app.venta v join app.negocio n on n.id = v.negocio_id join app.venta_detalle d on d.venta_id = v.id
       left join app.cliente cl on cl.id = v.cliente_id left join auth.usuario u on u.id = v.vendedor_id
       where v.creado_en >= ($1::date::timestamp at time zone n.zona_horaria)
         and v.creado_en < (($2::date + 1)::timestamp at time zone n.zona_horaria)
       order by v.creado_en, d.id`, [desde, hasta]);
    const cols = ["fecha", "numero", "estado", "cliente", "vendedor", "producto", "cantidad", "precio_unitario", "descuento", "base", "iva", "total", "costo_unitario", "pago"];
    const celda = (v: unknown) => {
      const t = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
      return /[";\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t;
    };
    const csv = "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => celda(typeof r[c] === "string" && /^\d+\.\d+$/.test(r[c] as string) ? Number(r[c]) : r[c])).join(";"))].join("\r\n");
    return { crudo: { tipo: "text/csv; charset=utf-8", cuerpo: csv, descarga: `ventas-${desde}-a-${hasta}.csv` } };
  });
}
