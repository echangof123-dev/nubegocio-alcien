import type { Router } from "../http/servidor.js";
import type { ServicioSri } from "../sri/servicio.js";
import { clasificar } from "../sri/identificacion.js";
import { invalido, noEncontrado } from "../http/errores.js";
import {
  lista, numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid, uuidOpcional,
} from "../http/validar.js";

function fechaOpcional(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalido("La fecha de pago debe ser AAAA-MM-DD");
  return v;
}

const METODOS = ["efectivo", "transferencia", "tarjeta", "deuna", "fiado"] as const;

export function rutasVentas(r: Router, dep: { sri: ServicioSri }) {
  // ---------- Ventas ----------

  r.negocio("POST", "/ventas", async (p, { db, alConfirmar }) => {
    const c = objeto(p.cuerpo);
    const items = lista(c.items, "Los productos", { min: 1, max: 200 }).map((x, i) => {
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
    const pagos = lista(c.pagos, "Los pagos", { min: 1, max: 5 }).map((x, i) => {
      const pg = objeto(x, `Pago ${i + 1}`);
      const pago: Record<string, unknown> = {
        metodo: opcion(pg.metodo, "El método de pago", METODOS),
        monto: numero(pg.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      };
      const recibido = numeroOpcional(pg.recibido, "El efectivo recibido", { min: 0, max: 1_000_000, decimales: 2 });
      if (recibido !== null) pago.recibido = recibido;
      const referencia = textoOpcional(pg.referencia, "La referencia", { max: 80 });
      if (referencia) pago.referencia = referencia;
      return pago;
    });

    const comprobante = c.comprobante === undefined ? "nota" : opcion(c.comprobante, "El comprobante", ["nota", "factura"] as const);
    const listaPrecios = uuidOpcional(c.lista_id, "La lista de precios");
    const { rows } = listaPrecios
      ? await db.query<{ venta_id: string }>(
          "select * from app.registrar_venta_lista($1::jsonb, $2::jsonb, $3, $4, $5, $6)",
          [items, pagos, uuidOpcional(c.cliente_id, "El cliente"), comprobante, textoOpcional(c.nota, "La nota", { max: 200 }), listaPrecios])
      : await db.query<{ venta_id: string }>(
          "select * from app.registrar_venta($1::jsonb, $2::jsonb, $3, $4, $5)",
          [items, pagos, uuidOpcional(c.cliente_id, "El cliente"), comprobante, textoOpcional(c.nota, "La nota", { max: 200 })]);

    // Factura: se reserva el número, se arma y se firma en la misma transacción (si algo falla,
    // la venta tampoco se guarda). El envío al SRI va después del COMMIT.
    let factura = null;
    if (comprobante === "factura") {
      const { rows: f } = await db.query("select id, numero, clave_acceso from app.sri_reservar($1, 'factura')", [rows[0]!.venta_id]);
      const firmados = await dep.sri.firmarPendientes(db);
      alConfirmar(() => dep.sri.enviar(firmados));
      factura = f[0];
    }
    const { rows: t } = await db.query<{ token_publico: string }>("select token_publico from app.venta where id = $1", [rows[0]!.venta_id]);
    return { status: 201, cuerpo: { venta: { ...rows[0], token: t[0]!.token_publico }, factura } };
  });

  r.negocio("GET", "/ventas", async (p, { db }) => {
    const fecha = p.query.get("fecha");
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw invalido("La fecha debe ser AAAA-MM-DD");
    const { rows } = await db.query(
      `select v.id, v.numero, v.estado, v.total, v.comprobante, v.creado_en, c.nombre as cliente, v.token_publico as token,
              (select string_agg(distinct metodo, ', ') from app.pago where venta_id = v.id) as metodos,
              (select jsonb_build_object('id', f.id, 'numero', f.numero, 'estado', f.estado,
                                         'consumidor_final', f.comprador->>'tipo_identificacion' = '07')
                 from app.comprobante f where f.venta_id = v.id and f.tipo = 'factura' and f.estado <> 'anulado'
                 order by f.creado_en desc limit 1) as factura
       from app.venta v
       join app.negocio n on n.id = v.negocio_id
       left join app.cliente c on c.id = v.cliente_id
       where (v.creado_en at time zone n.zona_horaria)::date = coalesce($1::date, (now() at time zone n.zona_horaria)::date)
       order by v.numero desc
       limit 500`, [fecha]);
    return { ventas: rows };
  });

  r.negocio("GET", "/ventas/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "La venta");
    const { rows: v } = await db.query(
      `select v.*, c.nombre as cliente, u.nombre as vendedor
       from app.venta v left join app.cliente c on c.id = v.cliente_id
       left join auth.usuario u on u.id = v.vendedor_id where v.id = $1`, [id]);
    if (!v[0]) throw noEncontrado("Venta no encontrada");
    const { rows: detalle } = await db.query(
      `select producto_id, nombre, cantidad, precio_unitario, descuento, tarifa_iva, base, iva, total
       from app.venta_detalle where venta_id = $1 order by id`, [id]);
    const { rows: pagos } = await db.query(
      "select metodo, monto, recibido, vuelto, referencia from app.pago where venta_id = $1 order by id", [id]);
    const { rows: comprobantes } = await db.query(
      `select id, tipo, numero, estado, token_publico, mensajes from app.comprobante
       where venta_id = $1 order by creado_en`, [id]);
    return { venta: v[0], detalle, pagos, comprobantes };
  });

  r.negocio("POST", "/ventas/:id/anular", async (p, { db, alConfirmar }) => {
    const id = uuid(p.params.id, "La venta");
    const motivo = texto(objeto(p.cuerpo).motivo, "El motivo", { min: 3, max: 200 });
    await db.query("select app.anular_venta($1, $2)", [id, motivo]);
    // Si la factura estaba autorizada, se generó una nota de crédito: se firma aquí y se envía después
    const firmados = await dep.sri.firmarPendientes(db);
    alConfirmar(() => dep.sri.enviar(firmados));
    const { rows } = await db.query(
      "select id, numero from app.comprobante where venta_id = $1 and tipo = 'nota_credito' order by creado_en desc limit 1", [id]);
    return { anulada: true, nota_credito: rows[0] ?? null };
  });

  r.negocio("GET", "/resumen/hoy", async (_p, { db }) => {
    const { rows } = await db.query("select * from app.resumen_hoy()");
    return { resumen: rows[0] };
  });

  // ---------- Caja ----------

  r.negocio("GET", "/caja", async (_p, { db }) => {
    const { rows } = await db.query("select * from app.resumen_caja()");
    if (rows[0]) return { abierta: true, caja: rows[0] };
    const { rows: ultimo } = await db.query(
      `select id from app.caja_turno where estado = 'cerrado' order by cerrado_en desc limit 1`);
    const ultimoCierre = ultimo[0]
      ? (await db.query("select * from app.resumen_caja($1)", [(ultimo[0] as { id: string }).id])).rows[0]
      : null;
    return { abierta: false, ultimoCierre };
  });

  r.negocio("POST", "/caja/abrir", async (p, { db }) => {
    const monto = numero(objeto(p.cuerpo).monto ?? 0, "El monto de apertura", { min: 0, max: 100_000, decimales: 2 });
    await db.query("select app.abrir_caja($1)", [monto]);
    const { rows } = await db.query("select * from app.resumen_caja()");
    return { status: 201, cuerpo: { caja: rows[0] } };
  });

  r.negocio("POST", "/caja/cerrar", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const contado = numero(c.contado, "El efectivo contado", { min: 0, max: 1_000_000, decimales: 2 });
    const { rows: t } = await db.query<{ id: string }>("select app.turno_abierto() as id");
    await db.query("select app.cerrar_caja($1, $2)", [contado, textoOpcional(c.nota, "La nota", { max: 200 })]);
    const { rows } = await db.query("select * from app.resumen_caja($1)", [t[0]?.id ?? null]);
    return { caja: rows[0] };
  });

  r.negocio("POST", "/caja/movimientos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    await db.query("select app.movimiento_caja($1, $2, $3)", [
      opcion(c.tipo, "El tipo", ["ingreso", "retiro"] as const),
      numero(c.monto, "El monto", { min: 0.01, max: 100_000, decimales: 2 }),
      texto(c.motivo, "El motivo", { max: 120 }),
    ]);
    const { rows } = await db.query("select * from app.resumen_caja()");
    return { status: 201, cuerpo: { caja: rows[0] } };
  });

  r.negocio("POST", "/gastos", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const fecha = textoOpcional(c.fecha, "La fecha", { max: 10 });
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw invalido("La fecha debe ser AAAA-MM-DD");
    const { rows } = await db.query<{ id: string }>("select app.registrar_gasto_v2($1::jsonb) as id", [{
      categoria: texto(c.categoria, "La categoría", { max: 60 }),
      monto: numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      metodo: c.metodo === undefined ? "efectivo" : opcion(c.metodo, "El método", ["efectivo", "transferencia", "tarjeta", "otro"] as const),
      descripcion: textoOpcional(c.descripcion, "La descripción", { max: 200 }),
      fecha, proveedor_id: uuidOpcional(c.proveedor_id, "El proveedor"),
    }]);
    return { status: 201, cuerpo: { id: rows[0]!.id } };
  });

  // ---------- Clientes y fiado ----------

  r.negocio("GET", "/clientes", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const conDeuda = p.query.get("con_deuda") === "1";
    const { rows } = await db.query(
      `select s.cliente_id as id, s.nombre, s.celular, s.limite_credito, s.saldo, s.ultimo_cargo,
              c.identificacion, c.tipo_identificacion, c.correo, c.direccion, c.lista_precio_id, c.notas, c.fecha_pago,
              (select coalesce(sum(v.total), 0) from app.venta v where v.cliente_id = c.id and v.estado <> 'anulada') as comprado,
              (select max(v.creado_en) from app.venta v where v.cliente_id = c.id and v.estado <> 'anulada') as ultima_compra
       from app.cliente_saldo s join app.cliente c on c.id = s.cliente_id
       where c.activo
         and ($1 = '' or catalogo.normalizar(s.nombre) like '%' || catalogo.normalizar($1) || '%'
              or s.celular like '%' || $1 || '%' or c.identificacion like $1 || '%')
         and (not $2 or s.saldo > 0)
       order by case when $2 then s.saldo end desc nulls last, s.nombre
       limit 200`, [q, conDeuda]);
    return { clientes: rows };
  });

  r.negocio("POST", "/clientes", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const identificacion = textoOpcional(c.identificacion, "La identificación", { max: 20 })?.toUpperCase() ?? null;
    const tipo = identificacion ? clasificar(identificacion) : null;
    if (identificacion && !tipo) throw invalido("La cédula o el RUC no es válido");
    const correo = textoOpcional(c.correo, "El correo", { max: 120 });
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw invalido("El correo no es válido");
    const { rows } = await db.query(
      `insert into app.cliente (negocio_id, nombre, celular, correo, tipo_identificacion, identificacion, limite_credito, direccion)
       values (app.negocio_actual(), $1, $2, $3, $4, $5, $6, $7)
       returning id, nombre, celular, limite_credito, identificacion, tipo_identificacion, correo, direccion`, [
        texto(c.nombre, "El nombre", { max: 120 }),
        textoOpcional(c.celular, "El celular", { max: 20 }),
        correo,
        tipo, identificacion,
        numeroOpcional(c.limite_credito, "El límite de crédito", { min: 0, max: 1_000_000, decimales: 2 }),
        textoOpcional(c.direccion, "La dirección", { max: 300 }),
      ]);
    return { status: 201, cuerpo: { cliente: { ...rows[0], saldo: 0 } } };
  });

  /** Completar o corregir los datos de un cliente (por ejemplo, su cédula para facturarle). */
  r.negocio("PATCH", "/clientes/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "El cliente");
    const c = objeto(p.cuerpo);
    const identificacion = textoOpcional(c.identificacion, "La identificación", { max: 20 })?.toUpperCase() ?? null;
    const tipo = identificacion ? clasificar(identificacion) : null;
    if (identificacion && !tipo) throw invalido("La cédula o el RUC no es válido");
    const correo = textoOpcional(c.correo, "El correo", { max: 120 });
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw invalido("El correo no es válido");
    const { rows } = await db.query(
      `update app.cliente set
         nombre = coalesce($2, nombre),
         celular = coalesce($3, celular),
         correo = coalesce($4, correo),
         tipo_identificacion = coalesce($5, tipo_identificacion),
         identificacion = coalesce($6, identificacion),
         direccion = coalesce($7, direccion),
         lista_precio_id = case when $8 then $9::uuid else lista_precio_id end,
         notas = case when $10 then $11 else notas end,
         fecha_pago = case when $12 then $13::date else fecha_pago end,
         limite_credito = case when $14 then $15::numeric else limite_credito end
       where id = $1
       returning id, nombre, celular, limite_credito, identificacion, tipo_identificacion, correo, direccion, lista_precio_id, notas, fecha_pago`, [
        id,
        textoOpcional(c.nombre, "El nombre", { max: 120 }),
        textoOpcional(c.celular, "El celular", { max: 20 }),
        correo, tipo, identificacion,
        textoOpcional(c.direccion, "La dirección", { max: 300 }),
        c.lista_precio_id !== undefined, uuidOpcional(c.lista_precio_id, "La lista de precios"),
        c.notas !== undefined, textoOpcional(c.notas, "Las notas", { max: 500 }),
        c.fecha_pago !== undefined, fechaOpcional(c.fecha_pago),
        c.limite_credito !== undefined, numeroOpcional(c.limite_credito, "El límite de crédito", { min: 0, max: 1_000_000, decimales: 2 }),
      ]);
    if (!rows[0]) throw noEncontrado("Cliente no encontrado");
    return { cliente: rows[0] };
  });

  r.negocio("GET", "/clientes/:id", async (p, { db }) => {
    const id = uuid(p.params.id, "El cliente");
    const { rows } = await db.query("select * from app.cliente_saldo where cliente_id = $1", [id]);
    if (!rows[0]) throw noEncontrado("Cliente no encontrado");
    const { rows: movimientos } = await db.query(
      `select f.tipo, f.monto, f.metodo, f.creado_en, v.numero as venta_numero
       from app.fiado_movimiento f left join app.venta v on v.id = f.venta_id
       where f.cliente_id = $1 order by f.creado_en desc limit 100`, [id]);
    return { cliente: rows[0], movimientos };
  });

  r.negocio("POST", "/clientes/:id/abonos", async (p, { db }) => {
    const id = uuid(p.params.id, "El cliente");
    const c = objeto(p.cuerpo);
    const { rows } = await db.query<{ saldo: number }>("select app.registrar_abono($1, $2, $3) as saldo", [
      id,
      numero(c.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
      opcion(c.metodo, "El método", ["efectivo", "transferencia", "tarjeta", "deuna"] as const),
    ]);
    return { status: 201, cuerpo: { saldo: rows[0]!.saldo } };
  });
}
