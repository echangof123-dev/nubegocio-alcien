import type http from "node:http";
import type { Config } from "./config.js";
import { Pool } from "./db/pool.js";
import { Router, crearServidor } from "./http/servidor.js";
import { ServicioAcceso } from "./auth/acceso.js";
import { crearEnviador, type EnviadorCodigos } from "./auth/whatsapp.js";
import { crearGenerador, type GeneradorPlantillas } from "./ia/plantillas.js";
import { rutasAcceso } from "./rutas/acceso.js";
import { rutasNegocio } from "./rutas/negocio.js";
import { rutasProductos } from "./rutas/productos.js";
import { rutasVentas } from "./rutas/ventas.js";

export interface App {
  servidor: http.Server;
  pool: Pool;
  enviador: EnviadorCodigos;
  cerrar(): Promise<void>;
}

export function log(nivel: "info" | "error", msg: string, extra: Record<string, unknown> = {}) {
  // Formato JSON: Cloud Logging lo entiende directamente
  console.log(JSON.stringify({ severity: nivel === "error" ? "ERROR" : "INFO", message: msg, ...extra }));
}

export function crearApp(cfg: Config, opc: { enviador?: EnviadorCodigos; ia?: GeneradorPlantillas; silencioso?: boolean } = {}): App {
  const pool = new Pool({ ...cfg.db, applicationName: "alcien-api" }, cfg.db.max);
  const enviador = opc.enviador ?? crearEnviador(cfg.whatsapp);
  const ia = opc.ia ?? crearGenerador(cfg.ia);
  // En pruebas automáticas todas las peticiones vienen de la misma IP
  const limites = cfg.entorno === "pruebas" ? { porIp: 10_000, global: 10_000 } : { porIp: 10, global: 500 };
  const acceso = new ServicioAcceso(pool, enviador, cfg.secretoCodigos, limites);
  const registrar = opc.silencioso ? () => {} : log;

  const router = new Router();
  router.publico("GET", "/salud", async () => {
    await pool.query("select 1");
    return { ok: true };
  });
  rutasAcceso(router, { db: pool, acceso, enviador, desarrollo: cfg.entorno !== "produccion", produccion: cfg.entorno === "produccion" });
  rutasNegocio(router, { pool, ia, log: (m, e) => registrar("error", m, { error: String(e) }) });
  rutasProductos(router);
  rutasVentas(router);

  const servidor = crearServidor(router, {
    pool,
    resolverSesion: (t) => acceso.resolverSesion(t),
    origenes: cfg.origenes,
    webDir: cfg.webDir,
    produccion: cfg.entorno === "produccion",
    log: registrar,
  });

  return {
    servidor,
    pool,
    enviador,
    async cerrar() {
      await new Promise<void>((ok) => servidor.close(() => ok()));
      await pool.cerrar();
    },
  };
}
