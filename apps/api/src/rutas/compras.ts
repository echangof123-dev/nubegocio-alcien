/**
 * Tanda 1 de módulos: catálogo de módulos, proveedores y compras (M15), lotes (M16) y cotizaciones (M24).
 */
import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import type { ServicioSri } from "../sri/servicio.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import {
  booleano, lista, numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional,
} from "../http/validar.js";
import { clasificar } from "../sri/identificacion.js";

const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta", "deuna", "fiado"] as const;

const h = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dinero = (n: unknown) => `$ ${Number(n ?? 0).toFixed(2)}`;
const fecha = (iso: string) => { const d = String(iso).slice(0, 10); return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; };

function itemsCompra(v: unknown) {
  return lista(v, "Los productos", { min: 1, max: 300 }).map((x, i) => {
    const it = objeto(x, `Producto ${i + 1}`);
    const vence = textoOpcional(it.vence, "La fecha de vencimiento", { max: 10 });
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw invalido("La fecha de vencimiento debe ser AAAA-MM-DD");
    return {
      producto_id: uuid(it.producto_id, `Producto ${i + 1}`),
      cantidad: numero(it.cantidad, `La cantidad del producto ${i + 1}`, { min: 0.001, max: 1_000_000, decimales: 3 }),
      costo: numero(it.costo, `El costo del producto ${i + 1}`, { min: 0, max: 1_000_000, decimales: 4 }),
      lote: textoOpcional(it.lote, "El lote", { max: 40 }),
      vence,
    };
  });
}

function itemsVenta(v: unknown) {
  return lista(v, "Los productos", { min: 1, max: 200 }).map((x, i) => {
    const it = objeto(x, `Producto ${i + 1}`);
    const linea: Record<string, unknown> = {
      producto_id: uuid(it.producto_id, `Producto ${i + 1}`),
      cantidad: numero(it.cantidad, `La cantidad del producto ${i + 1}`, { min: 0.001, max: 100_000, decimales: 3 }),
    };
    const precio = numeroOpcional(it.precio, `El precio del producto ${i + 1}`, { min: 0, max: 1_000_000, decimales: 2 });
    const descuento = numeroOpcional(it.descuento, `El descuento del producto ${i + 1}`, { min: 0, decimales: 2 });
    if (precio !== null) linea.precio = precio;
    if (descuento !== null) linea.descuento = descuento;
    return linea;
  });
}

export function rutasCompras(r: Router, dep: { pool: Pool; sri: ServicioSri }) {
  // ---------- Módulos ----------

  r.negocio("GET", "/modulos", async (_p, { db }) => {
    const { rows } = await db.query("select * from app.modulos_catalogo()");
    return { modulos: rows };
  });

  // ---------- Proveedores ----------

  r.negocio("GET", "/proveedores", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const { rows } = await db.query(
      `select pr.id, pr.nombre, pr.ruc, pr.celular, pr.correo, pr.notas,
              coalesce((select sum(total - pagado) from app.compra where proveedor_id = pr.id and estado = 'recibida'), 0) as por_pagar,
              (select max(fecha) from app.compra where proveedor_id = pr.id and estado = 'recibida') as ultima_compra
       from app.proveedor pr
       where pr.activo and ($1 = '' or catalogo.normalizar(pr.nombre) like '%' || catalogo.normalizar($1) || '%' or pr.ruc like $1 || '%')
       order by pr.nombre limit 300`, [q]);
    return { proveedores: rows };
  });

  r.negocio("POST", "/proveedores", async (p, { db, rol }) => {
    if (rol === "cajero") throw prohibido();
    await db.query("select app.exigir_modulo('M15')");
    const c = objeto(p.cuerpo);
    const ruc = textoOpcional(c.ruc, "El RUC o cédula", { max: 13 });
    if (ruc && !clasificar(ruc)) throw invalido("El RUC o la cédula no es válido");
    const { rows } = await db.query(
      `insert into app.proveedor (negocio_id, nombre, ruc, celular, correo, notas)
       values (app.negocio_actual(), $1, $2, $3, $4, $5) returning id, nombre, ruc, celular, correo, notas`, [
        texto(c.nombre, "El nombre", { max: 120 }), ruc,
        textoOpcional(c.celular, "El celular", { max: 20 }), textoOpcional(c.correo, "El correo", { max: 120 }),
        textoOpcional(c.notas, "Las notas", { max: 300 }),
      ]);
    return { status: 201, cuerpo: { proveedor: { ...rows[0], por_pagar: 0 } } };
  });

  // ---------- Compras ----------

  r.negocio("GET", "/compras", async (p, { db }) => {
    const porPagar = p.query.get("por_pagar") === "1";
    const { rows } = await db.query(
      `select c.id, c.numero, c.fecha, c.documento, c.metodo, c.total, c.pagado, c.total - c.pagado as saldo,
              c.estado, pr.nombre as proveedor,
              (select count(*)::int from app.compra_detalle where compra_id = c.id) as productos
       from app.compra c left join app.proveedor pr on pr.id = c.proveedor_id
       where (not $1 or (c.estado = 'recibida' and c.total > c.pagado))
       order by c.fecha desc, c.numero desc limit 300`, [porPagar]);
    const { rows: resumen } = await db.query(
      `select coalesce(sum(total - pagado) filter (where estado = 'recibida'), 0) as por_pagar,
              coalesce(sum(total) filter (where estado = 'recibida' and date_trunc('month', fecha) = date_trunc('month', current_date)), 0) as compras_mes
       from app.compra`);
    return { compras: rows, resumen: resumen[0] };
  });

  r.negocio("GET", "/compras/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "La compra");
    const { rows } = await db.query(
      `select c.*, c.total - c.pagado as saldo, pr.nombre as proveedor
       from app.compra c left join app.proveedor pr on pr.id = c.proveedor_id where c.id = $1`, [id]);
    if (!rows[0]) throw noEncontrado("Compra no encontrada");
    const { rows: detalle } = await db.query(
      `select d.producto_id, p.nombre, p.unidad, d.cantidad, d.costo_unitario, d.subtotal, d.lote, d.vence
       from app.compra_detalle d join app.producto p on p.id = d.producto_id where d.compra_id = $1 order by d.id`, [id]);
    const { rows: pagos } = await db.query(
      "select monto, metodo, creado_en from app.pago_compra where compra_id = $1 order by id", [id]);
    return { compra: rows[0], detalle, pagos };
  });

  r.negocio("POST", "/compras", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const f = textoOpcional(c.fecha, "La fecha", { max: 10 });
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) throw invalido("La fecha debe ser AAAA-MM-DD");
    const { rows } = await db.query<{ id: string }>(
      "select app.registrar_compra($1, $2::jsonb, $3, $4, $5, $6) as id", [
        uuidOpcional(c.proveedor_id, "El proveedor"),
        itemsCompra(c.items),
        opcion(c.metodo, "La forma de pago", ["efectivo", "transferencia", "tarjeta", "credito"] as const),
        textoOpcional(c.documento, "El número de factura del proveedor", { max: 40 }),
        textoOpcional(c.nota, "La nota", { max: 200 }),
        f,
      ]);
    const { rows: compra } = await db.query("select id, numero, total, pagado from app.compra where id = $1", [rows[0]!.id]);
    return { status: 201, cuerpo: { compra: compra[0] } };
  });

  r.negocio("POST", "/compras/:id/pagos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ saldo: number }>("select app.pagar_compra($1, $2, $3) as saldo", [
      uuid(p.params.id, "La compra"),
      numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      opcion(c.metodo, "La forma de pago", ["efectivo", "transferencia", "tarjeta"] as const),
    ]);
    return { status: 201, cuerpo: { saldo: rows[0]!.saldo } };
  });

  r.negocio("POST", "/compras/:id/anular", async (p, { db }) => {
    await db.query("select app.anular_compra($1, $2)", [
      uuid(p.params.id, "La compra"), texto(objeto(p.cuerpo).motivo, "El motivo", { min: 3, max: 200 })]);
    return { anulada: true };
  });

  // ---------- Lotes ----------

  r.negocio("GET", "/lotes", async (p, { db }) => {
    const dias = Math.min(Math.max(Number(p.query.get("dias") ?? 60) || 60, 1), 365);
    const { rows } = await db.query(
      `select l.id, l.producto_id, p.nombre as producto, p.unidad, l.codigo, l.vence, l.cantidad, l.cantidad_inicial,
              (l.vence - current_date) as dias
       from app.lote l join app.producto p on p.id = l.producto_id
       where l.estado = 'vigente' and l.vence <= current_date + $1::int
       order by l.vence, p.nombre limit 500`, [dias]);
    return { lotes: rows };
  });

  r.negocio("POST", "/lotes/:id/cerrar", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    await db.query("select app.cerrar_lote($1, $2, $3)", [
      uuid(p.params.id, "El lote"),
      opcion(c.estado, "El estado", ["agotado", "retirado"] as const),
      c.descontar === undefined ? false : booleano(c.descontar, "Descontar del stock"),
    ]);
    return { cerrado: true };
  });

  // ---------- Cotizaciones ----------

  r.negocio("GET", "/cotizaciones", async (_p, { db }) => {
    const { rows } = await db.query(
      `select q.id, q.numero, q.estado, q.total, q.valida_hasta, q.creado_en, q.token_publico, q.venta_id,
              cl.nombre as cliente, cl.celular, (q.estado = 'abierta' and q.valida_hasta < current_date) as vencida
       from app.cotizacion q left join app.cliente cl on cl.id = q.cliente_id
       order by q.creado_en desc limit 300`);
    return { cotizaciones: rows };
  });

  r.negocio("GET", "/cotizaciones/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "La cotización");
    const { rows } = await db.query(
      `select q.*, cl.nombre as cliente, cl.celular from app.cotizacion q
       left join app.cliente cl on cl.id = q.cliente_id where q.id = $1`, [id]);
    if (!rows[0]) throw noEncontrado("Cotización no encontrada");
    const { rows: detalle } = await db.query(
      "select producto_id, nombre, cantidad, precio, descuento, total from app.cotizacion_detalle where cotizacion_id = $1 order by id", [id]);
    return { cotizacion: rows[0], detalle };
  });

  r.negocio("POST", "/cotizaciones", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.guardar_cotizacion($1, $2::jsonb, $3, $4) as id", [
      uuidOpcional(c.cliente_id, "El cliente"),
      itemsVenta(c.items),
      c.dias_validez === undefined ? 15 : numero(c.dias_validez, "Los días de validez", { min: 1, max: 180, decimales: 0 }),
      textoOpcional(c.nota, "La nota", { max: 500 }),
    ]);
    const { rows: q } = await db.query("select id, numero, total, token_publico from app.cotizacion where id = $1", [rows[0]!.id]);
    return { status: 201, cuerpo: { cotizacion: q[0] } };
  });

  r.negocio("POST", "/cotizaciones/:id/vender", async (p, { db, alConfirmar }) => {
    const c = objeto(p.cuerpo);
    const pagos = lista(c.pagos, "Los pagos", { min: 1, max: 5 }).map((x) => {
      const pg = objeto(x, "Pago");
      const pago: Record<string, unknown> = {
        metodo: opcion(pg.metodo, "El método de pago", METODOS_PAGO),
        monto: numero(pg.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      };
      const recibido = numeroOpcional(pg.recibido, "El efectivo recibido", { min: 0, max: 1_000_000, decimales: 2 });
      if (recibido !== null) pago.recibido = recibido;
      return pago;
    });
    const comprobante = c.comprobante === undefined ? "nota" : opcion(c.comprobante, "El comprobante", ["nota", "factura"] as const);
    const { rows } = await db.query<{ venta_id: string }>(
      "select * from app.convertir_cotizacion($1, $2::jsonb, $3)", [uuid(p.params.id, "La cotización"), pagos, comprobante]);
    let factura = null;
    if (comprobante === "factura") {
      const { rows: f } = await db.query("select id, numero, clave_acceso from app.sri_reservar($1, 'factura')", [rows[0]!.venta_id]);
      const firmados = await dep.sri.firmarPendientes(db);
      alConfirmar(() => dep.sri.enviar(firmados));
      factura = f[0];
    }
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  r.negocio("POST", "/cotizaciones/:id/anular", async (p, { db }) => {
    const res = await db.query(
      "update app.cotizacion set estado = 'anulada' where id = $1 and estado = 'abierta'", [uuid(p.params.id, "La cotización")]);
    if (!res.rowCount) throw noEncontrado("No hay una cotización abierta con ese número");
    return { anulada: true };
  });

  // Enlace público de la cotización (para enviarla por WhatsApp)
  r.publico("GET", "/q/:token", async (p) => {
    const token = p.params.token!;
    if (!/^[0-9a-f]{36}$/.test(token)) throw noEncontrado("Cotización no encontrada");
    const { rows } = await dep.pool.query<{ q: Record<string, any> | null }>("select app.cotizacion_publica($1) as q", [token]);
    const q = rows[0]?.q;
    if (!q) throw noEncontrado("Cotización no encontrada");
    const lineas = (q.lineas ?? []) as { nombre: string; cantidad: number; precio: number; descuento: number; total: number }[];
    const vencida = q.estado === "abierta" && String(q.valida_hasta) < new Date().toISOString().slice(0, 10);
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Cotización N.º ${h(q.numero)} · ${h(q.negocio)}</title>
<style>
  body{margin:0;padding:16px;background:#f3f5f9;color:#0b1b33;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .hoja{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:20px}
  h1{font-size:18px;margin:0}.suave{color:#5b6b82}.fila{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px 4px;border-bottom:1px solid #d9e0ea;text-align:left}
  th{font-size:11px;text-transform:uppercase;color:#5b6b82}.n{text-align:right;white-space:nowrap}
  .total{font-size:18px;font-weight:700;text-align:right;margin-top:12px}.aviso{background:#fff4d6;padding:10px 12px;border-radius:8px;font-weight:600;margin-bottom:12px}
  @media print{body{background:#fff;padding:0}.hoja{border:0}}
</style></head><body><main class="hoja">
${q.estado === "anulada" ? '<p class="aviso">Esta cotización fue anulada.</p>' : vencida ? '<p class="aviso">Esta cotización ya venció.</p>' : ""}
<div class="fila"><div><h1>${h(q.negocio)}</h1>${q.ruc ? `<div class="suave">RUC ${h(q.ruc)}</div>` : ""}${q.direccion ? `<div class="suave">${h(q.direccion)}</div>` : ""}</div>
<div style="text-align:right"><strong>COTIZACIÓN N.º ${h(q.numero)}</strong><div class="suave">Fecha: ${h(fecha(q.fecha))}</div><div class="suave">Válida hasta: ${h(fecha(q.valida_hasta))}</div></div></div>
${q.cliente ? `<p style="margin-top:14px">Para: <strong>${h(q.cliente)}</strong>${q.cliente_identificacion ? ` · ${h(q.cliente_identificacion)}` : ""}</p>` : ""}
<table><thead><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Desc.</th><th class="n">Total</th></tr></thead><tbody>
${lineas.map((l) => `<tr><td>${h(l.nombre)}</td><td class="n">${h(Number(l.cantidad))}</td><td class="n">${h(dinero(l.precio))}</td><td class="n">${h(Number(l.descuento) ? dinero(l.descuento) : "")}</td><td class="n">${h(dinero(l.total))}</td></tr>`).join("")}
</tbody></table><p class="total">Total ${h(dinero(q.total))}</p>
<p class="suave" style="font-size:12px">Precios con IVA incluido.${q.nota ? ` ${h(q.nota)}` : ""}</p>
</main></body></html>`;
    return { crudo: { tipo: "text/html; charset=utf-8", cuerpo: html } };
  });
}
