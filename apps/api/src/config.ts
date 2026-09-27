/** Configuración desde variables de entorno. Falla al arrancar si falta algo obligatorio. */
import crypto from "node:crypto";
import { desdeUrl } from "./migrar.js";
import type { OpcionesConexion } from "./db/pgwire.js";

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
  whatsapp: { proveedor: "consola" | "meta" | "registro"; token?: string; phoneNumberId?: string; plantilla: string; version: string };
  ia: { proveedor: "ninguno" | "gemini"; apiKey?: string; modelo: string };
  /** Carpeta de la app web ya compilada, para servirla desde el mismo servicio. */
  webDir?: string;
  /** Migrar al arrancar (servicios sin terminal): conexión de administrador y carpeta db/. */
  migrar?: { admin: OpcionesConexion; dirDb: string; usuarioApi: string; claveApi: string };
  sri: {
    /** 32 bytes para cifrar las firmas electrónicas guardadas (ALCIEN_CLAVE_FIRMAS en base64). */
    claveFirmas: Buffer;
    /** Token de la tarea programada que reintenta envíos (Cloud Scheduler). */
    tokenTareas?: string;
    /** Cada cuántos segundos se reintentan los envíos pendientes dentro del servicio (0 = nunca). */
    intervaloSeg: number;
    urls: Record<number, string>;
  };
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
  if (!["consola", "meta", "registro"].includes(whatsappProveedor)) throw new Error("WHATSAPP_PROVEEDOR inválido");
  if (prod && whatsappProveedor === "consola") {
    throw new Error("En producción los códigos deben enviarse por WhatsApp (WHATSAPP_PROVEEDOR=meta)");
  }
  if (prod && whatsappProveedor === "registro" && env.ALCIEN_PERMITIR_CODIGOS_EN_REGISTRO !== "true") {
    throw new Error("WHATSAPP_PROVEEDOR=registro en producción exige ALCIEN_PERMITIR_CODIGOS_EN_REGISTRO=true (beta cerrada)");
  }

  const claveTexto = env.ALCIEN_CLAVE_FIRMAS ?? "";
  let claveFirmas: Buffer;
  if (claveTexto) {
    if (claveTexto.length < 32) throw new Error("ALCIEN_CLAVE_FIRMAS debe tener al menos 32 caracteres (openssl rand -base64 32)");
    claveFirmas = Buffer.from(claveTexto, "base64");
    // Si no son exactamente 32 bytes en base64, se deriva una clave de 32 bytes del texto
    if (claveFirmas.length !== 32) claveFirmas = crypto.createHash("sha256").update(claveTexto).digest();
  } else if (prod) {
    throw new Error("Falta ALCIEN_CLAVE_FIRMAS: sin ella no se pueden guardar firmas electrónicas");
  } else {
    claveFirmas = Buffer.alloc(32, 7);   // solo desarrollo y pruebas
  }
  const tokenTareas = env.ALCIEN_TOKEN_TAREAS || undefined;
  if (tokenTareas && tokenTareas.length < 32) throw new Error("ALCIEN_TOKEN_TAREAS debe tener al menos 32 caracteres");

  // Base por URL (Neon, Render…): ALCIEN_DB_ADMIN_URL es la dueña de las tablas y solo se usa
  // para migrar; la API se conecta como alcien_api con ALCIEN_DB_API_PASSWORD.
  const adminUrl = env.ALCIEN_DB_ADMIN_URL || undefined;
  const admin = adminUrl ? desdeUrl(adminUrl) : undefined;
  const claveApi = env.ALCIEN_DB_API_PASSWORD ?? env.PGPASSWORD ?? "";
  if (admin && claveApi.length < 16) throw new Error("ALCIEN_DB_API_PASSWORD debe tener al menos 16 caracteres");
  const usuarioApi = env.PGUSER ?? "alcien_api";

  return {
    entorno,
    puerto: Number(env.PORT ?? 8080),
    db: admin
      ? { host: admin.host, port: admin.port, user: usuarioApi, password: claveApi, database: admin.database,
          ssl: Boolean(admin.ssl), max: Number(env.PGPOOL_MAX ?? 5) }
      : {
          host: leer(env, "PGHOST", "localhost"),
          port: Number(env.PGPORT ?? 5432),
          user: leer(env, "PGUSER", "alcien_api"),
          password: env.PGPASSWORD ?? "",
          database: leer(env, "PGDATABASE", "alcien_dev"),
          ssl: env.PGSSL === "true",
          max: Number(env.PGPOOL_MAX ?? 10),
        },
    migrar: admin && env.ALCIEN_MIGRAR !== "false"
      ? { admin, dirDb: env.ALCIEN_DB_DIR ?? "db", usuarioApi, claveApi }
      : undefined,
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
    sri: {
      claveFirmas,
      tokenTareas,
      intervaloSeg: Number(env.SRI_INTERVALO_SEG ?? 60),
      urls: {
        1: env.SRI_URL_PRUEBAS ?? "https://celcer.sri.gob.ec/comprobantes-electronicos-ws",
        2: env.SRI_URL_PRODUCCION ?? "https://cel.sri.gob.ec/comprobantes-electronicos-ws",
      },
    },
  };
}
