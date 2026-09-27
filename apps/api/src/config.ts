/** Configuración desde variables de entorno. Falla al arrancar si falta algo obligatorio. */

function leer(env: NodeJS.ProcessEnv, nombre: string, porDefecto?: string): string {
  const v = env[nombre] ?? porDefecto;
  if (v === undefined || v === "") throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export type Entorno = "desarrollo" | "pruebas" | "produccion";

export interface Config {
  entorno: Entorno;
  puerto: number;
  db: { host: string; port: number; user: string; password: string; database: string; ssl: boolean; max: number };
  /** Secreto para firmar los códigos de acceso (HMAC). En producción viene de Secret Manager. */
  secretoCodigos: string;
  /** Orígenes permitidos para peticiones que cambian datos (además del propio). */
  origenes: string[];
  whatsapp: { proveedor: "consola" | "meta"; token?: string; phoneNumberId?: string; plantilla: string; version: string };
  ia: { proveedor: "ninguno" | "gemini"; apiKey?: string; modelo: string };
  /** Carpeta de la app web ya compilada, para servirla desde el mismo servicio. */
  webDir?: string;
}

export function cargarConfig(env = process.env): Config {
  const entorno = (env.ALCIEN_ENTORNO ?? "desarrollo") as Entorno;
  if (!["desarrollo", "pruebas", "produccion"].includes(entorno)) throw new Error("ALCIEN_ENTORNO inválido");
  const prod = entorno === "produccion";

  const secretoCodigos = env.ALCIEN_SECRETO_CODIGOS ?? (prod ? "" : "solo-para-desarrollo-no-usar-en-produccion");
  if (!secretoCodigos || (prod && secretoCodigos.length < 32)) {
    throw new Error("ALCIEN_SECRETO_CODIGOS debe tener al menos 32 caracteres en producción");
  }

  const whatsappProveedor = (env.WHATSAPP_PROVEEDOR ?? (prod ? "meta" : "consola")) as Config["whatsapp"]["proveedor"];
  if (prod && whatsappProveedor === "consola") {
    throw new Error("En producción los códigos deben enviarse por WhatsApp (WHATSAPP_PROVEEDOR=meta)");
  }

  return {
    entorno,
    puerto: Number(env.PORT ?? 8080),
    db: {
      host: leer(env, "PGHOST", "localhost"),
      port: Number(env.PGPORT ?? 5432),
      user: leer(env, "PGUSER", "alcien_api"),
      password: env.PGPASSWORD ?? "",
      database: leer(env, "PGDATABASE", "alcien_dev"),
      ssl: env.PGSSL === "true",
      max: Number(env.PGPOOL_MAX ?? 10),
    },
    secretoCodigos,
    origenes: (env.ALCIEN_ORIGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    whatsapp: {
      proveedor: whatsappProveedor,
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      plantilla: env.WHATSAPP_PLANTILLA_CODIGO ?? "codigo_acceso",
      version: env.WHATSAPP_API_VERSION ?? "v21.0",
    },
    ia: {
      proveedor: env.GEMINI_API_KEY ? "gemini" : "ninguno",
      apiKey: env.GEMINI_API_KEY,
      modelo: env.GEMINI_MODELO ?? "gemini-2.5-flash",
    },
    webDir: env.ALCIEN_WEB_DIR,
  };
}
