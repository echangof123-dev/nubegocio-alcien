/**
 * Migraciones al arrancar (para servicios sin terminal, como Render con Neon).
 * Hace lo mismo que db/scripts/migrate.sh + el seed + crear_usuario_api.sh, sin psql:
 *   1. aplica las migraciones pendientes de db/migrations (cada una en su transacción),
 *   2. carga el catálogo de db/seed si cambió,
 *   3. crea o actualiza el usuario sin privilegios con el que se conecta la API.
 * Usa la conexión de administrador (dueña de las tablas); la API sigue usando alcien_api.
 *
 * "Modo sin roles": si el proveedor no deja crear usuarios (sin CREATEROLE, como algunos
 * PostgreSQL administrados), la API usa a la dueña de las tablas y el aislamiento entre negocios
 * se mantiene: la seguridad por fila se vuelve obligatoria también para la dueña (FORCE) y solo
 * las funciones SECURITY DEFINER pueden ver todos los negocios. Para marcarlas se usa
 * application_name = 'alcien-sistema' en la propia función: sin superusuario no se pueden fijar
 * parámetros propios (app.*) en ALTER FUNCTION, y application_name sí.
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

const SQL_SIN_ROLES = `
do $$
declare r record;
begin
  -- Las políticas dejan pasar solo a las funciones del sistema
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'app' and policyname = 'aislamiento_negocio' loop
    if position('alcien-sistema' in r.qual) = 0 then
      execute format('alter policy %I on %I.%I using ((%s) or current_setting(''application_name'') = ''alcien-sistema'') '
                     'with check ((%s) or current_setting(''application_name'') = ''alcien-sistema'')',
                     r.policyname, r.schemaname, r.tablename, r.qual, coalesce(r.with_check, r.qual));
    end if;
  end loop;
  -- El dueño de las tablas también queda sujeto a la seguridad por fila
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relrowsecurity and not c.relforcerowsecurity and n.nspname = 'app' loop
    execute format('alter table %I.%I force row level security', r.nspname, r.relname);
  end loop;
  -- Las funciones SECURITY DEFINER son las únicas que ven todos los negocios
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prosecdef and n.nspname in ('app', 'auth', 'catalogo')
             and not coalesce(p.proconfig, '{}') @> array['application_name=alcien-sistema'] loop
    execute format('alter function %s set application_name = ''alcien-sistema''', r.f);
  end loop;
end $$;`;

export interface ResultadoMigrar { aplicadas: string[]; seed: boolean; sinRoles: boolean }

export async function migrar(o: OpcionesMigrar): Promise<ResultadoMigrar> {
  const log = o.log ?? (() => {});
  const c = new ConexionPg({ ...o.admin, applicationName: "alcien-migrar" });
  await c.conectar();
  try {
    // Una sola instancia migra a la vez
    await c.query("select pg_advisory_lock(7272001)");
    await c.simple(`create table if not exists public.schema_migrations (
      version text primary key, aplicada_en timestamptz not null default now())`);
    const { rows: yo } = await c.query<{ usuario: string; puede: boolean }>(
      "select current_user as usuario, (rolcreaterole or rolsuper) as puede from pg_roles where rolname = current_user");
    const duena = yo[0]!.usuario;
    const sinRoles = !yo[0]!.puede;
    if (sinRoles && !/^[a-z_][a-z0-9_]*$/.test(duena)) throw new Error(`Nombre de usuario de la base no soportado: ${duena}`);
    // Sin CREATEROLE, los permisos que las migraciones dan a alcien_app se dan a la dueña (no cambian nada)
    const adaptar = (sql: string) => (sinRoles ? sql.replace(/\balcien_app\b/g, duena) : sql);
    if (sinRoles) log("la base no permite crear usuarios: modo sin roles", { usuario: duena });

    const { rows } = await c.query<{ version: string }>("select version from public.schema_migrations");
    const hechas = new Set(rows.map((r) => r.version));

    const dirMig = path.join(o.dirDb, "migrations");
    const archivos = fs.readdirSync(dirMig).filter((f) => f.endsWith(".sql")).sort();
    const aplicadas: string[] = [];
    for (const f of archivos) {
      const version = f.replace(/\.sql$/, "");
      if (hechas.has(version)) continue;
      const sql = adaptar(fs.readFileSync(path.join(dirMig, f), "utf8"));
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

    if (sinRoles) {
      await c.simple(SQL_SIN_ROLES);
      await c.query("select pg_advisory_unlock(7272001)");
      return { aplicadas, seed: seedCargado, sinRoles };
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
    return { aplicadas, seed: seedCargado, sinRoles };
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
