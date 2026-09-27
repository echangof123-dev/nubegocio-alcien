/** Migra la base de ALCIEN_DB_ADMIN_URL como lo hace la app al arrancar (lo usan las pruebas). */
import path from "node:path";
import { migrar, desdeUrl } from "../src/migrar.js";

const url = process.env.ALCIEN_DB_ADMIN_URL;
if (!url) throw new Error("Falta ALCIEN_DB_ADMIN_URL");
const r = await migrar({
  admin: desdeUrl(url),
  dirDb: path.join(import.meta.dirname, "..", "..", "..", "db"),
  usuarioApi: process.env.PGUSER_API ?? "alcien_api",
  claveApi: process.env.PGPASSWORD_API ?? "alcien-dev",
});
console.log(`Base migrada: ${r.aplicadas.length} migraciones${r.sinRoles ? " (modo sin roles)" : ""}`);
