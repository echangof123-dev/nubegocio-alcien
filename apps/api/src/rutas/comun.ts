/** Piezas que comparten las rutas que terminan en una venta (cotizaciones, cuentas, pedidos, citas…). */
import type { ContextoNegocio } from "../db/pool.js";
import type { ServicioSri } from "../sri/servicio.js";
import { lista, numero, numeroOpcional, objeto, opcion, textoOpcional } from "../http/validar.js";

export const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta", "deuna", "fiado"] as const;

export function leerPagos(v: unknown) {
  return lista(v, "Los pagos", { min: 1, max: 5 }).map((x, i) => {
    const pg = objeto(x, `Pago ${i + 1}`);
    const pago: Record<string, unknown> = {
      metodo: opcion(pg.metodo, "El método de pago", METODOS_PAGO),
      monto: numero(pg.monto, "El monto", { min: 0.01, max: 1_000_000, decimales: 2 }),
    };
    const recibido = numeroOpcional(pg.recibido, "El efectivo recibido", { min: 0, max: 1_000_000, decimales: 2 });
    if (recibido !== null) pago.recibido = recibido;
    const referencia = textoOpcional(pg.referencia, "La referencia", { max: 80 });
    if (referencia) pago.referencia = referencia;
    return pago;
  });
}

export function leerComprobante(v: unknown): "nota" | "factura" {
  return v === undefined ? "nota" : opcion(v, "El comprobante", ["nota", "factura"] as const);
}

/** Si la venta lleva factura: se reserva, se firma en la transacción y se envía al SRI después del COMMIT. */
export async function facturarSiToca(ctx: ContextoNegocio, sri: ServicioSri, ventaId: string, comprobante: "nota" | "factura") {
  if (comprobante !== "factura") return null;
  const { rows } = await ctx.db.query("select id, numero, clave_acceso from app.sri_reservar($1, 'factura')", [ventaId]);
  const firmados = await sri.firmarPendientes(ctx.db);
  ctx.alConfirmar(() => sri.enviar(firmados));
  return rows[0] ?? null;
}

/** Como app.tiene_permiso: el dueño y el administrador pueden todo; los demás, lo que se les activó. */
export const puede = (ctx: { rol: string; permisos: string[] }, permiso: string) =>
  ctx.rol === "dueno" || ctx.rol === "administrador" || ctx.permisos.includes(permiso);
