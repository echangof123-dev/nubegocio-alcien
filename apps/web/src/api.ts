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
