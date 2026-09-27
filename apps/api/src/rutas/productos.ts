import type { Router } from "../http/servidor.js";
import { noEncontrado, prohibido } from "../http/errores.js";
import { booleano, numero, numeroOpcional, objeto, texto, textoOpcional, uuid, uuidOpcional } from "../http/validar.js";

const COLUMNAS = `p.id, p.nombre, p.categoria_id, c.nombre as categoria, p.unidad, p.precio, p.costo, p.iva,
  p.codigo_barras, p.maneja_stock, p.stock, p.stock_minimo, p.variantes, p.es_ejemplo, p.activo`;

export function rutasProductos(r: Router) {
  r.negocio("GET", "/categorias", async (_p, { db }) => {
    const { rows } = await db.query(
      `select c.id, c.nombre, c.orden, count(p.id)::int as productos
       from app.categoria c left join app.producto p on p.categoria_id = c.id and p.activo
       group by c.id order by c.orden, c.nombre`);
    return { categorias: rows };
  });

  r.negocio("POST", "/categorias", async (p, { db, rol }) => {
    if (rol === "cajero") throw prohibido();
    const nombre = texto(objeto(p.cuerpo).nombre, "El nombre de la categoría", { max: 60 });
    const { rows } = await db.query(
      `insert into app.categoria (negocio_id, nombre, orden)
       values (app.negocio_actual(), $1, coalesce((select max(orden) + 1 from app.categoria), 1))
       returning id, nombre, orden`, [nombre]);
    return { status: 201, cuerpo: { categoria: rows[0] } };
  });

  r.negocio("GET", "/productos", async (p, { db }) => {
    const q = (p.query.get("q") ?? "").trim().slice(0, 60);
    const categoria = uuidOpcional(p.query.get("categoria"), "La categoría");
    const { rows } = await db.query(
      `select ${COLUMNAS}
       from app.producto p left join app.categoria c on c.id = p.categoria_id
       where p.activo
         and ($1 = '' or catalogo.normalizar(p.nombre) like '%' || catalogo.normalizar($1) || '%' or p.codigo_barras = $1)
         and ($2::uuid is null or p.categoria_id = $2)
       order by c.orden nulls last, p.nombre
       limit 500`, [q, categoria]);
    return { productos: rows };
  });

  r.negocio("GET", "/productos/codigo/:codigo", async (p, { db }) => {
    const { rows } = await db.query(
      `select ${COLUMNAS} from app.producto p left join app.categoria c on c.id = p.categoria_id
       where p.codigo_barras = $1 and p.activo`, [p.params.codigo]);
    if (!rows[0]) throw noEncontrado("No hay un producto con ese código");
    return { producto: rows[0] };
  });

  r.negocio("POST", "/productos", async (p, { db, rol }) => {
    if (rol === "cajero") throw prohibido();
    const c = objeto(p.cuerpo);
    const valores = [
      texto(c.nombre, "El nombre", { max: 80 }),
      uuidOpcional(c.categoria_id, "La categoría"),
      texto(c.unidad ?? "Unidad", "La unidad", { max: 30 }),
      numeroOpcional(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 }),
      numeroOpcional(c.costo, "El costo", { min: 0, max: 1_000_000, decimales: 4 }),
      textoOpcional(c.codigo_barras, "El código de barras", { max: 32 }),
      c.maneja_stock === undefined ? true : booleano(c.maneja_stock, "Maneja stock"),
      numeroOpcional(c.stock_minimo, "El stock mínimo", { min: 0, decimales: 3 }),
      textoOpcional(c.variantes, "Las variantes", { max: 200 }),
    ];
    if (rol === "bodeguero" && valores[3] !== null) throw prohibido("Solo el dueño o un administrador ponen precios");
    const stockInicial = numeroOpcional(c.stock_inicial, "El stock inicial", { min: 0, decimales: 3 });

    const { rows } = await db.query<{ id: string }>(
      `insert into app.producto (negocio_id, nombre, categoria_id, unidad, precio, costo, codigo_barras, maneja_stock, stock_minimo, variantes)
       values (app.negocio_actual(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, valores);
    const id = rows[0]!.id;
    if (stockInicial && valores[6]) {
      await db.query("select app.mover_stock($1, 'inicial', $2, null, 'Stock inicial', $3)", [id, stockInicial, valores[4]]);
    }
    const { rows: prod } = await db.query(
      `select ${COLUMNAS} from app.producto p left join app.categoria c on c.id = p.categoria_id where p.id = $1`, [id]);
    return { status: 201, cuerpo: { producto: prod[0] } };
  });

  r.negocio("PATCH", "/productos/:id", async (p, { db, rol }) => {
    if (rol === "cajero") throw prohibido();
    const id = uuid(p.params.id, "El producto");
    const c = objeto(p.cuerpo);
    const campos: [string, unknown][] = [];
    if (c.nombre !== undefined) campos.push(["nombre", texto(c.nombre, "El nombre", { max: 80 })]);
    if (c.categoria_id !== undefined) campos.push(["categoria_id", uuidOpcional(c.categoria_id, "La categoría")]);
    if (c.unidad !== undefined) campos.push(["unidad", texto(c.unidad, "La unidad", { max: 30 })]);
    if (c.precio !== undefined) {
      if (rol === "bodeguero") throw prohibido("Solo el dueño o un administrador cambian precios");
      campos.push(["precio", numeroOpcional(c.precio, "El precio", { min: 0, max: 1_000_000, decimales: 2 })]);
    }
    if (c.costo !== undefined) campos.push(["costo", numeroOpcional(c.costo, "El costo", { min: 0, max: 1_000_000, decimales: 4 })]);
    if (c.codigo_barras !== undefined) campos.push(["codigo_barras", textoOpcional(c.codigo_barras, "El código de barras", { max: 32 })]);
    if (c.maneja_stock !== undefined) campos.push(["maneja_stock", booleano(c.maneja_stock, "Maneja stock")]);
    if (c.stock_minimo !== undefined) campos.push(["stock_minimo", numeroOpcional(c.stock_minimo, "El stock mínimo", { min: 0, decimales: 3 })]);
    if (c.activo !== undefined) campos.push(["activo", booleano(c.activo, "Activo")]);

    if (campos.length) {
      const sets = campos.map(([k], i) => `${k} = $${i + 2}`).join(", ");
      const res = await db.query(`update app.producto set ${sets} where id = $1`, [id, ...campos.map(([, v]) => v)]);
      if (res.rowCount === 0) throw noEncontrado("Producto no encontrado");
    }
    const { rows } = await db.query(
      `select ${COLUMNAS} from app.producto p left join app.categoria c on c.id = p.categoria_id where p.id = $1`, [id]);
    if (!rows[0]) throw noEncontrado("Producto no encontrado");
    return { producto: rows[0] };
  });

  r.negocio("POST", "/productos/:id/stock", async (p, { db }) => {
    const id = uuid(p.params.id, "El producto");
    const c = objeto(p.cuerpo);
    const stock = numero(c.stock, "El stock", { min: 0, decimales: 3 });
    const motivo = textoOpcional(c.motivo, "El motivo", { max: 120 }) ?? "Conteo";
    const { rows } = await db.query<{ stock: number }>("select app.ajustar_stock($1, $2, $3) as stock", [id, stock, motivo]);
    return { stock: rows[0]!.stock };
  });
}
