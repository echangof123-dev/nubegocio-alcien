/**
 * Migraciones al arrancar (para servicios sin terminal, como Render con Neon).
 * Hace lo mismo que db/scripts/migrate.sh + el seed + crear_usuario_api.sh, sin psql:
 *   1. aplica las migraciones pendientes de db/migrations (cada una en su transacción),
 *   2. carga el catálogo de db/seed si cambió,
 *   3. crea o actualiza el usuario sin privilegios con el que se conecta la API.
 * Usa la conexión de administrador (dueña de las tablas); la API sigue usando alcien_api.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ConexionPg, type OpcionesConexion } from "./db/pgwire.js";

export interface OpcionesMigrar {
  admin: OpcionesConexion;
  dirDb: string;
  usuarioApi: string;
  claveApi: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export async function migrar(o: OpcionesMigrar): Promise<{ aplicadas: string[]; seed: boolean }> {
  const log = o.log ?? (() => {});
  const c = new ConexionPg({ ...o.admin, applicationName: "alcien-migrar" });
  await c.conectar();
  try {
    // Una sola instancia migra a la vez
    await c.query("select pg_advisory_lock(7272001)");
    await c.simple(`create table if not exists public.schema_migrations (
      version text primary key, aplicada_en timestamptz not null default now())`);
    const { rows } = await c.query<{ version: string }>("select version from public.schema_migrations");
    const hechas = new Set(rows.map((r) => r.version));

    const dirMig = path.join(o.dirDb, "migrations");
    const archivos = fs.readdirSync(dirMig).filter((f) => f.endsWith(".sql")).sort();
    const aplicadas: string[] = [];
    for (const f of archivos) {
      const version = f.replace(/\.sql$/, "");
      if (hechas.has(version)) continue;
      const sql = fs.readFileSync(path.join(dirMig, f), "utf8");
      await c.simple("BEGIN");
      try {
        await c.simple(sql);
        await c.query("insert into public.schema_migrations (version) values ($1)", [version]);
        await c.simple("COMMIT");
      } catch (e) {
        await c.simple("ROLLBACK").catch(() => {});
        throw new Error(`La migración ${f} falló: ${(e as Error).message}`);
      }
      aplicadas.push(version);
      log("migración aplicada", { version });
    }

    // Catálogo: se recarga cuando cambia el archivo (es idempotente)
    const seed = fs.readFileSync(path.join(o.dirDb, "seed", "catalogo.sql"), "utf8");
    const marca = "seed:" + crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
    let seedCargado = false;
    if (!hechas.has(marca)) {
      await c.simple("BEGIN");
      try {
        await c.simple(seed);
        await c.query("delete from public.schema_migrations where version like 'seed:%'");
        await c.query("insert into public.schema_migrations (version) values ($1)", [marca]);
        await c.simple("COMMIT");
      } catch (e) {
        await c.simple("ROLLBACK").catch(() => {});
        throw new Error(`El catálogo no se pudo cargar: ${(e as Error).message}`);
      }
      seedCargado = true;
      log("catálogo cargado", { marca });
    }

    // Usuario de la API: hereda alcien_app y no se salta la seguridad por fila
    const { rows: existe } = await c.query("select 1 from pg_roles where rolname = $1", [o.usuarioApi]);
    const { rows: sentencia } = await c.query<{ s: string }>(
      existe.length
        ? "select format('alter role %I with login password %L', $1::text, $2::text) as s"
        : "select format('create role %I login nobypassrls password %L in role alcien_app', $1::text, $2::text) as s",
      [o.usuarioApi, o.claveApi]);
    await c.simple(sentencia[0]!.s);

    await c.query("select pg_advisory_unlock(7272001)");
    return { aplicadas, seed: seedCargado };
  } finally {
    await c.cerrar();
  }
}

/** Datos de conexión desde una URL postgres://usuario:clave@host:puerto/base?sslmode=require */
export function desdeUrl(url: string): OpcionesConexion {
  const u = new URL(url);
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error("La URL de la base debe empezar con postgres://");
  const modo = u.searchParams.get("sslmode") ?? "";
  return {
    host: decodeURIComponent(u.hostname),
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1) || "postgres"),
    ssl: ["require", "verify-ca", "verify-full", "prefer"].includes(modo),
  };
}
