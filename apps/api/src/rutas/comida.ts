/**
 * Tanda 2 de módulos (comida): recetas (M08), mesas y comandas (M09), pedidos y delivery (M10).
 */
import type { Router } from "../http/servidor.js";
import type { ServicioSri } from "../sri/servicio.js";
import { invalido, noEncontrado, prohibido } from "../http/errores.js";
import { lista, numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional } from "../http/validar.js";
import { facturarSiToca, leerComprobante, leerPagos } from "./comun.js";

function leerItems(v: unknown) {
  return lista(v, "Los productos", { min: 1, max: 100 }).map((x, i) => {
    const it = objeto(x, `Producto ${i + 1}`);
    return {
      producto_id: uuid(it.producto_id, `Producto ${i + 1}`),
      cantidad: numero(it.cantidad, `La cantidad del producto ${i + 1}`, { min: 0.001, max: 10_000, decimales: 3 }),
      nota: textoOpcional(it.nota, "La nota", { max: 120 }),
    };
  });
}

const idItem = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw invalido("Producto de la cuenta inválido");
  return n;
};

export function rutasComida(r: Router, dep: { sri: ServicioSri }) {
  // ---------- Recetas ----------

  r.negocio("GET", "/recetas/:producto", async (p, { db }) => {
    const id = uuid(p.params.producto, "El producto");
    const { rows } = await db.query(
      `select r.insumo_id, i.nombre, i.unidad, r.cantidad, i.costo, round(r.cantidad * coalesce(i.costo, 0), 4) as costo_linea
       from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = $1 order by i.nombre`, [id]);
    const costo = rows.reduce((s, x) => s + Number((x as { costo_linea: number }).costo_linea), 0);
    return { insumos: rows, costo: Math.round(costo * 10000) / 10000 };
  });

  r.negocio("POST", "/recetas/:producto", async (p, { db }) => {
    const insumos = lista(objeto(p.cuerpo).insumos, "Los insumos", { max: 50 }).map((x, i) => {
      const it = objeto(x, `Insumo ${i + 1}`);
      return {
        insumo_id: uuid(it.insumo_id, `Insumo ${i + 1}`),
        cantidad: numero(it.cantidad, `La cantidad del insumo ${i + 1}`, { min: 0.0001, max: 10_000, decimales: 4 }),
      };
    });
    const { rows } = await db.query<{ costo: number }>("select app.guardar_receta($1, $2::jsonb) as costo",
      [uuid(p.params.producto, "El producto"), insumos]);
    return { costo: rows[0]!.costo };
  });

  // ---------- Mesas ----------

  r.negocio("GET", "/mesas", async (_p, { db }) => {
    const { rows } = await db.query(
      `select m.id, m.nombre, m.zona, m.orden, c.id as cuenta_id, c.numero as cuenta_numero, c.personas, c.abierta_en,
              coalesce((select sum(round(i.cantidad * i.precio, 2)) from app.cuenta_item i
                        where i.cuenta_id = c.id and not i.anulado and i.venta_id is null), 0) as por_cobrar,
              (select count(*)::int from app.cuenta_item i where i.cuenta_id = c.id and not i.anulado and i.cocina = 'listo') as listos
       from app.mesa m left join app.cuenta c on c.mesa_id = m.id and c.estado = 'abierta'
       where m.activa order by m.orden, m.nombre`);
    const { rows: sueltas } = await db.query(
      `select c.id as cuenta_id, c.numero as cuenta_numero, c.nombre, c.abierta_en,
              coalesce((select sum(round(i.cantidad * i.precio, 2)) from app.cuenta_item i
                        where i.cuenta_id = c.id and not i.anulado and i.venta_id is null), 0) as por_cobrar
       from app.cuenta c where c.estado = 'abierta' and c.mesa_id is null order by c.abierta_en`);
    return { mesas: rows, cuentas: sueltas };
  });

  r.negocio("POST", "/mesas", async (p, { db, rol }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido("Solo el dueño o un administrador arman las mesas");
    await db.query("select app.exigir_modulo('M09')");
    const c = objeto(p.cuerpo);
    const zona = textoOpcional(c.zona, "La zona", { max: 40 });
    // Varias de una: {cantidad: 10} crea las mesas 1..10 (continuando la numeración)
    if (c.cantidad !== undefined) {
      const n = numero(c.cantidad, "La cantidad de mesas", { min: 1, max: 100, decimales: 0 });
      await db.query(
        `insert into app.mesa (negocio_id, nombre, zona, orden)
         select app.negocio_actual(), (base + g)::text, $2, base + g
         from generate_series(1, $1::int) g,
              lateral (select coalesce(max(orden), 0) as base from app.mesa) b
         on conflict (negocio_id, nombre) do nothing`, [n, zona]);
      return { status: 201, cuerpo: { creadas: n } };
    }
    const { rows } = await db.query(
      `insert into app.mesa (negocio_id, nombre, zona, orden)
       values (app.negocio_actual(), $1, $2, coalesce((select max(orden) + 1 from app.mesa), 1)) returning id, nombre, zona`,
      [texto(c.nombre, "El nombre de la mesa", { max: 40 }), zona]);
    return { status: 201, cuerpo: { mesa: rows[0] } };
  });

  r.negocio("POST", "/mesas/:id/quitar", async (p, { db, rol }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido();
    const res = await db.query(
      `update app.mesa set activa = false where id = $1
       and not exists (select 1 from app.cuenta where mesa_id = $1 and estado = 'abierta')`, [uuid(p.params.id, "La mesa")]);
    if (!res.rowCount) throw invalido("La mesa tiene una cuenta abierta o no existe");
    return { quitada: true };
  });

  // ---------- Cuentas ----------

  r.negocio("POST", "/cuentas", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ id: string }>("select app.abrir_cuenta($1, $2, $3) as id", [
      uuidOpcional(c.mesa_id, "La mesa"), textoOpcional(c.nombre, "El nombre", { max: 60 }),
      numeroOpcional(c.personas, "Las personas", { min: 1, max: 100, decimales: 0 }),
    ]);
    return { status: 201, cuerpo: { id: rows[0]!.id } };
  });

  r.negocio("GET", "/cuentas/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "La cuenta");
    const { rows } = await db.query(
      `select c.*, m.nombre as mesa from app.cuenta c left join app.mesa m on m.id = c.mesa_id where c.id = $1`, [id]);
    if (!rows[0]) throw noEncontrado("Cuenta no encontrada");
    const { rows: items } = await db.query(
      `select id, producto_id, nombre, cantidad, precio, round(cantidad * precio, 2) as total, nota, cocina, venta_id is not null as cobrado
       from app.cuenta_item where cuenta_id = $1 and not anulado order by id`, [id]);
    return { cuenta: rows[0], items };
  });

  r.negocio("POST", "/cuentas/:id/items", async (p, { db }) => {
    await db.query("select app.agregar_a_cuenta($1, $2::jsonb)", [uuid(p.params.id, "La cuenta"), leerItems(objeto(p.cuerpo).items)]);
    return { status: 201, cuerpo: { agregado: true } };
  });

  r.negocio("POST", "/cuentas/:id/cocina", async (p, { db }) => {
    const { rows } = await db.query<{ n: number }>("select app.enviar_a_cocina($1) as n", [uuid(p.params.id, "La cuenta")]);
    return { enviados: rows[0]!.n };
  });

  r.negocio("POST", "/cuentas/items/:item/quitar", async (p, { db }) => {
    await db.query("select app.quitar_de_cuenta($1)", [idItem(p.params.item)]);
    return { quitado: true };
  });

  r.negocio("POST", "/cuentas/:id/mover", async (p, { db }) => {
    await db.query("select app.mover_cuenta($1, $2)", [uuid(p.params.id, "La cuenta"), uuid(objeto(p.cuerpo).mesa_id, "La mesa")]);
    return { movida: true };
  });

  r.negocio("POST", "/cuentas/:id/cobrar", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const items = c.items === undefined || c.items === null ? null : lista(c.items, "Los productos a cobrar", { min: 1 }).map(idItem);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>(
      "select * from app.cobrar_cuenta($1, $2::bigint[], $3::jsonb, $4, $5)",
      [uuid(p.params.id, "La cuenta"), items ? `{${items.join(",")}}` : null, leerPagos(c.pagos),
       uuidOpcional(c.cliente_id, "El cliente"), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });

  r.negocio("POST", "/cuentas/:id/anular", async (p, { db }) => {
    await db.query("select app.anular_cuenta($1)", [uuid(p.params.id, "La cuenta")]);
    return { anulada: true };
  });

  // ---------- Cocina ----------

  r.negocio("GET", "/cocina", async (_p, { db }) => {
    const { rows: comandas } = await db.query(
      `select i.id, i.nombre, i.cantidad, i.nota, i.cocina, i.enviado_en, c.id as cuenta_id, c.numero as cuenta_numero,
              coalesce('Mesa ' || m.nombre, c.nombre) as destino
       from app.cuenta_item i join app.cuenta c on c.id = i.cuenta_id left join app.mesa m on m.id = c.mesa_id
       where i.cocina in ('enviado', 'listo') and not i.anulado and c.estado <> 'anulada'
       order by i.enviado_en, i.id limit 300`);
    const { rows: pedidos } = await db.query(
      `select pe.id, pe.numero, pe.nombre, pe.tipo, pe.estado, pe.hora_entrega, pe.creado_en,
              (select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'nota', i.nota) order by i.id)
               from app.pedido_item i where i.pedido_id = pe.id) as items
       from app.pedido pe where pe.estado in ('recibido', 'preparando') order by coalesce(pe.hora_entrega, pe.creado_en)`);
    return { comandas, pedidos };
  });

  r.negocio("POST", "/cocina/:item", async (p, { db }) => {
    await db.query("select app.marcar_cocina($1, $2)", [
      idItem(p.params.item), opcion(objeto(p.cuerpo).estado, "El estado", ["listo", "entregado"] as const)]);
    return { listo: true };
  });

  // ---------- Pedidos ----------

  r.negocio("GET", "/pedidos", async (p, { db }) => {
    const todos = p.query.get("todos") === "1";
    const { rows } = await db.query(
      `select pe.id, pe.numero, pe.tipo, pe.canal, pe.nombre, pe.celular, pe.direccion, pe.referencia, pe.costo_envio,
              pe.hora_entrega, pe.estado, pe.repartidor, pe.subtotal, pe.subtotal + pe.costo_envio as total, pe.nota,
              pe.venta_id is not null as cobrado, pe.creado_en,
              (select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'nota', i.nota) order by i.id)
               from app.pedido_item i where i.pedido_id = pe.id) as items
       from app.pedido pe
       where $1 or pe.estado not in ('entregado', 'cancelado') or pe.actualizado_en > now() - interval '12 hours'
       order by (pe.estado in ('entregado', 'cancelado')), coalesce(pe.hora_entrega, pe.creado_en) limit 300`, [todos]);
    return { pedidos: rows };
  });

  r.negocio("POST", "/pedidos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const hora = textoOpcional(c.hora_entrega, "La hora de entrega", { max: 40 });
    if (hora && Number.isNaN(Date.parse(hora))) throw invalido("La hora de entrega no es válida");
    const { rows } = await db.query<{ id: string }>("select app.crear_pedido($1) as id", [{
      tipo: opcion(c.tipo ?? "retiro", "El tipo", ["retiro", "domicilio"] as const),
      canal: opcion(c.canal ?? "local", "El canal", ["local", "telefono", "whatsapp", "catalogo"] as const),
      cliente_id: uuidOpcional(c.cliente_id, "El cliente"),
      nombre: textoOpcional(c.nombre, "El nombre", { max: 120 }),
      celular: textoOpcional(c.celular, "El celular", { max: 20 }),
      direccion: textoOpcional(c.direccion, "La dirección", { max: 300 }),
      referencia: textoOpcional(c.referencia, "La referencia", { max: 200 }),
      costo_envio: numeroOpcional(c.costo_envio, "El costo del envío", { min: 0, max: 1000, decimales: 2 }) ?? 0,
      hora_entrega: hora,
      nota: textoOpcional(c.nota, "La nota", { max: 300 }),
      items: leerItems(c.items),
    }]);
    const { rows: pe } = await db.query("select id, numero from app.pedido where id = $1", [rows[0]!.id]);
    return { status: 201, cuerpo: { pedido: pe[0] } };
  });

  r.negocio("POST", "/pedidos/:id/estado", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    await db.query("select app.cambiar_estado_pedido($1, $2, $3)", [
      uuid(p.params.id, "El pedido"),
      opcion(c.estado, "El estado", ["recibido", "preparando", "listo", "en_camino", "entregado", "cancelado"] as const),
      textoOpcional(c.repartidor, "El repartidor", { max: 60 }),
    ]);
    return { cambiado: true };
  });

  r.negocio("POST", "/pedidos/:id/cobrar", async (p, ctx) => {
    const c = objeto(p.cuerpo);
    const comprobante = leerComprobante(c.comprobante);
    const { rows } = await ctx.db.query<{ venta_id: string }>("select * from app.cobrar_pedido($1, $2::jsonb, $3)",
      [uuid(p.params.id, "El pedido"), leerPagos(c.pagos), comprobante]);
    const factura = await facturarSiToca(ctx, dep.sri, rows[0]!.venta_id, comprobante);
    return { status: 201, cuerpo: { venta: rows[0], factura } };
  });
}
