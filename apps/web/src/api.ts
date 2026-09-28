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

export async function api<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (negocioActual) headers["x-negocio"] = negocioActual;

  let r: Response;
  try {
    r = await fetch("/api" + ruta, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: "same-origin",
    });
  } catch {
    throw new ErrorApi(0, "Sin conexión. Revisa tu internet e intenta de nuevo.", "red");
  }

  const texto = await r.text();
  let datos: unknown = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
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
