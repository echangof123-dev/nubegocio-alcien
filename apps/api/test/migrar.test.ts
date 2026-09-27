/** Migraciones al arrancar (Render + Neon): base vacía → esquema, catálogo y usuario de la API. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ConexionPg } from "../src/db/pgwire.js";
import { migrar, desdeUrl } from "../src/migrar.js";
import { cargarConfig } from "../src/config.js";

const BASE = "alcien_migrar_test";
const admin = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
};

async function sql(database: string, q: string) {
  const c = new ConexionPg({ ...admin, database });
  await c.conectar();
  try { return await c.simple(q); } finally { await c.cerrar(); }
}

test("URL de la base y configuración para Render + Neon", () => {
  const o = desdeUrl("postgresql://neondb_owner:cl%40ve@ep-azul-123.us-east-2.aws.neon.tech/neondb?sslmode=require");
  assert.deepEqual(o, { host: "ep-azul-123.us-east-2.aws.neon.tech", port: 5432, user: "neondb_owner", password: "cl@ve", database: "neondb", ssl: true });

  const cfg = cargarConfig({
    ALCIEN_ENTORNO: "produccion", ALCIEN_SECRETO_CODIGOS: "x".repeat(40), ALCIEN_CLAVE_FIRMAS: "texto-largo-que-no-es-base64-de-32-bytes!!",
    WHATSAPP_PROVEEDOR: "registro", ALCIEN_PERMITIR_CODIGOS_EN_REGISTRO: "true",
    ALCIEN_DB_ADMIN_URL: "postgres://duena:secreta@db.ejemplo.com/app?sslmode=require", ALCIEN_DB_API_PASSWORD: "p".repeat(20),
  });
  assert.equal(cfg.db.user, "alcien_api", "la API no usa al dueño de las tablas");
  assert.equal(cfg.db.host, "db.ejemplo.com");
  assert.equal(cfg.db.ssl, true);
  assert.equal(cfg.migrar?.admin.user, "duena");
  assert.equal(cfg.sri.claveFirmas.length, 32, "la clave de firmas se deriva si no es base64 de 32 bytes");
  assert.throws(() => cargarConfig({ ALCIEN_ENTORNO: "produccion", ALCIEN_SECRETO_CODIGOS: "x".repeat(40), ALCIEN_CLAVE_FIRMAS: "c".repeat(44), WHATSAPP_PROVEEDOR: "registro" }),
    /ALCIEN_PERMITIR_CODIGOS_EN_REGISTRO/, "la beta cerrada debe pedirse explícitamente");
});

test("migrar una base vacía, dos veces", async () => {
  await sql("postgres", `drop database if exists ${BASE}`);
  await sql("postgres", `create database ${BASE}`);
  try {
    const opc = {
      admin: { ...admin, database: BASE },
      dirDb: path.join(import.meta.dirname, "..", "..", "..", "db"),
      usuarioApi: "alcien_api_migrar",
      claveApi: "clave-de-prueba-larga-123",
    };
    const r1 = await migrar(opc);
    assert.ok(r1.aplicadas.includes("0009_sri"), JSON.stringify(r1));
    assert.equal(r1.seed, true);

    const r2 = await migrar(opc);
    assert.deepEqual(r2, { aplicadas: [], seed: false, sinRoles: false }, "la segunda vez no hace nada");

    // La API entra con su propio usuario, que no se salta la seguridad por fila
    const api = new ConexionPg({ ...admin, database: BASE, user: opc.usuarioApi, password: opc.claveApi });
    await api.conectar();
    const { rows } = await api.query<{ n: number; bypass: boolean }>(
      "select (select count(*)::int from catalogo.tipo_negocio) as n, (select rolbypassrls from pg_roles where rolname = current_user) as bypass");
    await api.cerrar();
    assert.equal(rows[0]!.n, 216);
    assert.equal(rows[0]!.bypass, false);
  } finally {
    await sql("postgres", `drop database if exists ${BASE}`);
  }
});
