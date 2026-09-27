import { cargarConfig } from "./config.js";
import { crearApp, log } from "./app.js";

const cfg = cargarConfig();
const app = crearApp(cfg);

app.servidor.listen(cfg.puerto, () => {
  log("info", "Al Cien API escuchando", { puerto: cfg.puerto, entorno: cfg.entorno, whatsapp: cfg.whatsapp.proveedor, ia: cfg.ia.proveedor });
});

// Limpieza de códigos y sesiones vencidas cada hora
const limpieza = setInterval(() => {
  app.pool.query("select auth.limpiar()").catch((e) => log("error", "limpieza falló", { error: String(e) }));
}, 60 * 60_000);
limpieza.unref();

// Cloud Run envía SIGTERM antes de apagar la instancia
for (const senal of ["SIGTERM", "SIGINT"] as const) {
  process.on(senal, () => {
    log("info", "Apagando", { senal });
    app.cerrar().finally(() => process.exit(0));
  });
}
