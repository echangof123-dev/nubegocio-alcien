import type { Router } from "../http/servidor.js";
import type { Pool } from "../db/pool.js";
import { ArregloPg } from "../db/pgwire.js";
import type { GeneradorPlantillas } from "../ia/plantillas.js";
import { prohibido } from "../http/errores.js";
import { booleano, celular, lista, numero, objeto, opcion, texto, textoOpcional, uuid } from "../http/validar.js";

const METODOS = ["efectivo", "transferencia", "tarjeta", "deuna"] as const;

export function rutasNegocio(r: Router, dep: { pool: Pool; ia: GeneradorPlantillas; log: (m: string, e?: unknown) => void }) {
  const { pool } = dep;

  // ---------- Catálogo ----------

  r.sesion("GET", "/tipos-negocio", async (p) => {
    const q = (p.query.get("q") ?? "").slice(0, 80);
    const limite = Math.min(Number(p.query.get("limite") ?? 6) || 6, 20);
    const { rows } = await pool.query("select * from catalogo.buscar_tipos($1, $2)", [q, limite]);
    return { tipos: rows };
  });

  /** El usuario describe su negocio con sus palabras y no encontró su tipo. */
  r.sesion("POST", "/tipos-negocio/sugerir", async (p) => {
    const descripcion = texto(objeto(p.cuerpo).descripcion, "La descripción", { min: 3, max: 200 });

    // Antes de gastar en IA, una última búsqueda con el texto completo
    const { rows: parecidos } = await pool.query<{ codigo: string; puntaje: number }>(
      "select codigo, puntaje from catalogo.buscar_tipos($1, 1)", [descripcion]);
    if (parecidos[0] && parecidos[0].puntaje >= 0.8) {
      const { rows } = await pool.query("select codigo, nombre, familia from catalogo.tipo_negocio where codigo = $1", [parecidos[0].codigo]);
      return { tipo: rows[0], origen: "catalogo" };
    }

    const { rows: familias } = await pool.query<{ codigo: string; nombre: string; descripcion: string }>(
      "select codigo, nombre, descripcion from catalogo.familia order by codigo");
    let propuesta = null;
    try {
      propuesta = await dep.ia.proponer(descripcion, familias);
    } catch (e) {
      dep.log("La IA no respondió; se usa la familia general", e);
    }

    // Sin IA (o si falló): el negocio igual se crea con la familia "Retail general" y sin productos
    const tipo = propuesta ?? { nombre: descripcion.slice(0, 80), familia: "F06", sinonimos: [], categorias: [], productos: [] };
    const { rows } = await pool.query<{ codigo: string }>(
      "select catalogo.registrar_tipo_ia($1, $2, $3, $4, $5) as codigo",
      [tipo.nombre.length >= 3 ? tipo.nombre : `Negocio: ${tipo.nombre}`, tipo.familia,
       new ArregloPg(tipo.sinonimos), new ArregloPg(tipo.categorias), tipo.productos]);
    const { rows: final } = await pool.query("select codigo, nombre, familia from catalogo.tipo_negocio where codigo = $1", [rows[0]!.codigo]);
    return { tipo: final[0], origen: propuesta ? "ia" : "general" };
  });

  // ---------- Crear y ver el negocio ----------

  r.sesion("POST", "/negocios", async (p) => {
    const c = objeto(p.cuerpo);
    const tipo = texto(c.tipo, "El tipo de negocio", { max: 10 });
    const nombre = texto(c.nombre, "El nombre del negocio", { min: 2, max: 120 });
    const ruc = textoOpcional(c.ruc, "El RUC", { max: 13 });
    const id = await pool.transaccion(async (db) => {
      const { rows } = await db.query<{ id: string }>("select app.crear_negocio($1, $2, $3, $4) as id", [p.usuarioId, tipo, nombre, ruc]);
      return rows[0]!.id;
    });
    return { status: 201, cuerpo: { id } };
  });

  r.negocio("GET", "/negocio", async (_p, { db, rol }) => {
    const { rows: n } = await db.query(
      `select n.id, n.nombre, n.familia, f.nombre as familia_nombre, t.nombre as tipo, n.ruc, n.razon_social, n.regimen,
              s.plan, s.estado as suscripcion, s.vence_en, app.plan_vigente(n.id) as plan_vigente,
              c.palabra_items, c.unidad_defecto, c.iva_defecto, c.metodos_pago, c.permite_vender_sin_stock, c.exige_caja_abierta,
              c.direccion, c.telefono, c.mensaje_recibo
       from app.negocio n
       join catalogo.familia f on f.codigo = n.familia
       join catalogo.tipo_negocio t on t.id = n.tipo_negocio_id
       join app.suscripcion s on s.negocio_id = n.id
       join app.negocio_config c on c.negocio_id = n.id`);
    const { rows: modulos } = await db.query("select * from app.modulos_visibles()");
    return { negocio: n[0], rol, modulos };
  });

  r.negocio("POST", "/negocio/modulos/:codigo", async (p, { db }) => {
    const activo = booleano(objeto(p.cuerpo).activo, "activo");
    await db.query(activo ? "select app.activar_modulo($1)" : "select app.desactivar_modulo($1)", [p.params.codigo]);
    const { rows } = await db.query("select * from app.modulos_visibles()");
    return { modulos: rows };
  });

  // ---------- Equipo ----------

  r.negocio("GET", "/negocio/equipo", async (_p, { db }) => {
    const { rows } = await db.query(
      `select u.id, u.nombre, u.celular, m.rol, m.activo, m.creado_en
       from app.membresia m join auth.usuario u on u.id = m.usuario_id
       order by m.activo desc, m.creado_en`);
    return { equipo: rows };
  });

  /** Invita a alguien por su celular. Entra con su propio código de WhatsApp. */
  r.negocio("POST", "/negocio/equipo", async (p, { db, rol }) => {
    const c = objeto(p.cuerpo);
    const numero = celular(c.celular);
    const nuevoRol = opcion(c.rol, "El rol", ["administrador", "cajero", "bodeguero"] as const);
    if (rol !== "dueno" && !(rol === "administrador" && nuevoRol !== "administrador")) {
      throw prohibido("Solo el dueño agrega administradores; el administrador agrega cajeros y bodegueros");
    }
    const { rows: u } = await db.query<{ id: string }>(
      `insert into auth.usuario (celular, nombre) values ($1, $2)
       on conflict (celular) do update set nombre = coalesce(auth.usuario.nombre, excluded.nombre)
       returning id`, [numero, textoOpcional(c.nombre, "El nombre", { max: 80 })]);
    await db.query(
      `insert into app.membresia (usuario_id, negocio_id, rol) values ($1, app.negocio_actual(), $2)
       on conflict (usuario_id, negocio_id) do update set rol = excluded.rol, activo = true
       where app.membresia.rol <> 'dueno'`, [u[0]!.id, nuevoRol]);
    return { status: 201, cuerpo: { usuario_id: u[0]!.id, rol: nuevoRol } };
  });

  r.negocio("PATCH", "/negocio/equipo/:usuario", async (p, { db, rol, usuarioId }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido();
    const otro = uuid(p.params.usuario, "El usuario");
    if (otro === usuarioId) throw prohibido("No puedes cambiarte a ti mismo");
    const c = objeto(p.cuerpo);
    const activo = c.activo === undefined ? null : booleano(c.activo, "activo");
    const nuevoRol = c.rol === undefined ? null : opcion(c.rol, "El rol", ["administrador", "cajero", "bodeguero"] as const);
    if (nuevoRol === "administrador" && rol !== "dueno") throw prohibido("Solo el dueño nombra administradores");
    const res = await db.query(
      `update app.membresia set activo = coalesce($2, activo), rol = coalesce($4, rol)
       where usuario_id = $1 and rol <> 'dueno' and ($3 = 'dueno' or rol in ('cajero', 'bodeguero'))`,
      [otro, activo, rol, nuevoRol]);
    if (res.rowCount === 0) throw prohibido("No puedes cambiar a esa persona");
    const nombre = textoOpcional(c.nombre, "El nombre", { max: 80 });
    // El nombre es de la persona (sirve en todos sus negocios): solo se pone si aún no tiene
    if (nombre) await db.query("update auth.usuario set nombre = $2 where id = $1 and nombre is null", [otro, nombre]);
    return { activo, rol: nuevoRol };
  });

  r.negocio("PATCH", "/negocio/config", async (p, { db, rol }) => {
    if (rol !== "dueno" && rol !== "administrador") throw prohibido();
    const c = objeto(p.cuerpo);
    const cambios: string[] = [];
    const valores: unknown[] = [];
    if (c.metodos_pago !== undefined) {
      const m = lista(c.metodos_pago, "Los métodos de pago", { min: 1, max: 4 }).map((x) => opcion(x, "Método de pago", METODOS));
      valores.push(new ArregloPg([...new Set(m)]));
      cambios.push(`metodos_pago = $${valores.length}::text[]`);
    }
    for (const campo of ["permite_vender_sin_stock", "exige_caja_abierta"] as const) {
      if (c[campo] !== undefined) {
        valores.push(booleano(c[campo], campo));
        cambios.push(`${campo} = $${valores.length}`);
      }
    }
    for (const [campo, max] of [["direccion", 300], ["telefono", 30], ["mensaje_recibo", 200]] as const) {
      if (c[campo] !== undefined) {
        valores.push(textoOpcional(c[campo], campo, { max }));
        cambios.push(`${campo} = $${valores.length}`);
      }
    }
    if (c.iva_defecto !== undefined) {
      valores.push(opcion(String(numero(c.iva_defecto, "IVA")), "IVA", ["0", "5", "8", "15"] as const));
      cambios.push(`iva_defecto = $${valores.length}::numeric`);
    }
    if (cambios.length) await db.query(`update app.negocio_config set ${cambios.join(", ")}`, valores);
    const { rows } = await db.query("select * from app.negocio_config");
    return { config: rows[0] };
  });
}
