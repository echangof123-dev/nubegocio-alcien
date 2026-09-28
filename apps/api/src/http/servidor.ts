import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ErrorApp, noAutorizado, invalido, prohibido, traducirError } from "./errores.js";
import { uuid } from "./validar.js";
import type { ContextoNegocio, Pool } from "../db/pool.js";

export type Acceso = "publico" | "sesion" | "negocio";

export interface Peticion {
  metodo: string;
  ruta: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cuerpo: unknown;
  headers: http.IncomingHttpHeaders;
  ip: string;
  cookies: Record<string, string>;
  /** Presente en rutas con acceso "sesion" o "negocio". */
  usuarioId?: string;
  sesionId?: string;
}

export interface Respuesta {
  status?: number;
  cuerpo?: unknown;
  cookies?: string[];
  /** Respuesta que no es JSON (el RIDE en HTML, un XML para descargar). */
  crudo?: { tipo: string; cuerpo: string | Buffer; descarga?: string; cache?: string };
}

type Manejador = (p: Peticion) => Promise<Respuesta | unknown>;
type ManejadorNegocio = (p: Peticion, ctx: ContextoNegocio) => Promise<Respuesta | unknown>;

interface Ruta {
  metodo: string;
  patron: RegExp;
  nombres: string[];
  acceso: Acceso;
  manejador: Manejador | ManejadorNegocio;
}

export interface Dependencias {
  pool: Pool;
  /** Devuelve el usuario de una sesión válida, o null. */
  resolverSesion: (token: string) => Promise<{ usuarioId: string; sesionId: string } | null>;
  origenes: string[];
  webDir?: string;
  produccion: boolean;
  log?: (nivel: "info" | "error", msg: string, extra?: Record<string, unknown>) => void;
}

export const COOKIE_SESION = "alcien_sesion";
const LIMITE_CUERPO = 1536 * 1024;   // fotos de productos y cargas desde Excel

export class Router {
  private rutas: Ruta[] = [];

  private agregar(metodo: string, ruta: string, acceso: Acceso, manejador: Manejador | ManejadorNegocio) {
    const nombres: string[] = [];
    const patron = new RegExp("^" + ruta.replace(/:([a-z_]+)/g, (_, n: string) => { nombres.push(n); return "([^/]+)"; }) + "/?$");
    this.rutas.push({ metodo, patron, nombres, acceso, manejador });
  }

  publico(metodo: string, ruta: string, m: Manejador) { this.agregar(metodo, ruta, "publico", m); }
  sesion(metodo: string, ruta: string, m: Manejador) { this.agregar(metodo, ruta, "sesion", m); }
  negocio(metodo: string, ruta: string, m: ManejadorNegocio) { this.agregar(metodo, ruta, "negocio", m); }

  buscar(metodo: string, ruta: string): { r: Ruta; params: Record<string, string> } | "metodo" | null {
    let otroMetodo = false;
    for (const r of this.rutas) {
      const m = r.patron.exec(ruta);
      if (!m) continue;
      if (r.metodo !== metodo) { otroMetodo = true; continue; }
      const params: Record<string, string> = {};
      r.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]!); });
      return { r, params };
    }
    return otroMetodo ? "metodo" : null;
  }
}

function leerCookies(h?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const par of (h ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

async function leerCuerpo(req: http.IncomingMessage): Promise<unknown> {
  const tipo = req.headers["content-type"] ?? "";
  let total = 0;
  const partes: Buffer[] = [];
  for await (const trozo of req) {
    total += (trozo as Buffer).length;
    if (total > LIMITE_CUERPO) throw new ErrorApp(413, "La petición es demasiado grande", "muy_grande");
    partes.push(trozo as Buffer);
  }
  if (total === 0) return {};
  if (!tipo.startsWith("application/json")) throw new ErrorApp(415, "Se esperaba JSON", "tipo_contenido");
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw invalido("El JSON no es válido");
  }
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
};

function encabezadosSeguridad(res: http.ServerResponse, produccion: boolean) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (produccion) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function servirEstatico(webDir: string, ruta: string, res: http.ServerResponse): boolean {
  const base = path.resolve(webDir);
  let archivo = path.resolve(base, "." + decodeURIComponent(ruta));
  if (!archivo.startsWith(base)) return false;
  if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    if (path.extname(ruta)) return false;          // un recurso que no existe
    archivo = path.join(base, "index.html");       // la app decide la pantalla
    if (!fs.existsSync(archivo)) return false;
  }
  const ext = path.extname(archivo);
  res.statusCode = 200;
  res.setHeader("Content-Type", TIPOS[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", ext === ".html" || archivo.endsWith("sw.js") ? "no-cache" : "public, max-age=31536000, immutable");
  fs.createReadStream(archivo).pipe(res);
  return true;
}

export function crearServidor(router: Router, dep: Dependencias): http.Server {
  const log = dep.log ?? (() => {});

  return http.createServer(async (req, res) => {
    const inicio = Date.now();
    const id = crypto.randomUUID();
    encabezadosSeguridad(res, dep.produccion);
    const url = new URL(req.url ?? "/", "http://local");
    const metodo = req.method ?? "GET";

    const responder = (status: number, cuerpo?: unknown, cookies: string[] = []) => {
      res.statusCode = status;
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      if (cuerpo === undefined || status === 204) { res.end(); return; }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(cuerpo));
    };

    try {
      if (!url.pathname.startsWith("/api/")) {
        if ((metodo === "GET" || metodo === "HEAD") && dep.webDir && servirEstatico(dep.webDir, url.pathname, res)) return;
        responder(404, { error: "No encontrado", codigo: "no_encontrado" });
        return;
      }

      const hallado = router.buscar(metodo, url.pathname.slice(4));
      if (hallado === null) { responder(404, { error: "Ruta no encontrada", codigo: "no_encontrado" }); return; }
      if (hallado === "metodo") { responder(405, { error: "Método no permitido", codigo: "metodo" }); return; }

      // Peticiones que cambian datos: solo desde nuestro propio origen (protección CSRF junto a SameSite=Lax)
      if (metodo !== "GET" && metodo !== "HEAD") {
        const origen = req.headers.origin;
        if (origen) {
          const host = req.headers["x-forwarded-host"] ?? req.headers.host;
          const propio = [`https://${host}`, `http://${host}`];
          if (!propio.includes(origen) && !dep.origenes.includes(origen)) throw prohibido("Origen no permitido");
        }
      }

      const cookies = leerCookies(req.headers.cookie);
      const p: Peticion = {
        metodo,
        ruta: url.pathname,
        params: hallado.params,
        query: url.searchParams,
        cuerpo: metodo === "GET" || metodo === "HEAD" ? {} : await leerCuerpo(req),
        headers: req.headers,
        ip: String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim(),
        cookies,
      };

      const { r } = hallado;
      let resultado: Respuesta | unknown;
      if (r.acceso === "publico") {
        resultado = await (r.manejador as Manejador)(p);
      } else {
        const auth = req.headers.authorization;
        const token = auth?.startsWith("Bearer ") ? auth.slice(7) : cookies[COOKIE_SESION];
        const sesion = token ? await dep.resolverSesion(token) : null;
        if (!sesion) throw noAutorizado();
        p.usuarioId = sesion.usuarioId;
        p.sesionId = sesion.sesionId;
        if (r.acceso === "sesion") {
          resultado = await (r.manejador as Manejador)(p);
        } else {
          const negocioId = uuid(req.headers["x-negocio"], "El negocio (X-Negocio)");
          resultado = await dep.pool.enNegocio(sesion.usuarioId, negocioId, (ctx) => (r.manejador as ManejadorNegocio)(p, ctx));
        }
      }

      const esRespuesta = typeof resultado === "object" && resultado !== null &&
        ("status" in resultado || "cookies" in resultado || "crudo" in resultado);
      if (esRespuesta && (resultado as Respuesta).crudo) {
        const { crudo, status } = resultado as Respuesta;
        res.statusCode = status ?? 200;
        res.setHeader("Content-Type", crudo!.tipo);
        res.setHeader("Cache-Control", crudo!.cache ?? "private, no-store");
        res.setHeader("X-Robots-Tag", "noindex");
        if (crudo!.descarga) res.setHeader("Content-Disposition", `attachment; filename="${crudo!.descarga.replace(/[^\w.-]/g, "_")}"`);
        res.end(crudo!.cuerpo);
      } else if (esRespuesta) {
        const rr = resultado as Respuesta;
        responder(rr.status ?? 200, rr.cuerpo, rr.cookies);
      } else {
        responder(resultado === undefined ? 204 : 200, resultado);
      }
    } catch (e) {
      const { status, cuerpo } = traducirError(e);
      if (status >= 500) log("error", "error no controlado", { id, ruta: url.pathname, error: String((e as Error)?.stack ?? e) });
      responder(status, { ...cuerpo, id });
    } finally {
      if (url.pathname.startsWith("/api/")) {
        log("info", "petición", { id, metodo, ruta: url.pathname, status: res.statusCode, ms: Date.now() - inicio });
      }
    }
  });
}
