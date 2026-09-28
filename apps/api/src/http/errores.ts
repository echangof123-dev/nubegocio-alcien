import { ErrorPostgres } from "../db/pgwire.js";

/** Error pensado para mostrarse al usuario tal cual. */
export class ErrorApp extends Error {
  constructor(readonly status: number, message: string, readonly codigo = "error") {
    super(message);
    this.name = "ErrorApp";
  }
}

export const noEncontrado = (m = "No encontrado") => new ErrorApp(404, m, "no_encontrado");
export const noAutorizado = (m = "Inicia sesión para continuar") => new ErrorApp(401, m, "sin_sesion");
export const prohibido = (m = "No tienes permiso para esto") => new ErrorApp(403, m, "sin_permiso");
export const invalido = (m: string) => new ErrorApp(422, m, "datos_invalidos");

/**
 * Traduce errores de PostgreSQL a respuestas HTTP.
 * Los mensajes de nuestras funciones (RAISE) están escritos para el usuario y se muestran;
 * las violaciones de restricciones son técnicas y se reemplazan por un mensaje genérico.
 */
export function traducirError(e: unknown): { status: number; cuerpo: { error: string; codigo: string } } {
  if (e instanceof ErrorApp) return { status: e.status, cuerpo: { error: e.message, codigo: e.codigo } };

  if (e instanceof ErrorPostgres) {
    if (e.constraint) {
      if (e.code === "23505") return { status: 409, cuerpo: { error: "Ya existe un registro con esos datos", codigo: "duplicado" } };
      if (e.code === "23503") return { status: 422, cuerpo: { error: "Hace referencia a algo que no existe", codigo: "referencia" } };
      return { status: 422, cuerpo: { error: "Revisa los datos ingresados", codigo: "datos_invalidos" } };
    }
    switch (e.code) {
      case "42501": return { status: 403, cuerpo: { error: e.message, codigo: "sin_permiso" } };
      case "P0002": return { status: 404, cuerpo: { error: e.message, codigo: "no_encontrado" } };
      case "22023": return { status: 422, cuerpo: { error: e.message, codigo: "datos_invalidos" } };
      case "55000": return { status: 409, cuerpo: { error: e.message, codigo: "estado" } };
      case "23505": return { status: 409, cuerpo: { error: e.message, codigo: "duplicado" } };
      case "23P01": return { status: 409, cuerpo: { error: e.message, codigo: "ocupado" } };
      case "22P02": case "22003": case "22007": case "22008":
        return { status: 422, cuerpo: { error: "Formato de dato inválido", codigo: "datos_invalidos" } };
    }
  }

  return { status: 500, cuerpo: { error: "Algo salió mal. Intenta de nuevo.", codigo: "interno" } };
}
