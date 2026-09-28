/**
 * Tanda 3 de módulos (tiendas y ropa): listas de precios (M17), series y garantías (M23) y
 * catálogo en línea (M18). Las variantes (M05) están en productos.ts.
 */
import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import { ErrorApp, invalido, noEncontrado, prohibido } from "../http/errores.js";
import { booleano, lista, numero, numeroOpcional, objeto, opcion, texto, textoOpcional, uuid } from "../http/validar.js";
import { Limitador } from "../auth/limite.js";

const soloGestion = (rol: string) => {
  if (rol !== "dueno" && rol !== "administrador") throw prohibido("Solo el dueño o un administrador pueden cambiar esto");
};

export function rutasRetail(r: Router, dep: { pool: Pool }) {
  // ---------- Listas de precios ----------

  r.negocio("GET", "/listas", async (_p, { db }) => {
    const { rows } = await db.query(
      `select l.id, l.nombre, l.descuento_pct, l.activa,
              (select count(*)::int from app.cliente c where c.lista_precio_id = l.id) as clientes,
              coalesce((select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'nombre', p.nombre, 'precio_normal', p.precio,
                                                            'desde_cantidad', i.desde_cantidad, 'precio', i.precio) order by p.nombre, i.desde_cantidad)
                        from app.lista_precio_item i join app.producto p on p.id = i.producto_id where i.lista_id = l.id), '[]') as precios
       from app.lista_precio l order by l.activa desc, l.nombre`);
    return { listas: rows };
  });

  r.negocio("POST", "/listas", async (p, { db, rol }) => {
    soloGestion(rol);
    await db.query("select app.exigir_modulo('M17')");
    const c = objeto(p.cuerpo);
    const { rows } = await db.query(
      `insert into app.lista_precio (negocio_id, nombre, descuento_pct) values (app.negocio_actual(), $1, $2)
       returning id, nombre, descuento_pct, activa`,
      [texto(c.nombre, "El nombre", { max: 60 }), numeroOpcional(c.descuento_pct, "El descuento", { min: 0, max: 90, decimales: 2 }) ?? 0]);
    return { status: 201, cuerpo: { lista: rows[0] } };
  });

  r.negocio("PATCH", "/listas/:id", async (p, { db, rol }) => {
    soloGestion(rol);
    const c = objeto(p.cuerpo);
    const res = await db.query(
      `update app.lista_precio set nombre = coalesce($2, nombre), descuento_pct = coalesce($3, descuento_pct),
         activa = coalesce($4, activa) where id = $1`, [
        uuid(p.params.id, "La lista"), textoOpcional(c.nombre, "El nombre", { max: 60 }),
        numeroOpcional(c.descuento_pct, "El descuento", { min: 0, max: 90, decimales: 2 }),
        c.activa === undefined ? null : booleano(c.activa, "Activa")]);
    if (!res.rowCount) throw noEncontrado("Lista no encontrada");
    return { guardada: true };
  });

  /** Pone (o quita, con precio null) el precio de un producto en la lista. */
  r.negocio("POST", "/listas/:id/precios", async (p, { db, rol }) => {
    soloGestion(rol);
    const c = objeto(p.cuerpo);
    const lista = uuid(p.params.id, "La lista");
    const producto = uuid(c.producto_id, "El producto");
    const desde = numeroOpcional(c.desde_cantidad, "Desde qué cantidad", { min: 0.001, max: 1_000_000, decimales: 3 }) ?? 1;
    const precio = numeroOpcional(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 });
    if (precio === null) {
      await db.query("delete from app.lista_precio_item where lista_id = $1 and producto_id = $2 and desde_cantidad = $3", [lista, producto, desde]);
    } else {
      await db.query(
        `insert into app.lista_precio_item (negocio_id, lista_id, producto_id, desde_cantidad, precio)
         values (app.negocio_actual(), $1, $2, $3, $4)
         on conflict (lista_id, producto_id, desde_cantidad) do update set precio = excluded.precio`, [lista, producto, desde, precio]);
    }
    return { guardado: true };
  });

  /** Precios de la lista para un carrito (para mostrarlos antes de cobrar). */
  r.negocio("POST", "/listas/:id/cotizar", async (p, { db }) => {
    const id = uuid(p.params.id, "La lista");
    const items = lista(objeto(p.cuerpo).items, "Los productos", { min: 1, max: 200 }).map((x) => {
      const it = objeto(x);
      return { producto_id: uuid(it.producto_id, "El producto"), cantidad: numero(it.cantidad, "La cantidad", { min: 0.001, decimales: 3 }) };
    });
    const precios = [];
    for (const it of items) {
      const { rows } = await db.query<{ precio: number | null }>("select app.precio_lista($1, $2, $3) as precio", [it.producto_id, id, it.cantidad]);
      precios.push({ producto_id: it.producto_id, precio: rows[0]?.precio ?? null });
    }
    return { precios };
  });

  // ---------- Series y garantías ----------

  r.negocio("GET", "/series", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const estado = p.query.get("estado");
    const { rows } = await db.query(
      `select s.id, s.serie, s.estado, s.vendida_en, s.garantia_hasta, s.nota, s.producto_id, p.nombre as producto,
              cl.nombre as cliente, cl.celular, v.numero as venta_numero,
              (s.garantia_hasta is not null and s.garantia_hasta >= current_date) as en_garantia
       from app.serie s join app.producto p on p.id = s.producto_id
       left join app.cliente cl on cl.id = s.cliente_id left join app.venta v on v.id = s.venta_id
       where ($1 = '' or s.serie ilike '%' || $1 || '%' or catalogo.normalizar(p.nombre) like '%' || catalogo.normalizar($1) || '%')
         and ($2::text is null or s.estado = $2)
       order by coalesce(s.vendida_en, s.creado_en::date) desc, s.serie limit 300`, [q, estado]);
    return { series: rows };
  });

  r.negocio("POST", "/series", async (p, { db, rol }) => {
    if (rol === "cajero") throw prohibido();
    await db.query("select app.exigir_modulo('M23')");
    const c = objeto(p.cuerpo);
    const producto = uuid(c.producto_id, "El producto");
    const series = [...new Set(lista(c.series, "Las series", { min: 1, max: 500 }).map((x) => texto(x, "La serie", { max: 60 })))];
    const { rows } = await db.query<{ n: number }>(
      `with nuevas as (
         insert into app.serie (negocio_id, producto_id, serie)
         select app.negocio_actual(), $1, s from unnest($2::text[]) s
         on conflict (negocio_id, producto_id, serie) do nothing returning 1)
       select count(*)::int as n from nuevas`, [producto, `{${series.map((s) => `"${s.replace(/["\\]/g, "\\$&")}"`).join(",")}}`]);
    return { status: 201, cuerpo: { agregadas: rows[0]!.n, repetidas: series.length - rows[0]!.n } };
  });

  r.negocio("POST", "/ventas/:id/series", async (p, { db }) => {
    const c = objeto(p.cuerpo);
    const { rows } = await db.query("select * from app.vender_serie($1, $2, $3)", [
      uuid(p.params.id, "La venta"), uuid(c.producto_id, "El producto"), texto(c.serie, "La serie", { max: 60 })]);
    return { status: 201, cuerpo: { serie: rows[0] } };
  });

  // ---------- Catálogo en línea (configuración) ----------

  r.negocio("GET", "/catalogo/config", async (_p, { db }) => {
    const { rows } = await db.query("select slug, activo, whatsapp, mensaje, mostrar_agotados, acepta_pedidos, costo_envio from app.catalogo_config");
    const { rows: ocultos } = await db.query("select producto_id from app.catalogo_oculto");
    const { rows: n } = await db.query<{ nombre: string }>("select nombre from app.negocio where id = app.negocio_actual()");
    const sugerido = (n[0]?.nombre ?? "mi-negocio").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mi-negocio";
    return { config: rows[0] ?? null, ocultos: ocultos.map((o) => (o as { producto_id: string }).producto_id), sugerido };
  });

  r.negocio("POST", "/catalogo/config", async (p, { db, rol }) => {
    soloGestion(rol);
    await db.query("select app.exigir_modulo('M18')");
    const c = objeto(p.cuerpo);
    const slug = texto(c.slug, "La dirección del catálogo", { min: 3, max: 40 }).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) throw invalido("La dirección solo puede tener letras, números y guiones");
    const wa = textoOpcional(c.whatsapp, "El WhatsApp", { max: 20 })?.replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593") ?? null;
    if (wa && !/^\d{10,15}$/.test(wa)) throw invalido("El número de WhatsApp no es válido");
    try {
      await db.query(
        `insert into app.catalogo_config (negocio_id, slug, activo, whatsapp, mensaje, mostrar_agotados, acepta_pedidos, costo_envio)
         values (app.negocio_actual(), $1, $2, $3, $4, $5, $6, $7)
         on conflict (negocio_id) do update set slug = excluded.slug, activo = excluded.activo, whatsapp = excluded.whatsapp,
           mensaje = excluded.mensaje, mostrar_agotados = excluded.mostrar_agotados, acepta_pedidos = excluded.acepta_pedidos,
           costo_envio = excluded.costo_envio, actualizado_en = now()`, [
          slug, c.activo === undefined ? true : booleano(c.activo, "Activo"), wa,
          textoOpcional(c.mensaje, "El mensaje", { max: 300 }),
          c.mostrar_agotados === undefined ? false : booleano(c.mostrar_agotados, "Mostrar agotados"),
          c.acepta_pedidos === undefined ? true : booleano(c.acepta_pedidos, "Acepta pedidos"),
          numeroOpcional(c.costo_envio, "El costo del envío", { min: 0, max: 1000, decimales: 2 })]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorApp(409, "Esa dirección ya la usa otro negocio: prueba otra", "duplicado");
      throw e;
    }
    return { guardado: true, slug };
  });

  r.negocio("POST", "/catalogo/ocultos", async (p, { db, rol }) => {
    soloGestion(rol);
    const c = objeto(p.cuerpo);
    const producto = uuid(c.producto_id, "El producto");
    if (booleano(c.oculto, "Oculto")) {
      await db.query("insert into app.catalogo_oculto (negocio_id, producto_id) values (app.negocio_actual(), $1) on conflict do nothing", [producto]);
    } else {
      await db.query("delete from app.catalogo_oculto where producto_id = $1", [producto]);
    }
    return { guardado: true };
  });

  // ---------- Catálogo en línea (público, sin sesión) ----------

  const pedidosPorIp = new Limitador(10, 15 * 60_000);

  r.publico("GET", "/tienda/:slug", async (p) => {
    const slug = (p.params.slug ?? "").toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw noEncontrado("Catálogo no encontrado");
    const { rows } = await dep.pool.query<{ c: unknown }>("select app.catalogo_publico($1) as c", [slug]);
    if (!rows[0]?.c) throw noEncontrado("Catálogo no encontrado");
    return { catalogo: rows[0].c };
  });

  r.publico("POST", "/tienda/:slug/pedido", async (p) => {
    if (!pedidosPorIp.permitir(p.ip)) throw new ErrorApp(429, "Demasiados pedidos seguidos. Intenta en unos minutos", "limite");
    const slug = (p.params.slug ?? "").toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw noEncontrado("Catálogo no encontrado");
    const c = objeto(p.cuerpo);
    const pedido = {
      nombre: texto(c.nombre, "Tu nombre", { max: 120 }),
      celular: texto(c.celular, "Tu celular", { min: 7, max: 20 }),
      tipo: opcion(c.tipo ?? "retiro", "El tipo", ["retiro", "domicilio"] as const),
      direccion: textoOpcional(c.direccion, "La dirección", { max: 300 }),
      referencia: textoOpcional(c.referencia, "La referencia", { max: 200 }),
      nota: textoOpcional(c.nota, "La nota", { max: 300 }),
      items: lista(c.items, "Los productos", { min: 1, max: 50 }).map((x) => {
        const it = objeto(x);
        return { producto_id: uuid(it.producto_id, "El producto"), cantidad: numero(it.cantidad, "La cantidad", { min: 1, max: 999, decimales: 0 }) };
      }),
    };
    if (pedido.tipo === "domicilio" && !pedido.direccion) throw invalido("Escribe la dirección de entrega");
    const { rows } = await dep.pool.query<{ r: { numero: number; total: number } }>("select app.catalogo_pedido($1, $2) as r", [slug, pedido]);
    return { status: 201, cuerpo: { pedido: rows[0]!.r } };
  });
}


