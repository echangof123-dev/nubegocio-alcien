/**
 * Tanda 6 (paridad con Treinta): balance de ingresos y egresos, gastos, venta libre, recibo de cada
 * venta, historial de clientes, inventario (valor, stock bajo, movimientos, carga masiva) y fotos.
 */
import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import type { ServicioSri } from "../sri/servicio.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import { lista, numero, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional } from "../http/validar.js";
import { facturarSiToca, leerComprobante, leerPagos, puede } from "./comun.js";

const h = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hoyEc = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const fechaQ = (v: string | null, campo: string, defecto: string) => {
  const t = v ?? defecto;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw invalido(`${campo} no es una fecha válida`);
  return t;
};
const dinero = (n: unknown) => "$ " + Number(n ?? 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado" };

/** CSV con punto y coma (Excel en español) y protección contra fórmulas. */
export function csv(cols: string[], filas: Record<string, unknown>[]): string {
  const celda = (v: unknown) => {
    let t = v === null || v === undefined ? "" : String(v);
    if (/^-?\d+\.\d+$/.test(t)) t = t.replace(".", ",");
    if (/^[=+@]/.test(t) || (/^-/.test(t) && !/^-[\d,]+$/.test(t))) t = "'" + t;
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "﻿" + [cols.join(";"), ...filas.map((f) => cols.map((c) => celda(f[c])).join(";"))].join("\r\n");
}

export function rutasBalance(r: Router, dep: { pool: Pool; sri: ServicioSri }) {
  // ---------- Balance ----------

  r.negocio("GET", "/balance", async (p, ctx) => {
    const { db } = ctx;
    const hasta = fechaQ(p.query.get("hasta"), "Hasta", hoyEc());
    const desde = fechaQ(p.query.get("desde"), "Desde", hasta);
    // El cajero ve el balance del día (como su caja); periodos más largos, el dueño o el administrador
    if (!puede(ctx, "reportes") && (desde !== hoyEc() || hasta !== hoyEc())) throw prohibido("Solo el dueño o un administrador ven otros días");
    const { rows } = await db.query<{ b: unknown }>("select app.balance_periodo($1, $2) as b", [desde, hasta]);
    return { balance: rows[0]!.b };
  });

  // ---------- Gastos ----------

  r.negocio("GET", "/gastos", async (p, ctx) => {
    const { db, rol } = ctx;
    if (rol === "bodeguero" && !puede(ctx, "gastos")) throw prohibido();
    const hasta = fechaQ(p.query.get("hasta"), "Hasta", hoyEc());
    const desde = fechaQ(p.query.get("desde"), "Desde", hasta);
    const { rows } = await db.query(
      `select g.id, g.fecha, g.categoria, g.descripcion, g.monto, g.metodo, g.estado, g.creado_en,
              pr.nombre as proveedor, coalesce(u.nombre, u.celular) as registrado_por
       from app.gasto g left join app.proveedor pr on pr.id = g.proveedor_id left join auth.usuario u on u.id = g.creado_por
       where g.fecha between $1 and $2 order by g.fecha desc, g.creado_en desc limit 1000`, [desde, hasta]);
    return { gastos: rows, desde, hasta };
  });

  r.negocio("POST", "/gastos/:id/anular", async (p, { db }) => {
    await db.query("select app.anular_gasto($1)", [uuid(p.params.id, "El gasto")]);
    return { anulado: true };
  });

  // ---------- Venta libre ----------

  r.negocio("POST", "/ventas/libre", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.registrar_venta_libre($1, $2, $3::jsonb, $4, $5)", [
      numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }), textoOpcional(c.concepto, "El concepto", { max: 120 }),
      leerPagos(c.pagos), uuidOpcional(c.cliente_id, "El cliente"), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    const { rows: t } = await ctx.db.query<{ token_publico: string }>("select token_publico from app.venta where id = $1", [rows[0]!.venta_id]);
    return { status: 201, cuerpo: { venta: { ...rows[0], token: t[0]!.token_publico }, factura } };
  });

  // ---------- Recibo público (enlace para WhatsApp y ticket para imprimir) ----------

  r.publico("GET", "/r/:token", async (p) => {
    const token = p.params.token!;
    if (!/^[0-9a-f]{36}$/.test(token)) throw noEncontrado("Recibo no encontrado");
    const { rows } = await dep.pool.query<{ r: Record<string, any> | null }>("select app.recibo_publico($1) as r", [token]);
    const v = rows[0]?.r;
    if (!v) throw noEncontrado("Recibo no encontrado");
    const ancho = p.query.get("ancho") === "80" ? 80 : p.query.get("ancho") === "58" ? 58 : null;
    const imprimir = p.query.get("imprimir") === "1";
    const fecha = new Date(v.fecha).toLocaleString("es-EC", { timeZone: v.zona ?? "America/Guayaquil", dateStyle: "short", timeStyle: "short" });
    const lineas = (v.lineas ?? []) as { nombre: string; cantidad: number; precio: number; descuento: number; total: number }[];
    const pagos = (v.pagos ?? []) as { metodo: string; monto: number; recibido: number | null; vuelto: number }[];
    const vuelto = pagos.reduce((s, x) => s + Number(x.vuelto ?? 0), 0);
    const recibido = pagos.find((x) => x.metodo === "efectivo" && x.recibido)?.recibido;
    const cant = (n: number) => Number(n).toLocaleString("es-EC", { maximumFractionDigits: 3 });
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Recibo N.º ${h(v.numero)} · ${h(v.negocio)}</title>
<style>
  *{box-sizing:border-box}body{margin:0;padding:16px;background:#f3f5f9;color:#0b1b33;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .ticket{max-width:380px;margin:0 auto;background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:18px}
  h1{font-size:17px;margin:0;text-align:center}.logo{max-width:120px;max-height:70px;object-fit:contain;margin-bottom:6px;filter:grayscale(1)}.c{text-align:center}.suave{color:#5b6b82;font-size:12px}.sep{border-top:1px dashed #9aa6b8;margin:10px 0}
  table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}.n{text-align:right;white-space:nowrap;padding-left:8px}
  .total td{font-size:17px;font-weight:800;padding-top:6px}.anulada{background:#fde8e8;color:#9b1c1c;font-weight:700;text-align:center;padding:6px;border-radius:6px}
  .acciones{max-width:380px;margin:12px auto 0;display:flex;gap:8px}.acciones button,.acciones a{flex:1;min-height:44px;border-radius:10px;border:2px solid #1847c2;background:#fff;color:#1847c2;font:700 15px system-ui;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .acciones .primario{background:#1847c2;color:#fff}
  ${ancho ? `@page{size:${ancho}mm auto;margin:2mm}` : "@page{margin:8mm}"}
  @media print{body{background:#fff;padding:0;font-size:${ancho === 58 ? 11 : 12}px}.ticket{border:0;padding:0;max-width:none;width:${ancho ? `${ancho - 4}mm` : "auto"}}.acciones{display:none}h1{font-size:14px}.total td{font-size:14px}}
</style></head><body><main class="ticket">
${v.estado === "anulada" ? '<p class="anulada">VENTA ANULADA</p>' : ""}
${v.logo_version ? `<div class="c"><img class="logo" src="/api/logo/${h(v.negocio_id)}?v=${h(v.logo_version)}" alt=""></div>` : ""}
<h1>${h(v.negocio)}</h1>
<div class="c suave">${v.ruc ? `RUC ${h(v.ruc)}<br>` : ""}${v.direccion ? `${h(v.direccion)}<br>` : ""}${v.telefono ? `Tel. ${h(v.telefono)}` : ""}</div>
<div class="sep"></div>
<div class="c"><strong>${v.factura ? "Comprobante de venta" : "Nota de venta"} N.º ${h(v.numero)}</strong><br><span class="suave">${h(fecha)}</span></div>
${v.cliente ? `<div class="suave c">Cliente: ${h(v.cliente)}${v.cliente_identificacion ? ` · ${h(v.cliente_identificacion)}` : ""}</div>` : ""}
<div class="sep"></div>
<table>${lineas.map((l) => `<tr><td>${Number(l.cantidad) !== 1 ? `${cant(l.cantidad)} × ` : ""}${h(l.nombre)}${Number(l.descuento) ? `<br><span class="suave">Descuento −${h(dinero(l.descuento))}</span>` : ""}</td><td class="n">${h(dinero(l.total))}</td></tr>`).join("")}</table>
<div class="sep"></div>
<table>
${Number(v.iva) ? `<tr><td class="suave">Subtotal</td><td class="n suave">${h(dinero(v.subtotal))}</td></tr><tr><td class="suave">IVA</td><td class="n suave">${h(dinero(v.iva))}</td></tr>` : ""}
<tr class="total"><td>Total</td><td class="n">${h(dinero(v.total))}</td></tr>
${pagos.map((x) => `<tr><td class="suave">${h(METODO[x.metodo] ?? x.metodo)}</td><td class="n suave">${h(dinero(x.metodo === "efectivo" && x.recibido ? x.recibido : x.monto))}</td></tr>`).join("")}
${vuelto > 0 && recibido ? `<tr><td>Vuelto</td><td class="n">${h(dinero(vuelto))}</td></tr>` : ""}
</table>
${v.factura ? `<div class="sep"></div><div class="c suave">Factura electrónica ${h(v.factura.numero)}${v.factura.token ? `<br><a href="/api/c/${h(v.factura.token)}">Ver factura</a>` : ""}</div>` : ""}
<div class="sep"></div>
<div class="c suave">${h(v.mensaje ?? "¡Gracias por su compra!")}</div>
</main>
<div class="acciones"><button class="primario" onclick="window.print()">Imprimir</button></div>
${imprimir ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300))</script>" : ""}
</body></html>`;
    return { crudo: { tipo: "text/html; charset=utf-8", cuerpo: html } };
  });

  // ---------- Clientes: historial de compras ----------

  r.negocio("GET", "/clientes/:id/compras", async (p, { db }) => {
    const id = uuid(p.params.id, "El cliente");
    const { rows } = await db.query(
      `select v.id, v.numero, v.creado_en, v.total, v.estado, v.token_publico as token,
              (select string_agg(d.nombre, ', ' order by d.id) from app.venta_detalle d where d.venta_id = v.id) as productos,
              (select string_agg(distinct pg.metodo, '+') from app.pago pg where pg.venta_id = v.id) as metodos
       from app.venta v where v.cliente_id = $1 order by v.creado_en desc limit 200`, [id]);
    const { rows: top } = await db.query(
      `select d.nombre, sum(d.cantidad) as cantidad, sum(d.total) as total
       from app.venta_detalle d join app.venta v on v.id = d.venta_id
       where v.cliente_id = $1 and v.estado <> 'anulada' group by d.nombre order by sum(d.total) desc limit 5`, [id]);
    return { compras: rows, favoritos: top };
  });

  // ---------- Inventario ----------

  r.negocio("GET", "/inventario", async (_p, ctx) => {
    const { db, rol } = ctx;
    const verCostos = rol === "bodeguero" || puede(ctx, "reportes");
    const { rows } = await db.query<Record<string, any>>(
      `select count(*) filter (where maneja_stock) as productos,
              coalesce(sum(stock * costo) filter (where maneja_stock and stock > 0 and costo is not null), 0) as valor_costo,
              coalesce(sum(stock * precio) filter (where maneja_stock and stock > 0 and precio is not null), 0) as valor_venta,
              count(*) filter (where maneja_stock and stock <= 0) as agotados,
              count(*) filter (where maneja_stock and stock > 0 and stock_minimo is not null and stock <= stock_minimo) as bajos,
              count(*) filter (where maneja_stock and stock > 0 and costo is null) as sin_costo
       from app.producto where activo and tipo = 'venta' and not exists (select 1 from app.producto h where h.padre_id = producto.id)`);
    const { rows: alertas } = await db.query(
      `select p.id, p.nombre, p.unidad, p.stock, p.stock_minimo, c.nombre as categoria
       from app.producto p left join app.categoria c on c.id = p.categoria_id
       where p.activo and p.maneja_stock and p.tipo in ('venta', 'insumo')
         and (p.stock <= 0 or (p.stock_minimo is not null and p.stock <= p.stock_minimo))
       order by p.stock <= 0 desc, p.stock - coalesce(p.stock_minimo, 0), p.nombre limit 300`);
    const resumen = rows[0]!;
    if (!verCostos) delete resumen.valor_costo;
    return { resumen, alertas };
  });

  r.negocio("GET", "/productos/:id/movimientos", async (p, { db }) => {
    const id = uuid(p.params.id, "El producto");
    const { rows } = await db.query(
      `select m.id, m.tipo, m.cantidad, m.costo_unitario, m.motivo, m.creado_en, coalesce(u.nombre, u.celular) as usuario,
              case when m.tipo in ('venta', 'anulacion') then (select numero from app.venta where id = m.referencia_id)
                   when m.tipo = 'compra' then (select numero from app.compra where id = m.referencia_id) end as numero
       from app.movimiento_inventario m left join auth.usuario u on u.id = m.creado_por
       where m.producto_id = $1 order by m.creado_en desc, m.id desc limit 300`, [id]);
    return { movimientos: rows };
  });

  r.negocio("POST", "/productos/importar", async (p, { db }) => {
    const filas = lista(objeto(p.cuerpo).filas, "Los productos", { min: 1, max: 3000 }).map((x) => {
      const f = objeto(x, "Fila");
      const t = (v: unknown, max: number) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
      // Números en formato local (1.234,50 o 1234.50) → 1234.50
      const n = (v: unknown) => {
        if (v === undefined || v === null || v === "") return null;
        if (typeof v === "number") return String(v);
        let s = String(v).trim().replace(/\$|\s/g, "");
        if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
        return s;
      };
      return {
        nombre: t(f.nombre, 80), categoria: t(f.categoria, 60), unidad: t(f.unidad, 30), codigo_barras: t(f.codigo_barras, 32),
        precio: n(f.precio), costo: n(f.costo), stock: n(f.stock), stock_minimo: n(f.stock_minimo),
      };
    });
    const { rows } = await db.query<{ r: unknown }>("select app.importar_productos($1::jsonb) as r", [filas]);
    return { resultado: rows[0]!.r };
  });

  // ---------- Fotos de productos ----------

  r.negocio("POST", "/productos/:id/foto", async (p, ctx) => {
    const { db, rol } = ctx;
    if (rol === "cajero" && !puede(ctx, "productos")) throw prohibido();
    const id = uuid(p.params.id, "El producto");
    const c = objeto(p.cuerpo);
    const tipo = opcion(c.tipo, "El tipo de imagen", ["image/jpeg", "image/webp", "image/png"] as const);
    const b64 = texto(c.datos, "La imagen", { max: 560_000 });
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw invalido("La imagen no es válida");
    const datos = Buffer.from(b64, "base64");
    const firmas: Record<string, (b: Buffer) => boolean> = {
      "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
      "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
    };
    if (!firmas[tipo]!(datos)) throw invalido("La imagen no es válida");
    if (datos.length > 400_000) throw invalido("La foto es muy pesada (máximo 400 KB)");
    const res = await db.query(
      `insert into app.producto_foto (producto_id, negocio_id, tipo, datos)
       select id, negocio_id, $2, $3 from app.producto where id = $1
       on conflict (producto_id) do update set tipo = excluded.tipo, datos = excluded.datos, actualizado_en = now()`, [id, tipo, datos]);
    if (!res.rowCount) throw noEncontrado("Producto no encontrado");
    const { rows } = await db.query<{ foto_version: number }>(
      "update app.producto set foto_version = coalesce(foto_version, 0) + 1 where id = $1 returning foto_version", [id]);
    return { status: 201, cuerpo: { foto_version: rows[0]!.foto_version } };
  });

  r.negocio("DELETE", "/productos/:id/foto", async (p, ctx) => {
    const { db, rol } = ctx;
    if (rol === "cajero" && !puede(ctx, "productos")) throw prohibido();
    const id = uuid(p.params.id, "El producto");
    await db.query("delete from app.producto_foto where producto_id = $1", [id]);
    await db.query("update app.producto set foto_version = null where id = $1", [id]);
    return { quitada: true };
  });

  /** Foto pública (la usa también el catálogo en línea). El ?v= cambia con cada foto nueva. */
  r.publico("GET", "/f/:producto", async (p) => {
    const id = p.params.producto!;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw noEncontrado("Foto no encontrada");
    const { rows } = await dep.pool.query<{ tipo: string; datos: Buffer }>("select * from app.foto_publica($1)", [id]);
    if (!rows[0]) throw noEncontrado("Foto no encontrada");
    return { crudo: { tipo: rows[0].tipo, cuerpo: rows[0].datos, cache: p.query.get("v") ? "public, max-age=31536000, immutable" : "public, max-age=300" } };
  });

  // ---------- Descargas para Excel ----------

  r.negocio("GET", "/reportes/gastos.csv", async (p, ctx) => {
    const { db } = ctx;
    if (!puede(ctx, "reportes")) throw prohibido("Solo el dueño o un administrador descargan reportes");
    const hasta = fechaQ(p.query.get("hasta"), "Hasta", hoyEc());
    const desde = fechaQ(p.query.get("desde"), "Desde", hasta);
    const { rows } = await db.query<Record<string, unknown>>(
      `select g.fecha, g.categoria, g.descripcion, g.monto, g.metodo, g.estado, pr.nombre as proveedor, coalesce(u.nombre, u.celular) as registrado_por
       from app.gasto g left join app.proveedor pr on pr.id = g.proveedor_id left join auth.usuario u on u.id = g.creado_por
       where g.fecha between $1 and $2 order by g.fecha, g.creado_en`, [desde, hasta]);
    return { crudo: { tipo: "text/csv; charset=utf-8", descarga: `gastos-${desde}-a-${hasta}.csv`,
      cuerpo: csv(["fecha", "categoria", "descripcion", "monto", "metodo", "estado", "proveedor", "registrado_por"], rows) } };
  });

  r.negocio("GET", "/reportes/inventario.csv", async (_p, ctx) => {
    const { db, rol } = ctx;
    if (rol === "cajero" && !puede(ctx, "reportes")) throw prohibido();
    const { rows } = await db.query<Record<string, unknown>>(
      `select p.nombre, c.nombre as categoria, p.unidad, p.codigo_barras, p.precio, p.costo, p.stock, p.stock_minimo,
              case when p.costo is not null and p.stock > 0 then round(p.stock * p.costo, 2) end as valor_costo
       from app.producto p left join app.categoria c on c.id = p.categoria_id
       where p.activo and p.tipo in ('venta', 'insumo') and not exists (select 1 from app.producto h where h.padre_id = p.id)
       order by c.nombre nulls last, p.nombre`);
    return { crudo: { tipo: "text/csv; charset=utf-8", descarga: `inventario-${hoyEc()}.csv`,
      cuerpo: csv(["nombre", "categoria", "unidad", "codigo_barras", "precio", "costo", "stock", "stock_minimo", "valor_costo"], rows) } };
  });
}
