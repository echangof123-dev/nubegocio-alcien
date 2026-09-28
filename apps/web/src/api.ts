/** Cliente de la API de Al Cien. La sesión viaja en una cookie HttpOnly; el negocio, en X-Negocio. */

export class ErrorApi extends Error {
  constructor(readonly status: number, message: string, readonly codigo: string) {
    super(message);
  }
}

const CLAVE_NEGOCIO = "alcien.negocio";

function leerGuardado(): string | null {
  try { return localStorage.getItem(CLAVE_NEGOCIO); } catch { return null; }
}

let negocioActual: string | null = leerGuardado();

export function negocioGuardado(): string | null { return negocioActual; }

export function usarNegocio(id: string | null): void {
  negocioActual = id;
  try {
    if (id) localStorage.setItem(CLAVE_NEGOCIO, id);
    else localStorage.removeItem(CLAVE_NEGOCIO);
  } catch { /* modo privado: solo en memoria */ }
}

// ---------- Sin internet ----------

/** Lo que se guarda en el teléfono para poder abrir la app y vender sin señal. */
const GUARDABLES = [/^\/yo$/, /^\/negocio$/, /^\/productos$/, /^\/categorias$/, /^\/caja$/];
const claveCopia = (ruta: string) => `alcien.copia:${ruta === "/yo" ? "" : negocioActual ?? ""}:${ruta}`;
function guardarCopia(ruta: string, datos: unknown) {
  try { localStorage.setItem(claveCopia(ruta), JSON.stringify(datos)); } catch { /* sin espacio: no pasa nada */ }
}
function leerCopia(ruta: string): unknown {
  try { const t = localStorage.getItem(claveCopia(ruta)); return t ? JSON.parse(t) : null; } catch { return null; }
}

let enLinea = true;
function avisarRed(ok: boolean) {
  if (ok === enLinea) return;
  enLinea = ok;
  window.dispatchEvent(new CustomEvent("alcien:red", { detail: ok }));
  if (ok) void sincronizarVentas();
}
export const hayRed = () => enLinea;

export interface VentaPendiente { clave: string; negocio: string; cuerpo: Record<string, unknown>; total: number; creada: string; error?: string }
const CLAVE_PENDIENTES = "alcien.ventas-pendientes";
export function ventasPendientes(): VentaPendiente[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_PENDIENTES) ?? "[]") as VentaPendiente[]; } catch { return []; }
}
function guardarPendientes(v: VentaPendiente[]) {
  try { localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new CustomEvent("alcien:pendientes", { detail: v.length }));
}
export function guardarVentaPendiente(cuerpo: Record<string, unknown> & { clave: string }, total: number) {
  guardarPendientes([...ventasPendientes(), { clave: cuerpo.clave, negocio: negocioActual ?? "", cuerpo, total, creada: new Date().toISOString() }]);
}

let sincronizando = false;
/** Envía las ventas guardadas sin señal. La clave evita que una venta se registre dos veces. */
export async function sincronizarVentas(): Promise<number> {
  if (sincronizando) return 0;
  sincronizando = true;
  let enviadas = 0;
  try {
    for (const v of ventasPendientes()) {
      try {
        const hora = new Date(v.creada).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
        const r = await fetch("/api/ventas", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json", "x-negocio": v.negocio },
          body: JSON.stringify({ ...v.cuerpo, nota: `Hecha sin internet a las ${hora}` }),
        });
        if (r.ok) {
          guardarPendientes(ventasPendientes().filter((x) => x.clave !== v.clave));
          enviadas++;
        } else if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 408 && r.status !== 429) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          guardarPendientes(ventasPendientes().map((x) => (x.clave === v.clave ? { ...x, error: d.error ?? "No se pudo registrar" } : x)));
        }
      } catch { break; }   // sigue sin señal: se intenta después
    }
  } finally { sincronizando = false; }
  return enviadas;
}
export function descartarPendiente(clave: string) { guardarPendientes(ventasPendientes().filter((x) => x.clave !== clave)); }

export async function api<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (negocioActual) headers["x-negocio"] = negocioActual;

  const guardable = metodo === "GET" && GUARDABLES.some((re) => re.test(ruta));
  let r: Response;
  try {
    r = await fetch("/api" + ruta, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: "same-origin",
    });
  } catch {
    // Sin señal: lo último que se vio (productos, negocio, sesión) sirve para seguir vendiendo
    const copia = guardable ? leerCopia(ruta) : null;
    avisarRed(false);
    if (copia !== null) return copia as T;
    throw new ErrorApi(0, "Sin conexión. Revisa tu internet e intenta de nuevo.", "red");
  }
  avisarRed(true);

  const texto = await r.text();
  let datos: unknown = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  if (r.ok && guardable) guardarCopia(ruta, datos);
  if (!r.ok) {
    const d = (datos ?? {}) as { error?: string; codigo?: string };
    throw new ErrorApi(r.status, d.error ?? "Algo salió mal. Intenta de nuevo.", d.codigo ?? "error");
  }
  return datos as T;
}

export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : "Algo salió mal. Intenta de nuevo.");

/** Pide un archivo del negocio (CSV, HTML) con la sesión y el X-Negocio, y lo guarda o lo abre. */
export async function archivo(ruta: string, modo: { descargar: string } | "abrir"): Promise<void> {
  const ventana = modo === "abrir" ? window.open("", "_blank") : null;
  const r = await fetch("/api" + ruta, { credentials: "same-origin", headers: negocioActual ? { "x-negocio": negocioActual } : {} })
    .catch(() => { throw new ErrorApi(0, "Sin conexión. Revisa tu internet e intenta de nuevo.", "red"); });
  if (!r.ok) {
    ventana?.close();
    const d = (await r.json().catch(() => ({}))) as { error?: string; codigo?: string };
    throw new ErrorApi(r.status, d.error ?? "No se pudo abrir el archivo.", d.codigo ?? "error");
  }
  const url = URL.createObjectURL(await r.blob());
  if (modo === "abrir") {
    if (ventana) ventana.location.href = url; else window.location.href = url;
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = modo.descargar;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
