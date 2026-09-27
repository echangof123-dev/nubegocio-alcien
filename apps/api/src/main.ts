import { cargarConfig } from "./config.js";
import { crearApp, log } from "./app.js";

const cfg = cargarConfig();

// Servicios sin terminal (Render + Neon): el esquema se aplica al arrancar
if (cfg.migrar) {
  const { migrar } = await import("./migrar.js");
  const r = await migrar({ ...cfg.migrar, log: (m, e) => log("info", m, e) });
  log("info", "base de datos al día", { aplicadas: r.aplicadas.length, catalogo: r.seed, sinRoles: r.sinRoles });
  // Sin permiso para crear usuarios, la API entra con la dueña (para ella la seguridad por fila es obligatoria)
  if (r.sinRoles) cfg.db = { ...cfg.db, user: cfg.migrar.admin.user, password: cfg.migrar.admin.password ?? "" };
}

const app = crearApp(cfg);

app.servidor.listen(cfg.puerto, () => {
  log("info", "Al Cien API escuchando", { puerto: cfg.puerto, entorno: cfg.entorno, whatsapp: cfg.whatsapp.proveedor, ia: cfg.ia.proveedor });
});

// Limpieza de códigos y sesiones vencidas cada hora
const limpieza = setInterval(() => {
  app.pool.query("select auth.limpiar()").catch((e) => log("error", "limpieza falló", { error: String(e) }));
}, 60 * 60_000);
limpieza.unref();

// Reintentos de envío al SRI (además de la tarea programada POST /api/tareas/sri)
if (cfg.sri.intervaloSeg > 0) {
  const sri = setInterval(() => {
    app.sri.procesarPendientes().catch((e) => log("error", "reintentos SRI fallaron", { error: String(e) }));
  }, cfg.sri.intervaloSeg * 1000);
  sri.unref();
}

// Cloud Run envía SIGTERM antes de apagar la instancia
for (const senal of ["SIGTERM", "SIGINT"] as const) {
  process.on(senal, () => {
    log("info", "Apagando", { senal });
    app.cerrar().finally(() => process.exit(0));
  });
}
