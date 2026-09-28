import { ConexionPg, type OpcionesConexion, type Resultado } from "./pgwire.js";

/** Lo mínimo que el resto de la API necesita para consultar. */
export interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Resultado<T>>;
}

/** Contexto de una petición autenticada dentro de un negocio. */
export interface ContextoNegocio {
  db: Consultable;
  usuarioId: string;
  negocioId: string;
  rol: "dueno" | "administrador" | "cajero" | "bodeguero";
  /** Permisos extra del empleado (precios, anular, productos, compras, reportes, gastos). */
  permisos: string[];
  /** Tarea que corre después del COMMIT (por ejemplo, enviar al SRI lo recién firmado). */
  alConfirmar(tarea: () => Promise<unknown>): void;
}

export class Pool implements Consultable {
  private libres: ConexionPg[] = [];
  private total = 0;
  private esperando: ((c: ConexionPg) => void)[] = [];
  private cerrado = false;

  constructor(private readonly opc: OpcionesConexion, private readonly max = 10) {}

  private async nueva(): Promise<ConexionPg> {
    const c = new ConexionPg(this.opc);
    c.onError = () => { this.libres = this.libres.filter((x) => x !== c); };
    await c.conectar();
    return c;
  }

  async tomar(): Promise<ConexionPg> {
    if (this.cerrado) throw new Error("El pool está cerrado");
    while (this.libres.length) {
      const c = this.libres.pop()!;
      if (!c.estaCerrada) return c;
      this.total--;
    }
    if (this.total < this.max) {
      this.total++;
      try {
        return await this.nueva();
      } catch (e) {
        this.total--;
        throw e;
      }
    }
    return new Promise((resolver) => this.esperando.push(resolver));
  }

  devolver(c: ConexionPg) {
    if (c.estaCerrada) {
      this.total--;
      // Si alguien espera, abrirle una conexión nueva
      const siguiente = this.esperando.shift();
      if (siguiente) {
        this.total++;
        this.nueva().then(siguiente, () => { this.total--; });
      }
      return;
    }
    const siguiente = this.esperando.shift();
    if (siguiente) siguiente(c);
    else this.libres.push(c);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<Resultado<T>> {
    const c = await this.tomar();
    try {
      return await c.query<T>(sql, params);
    } finally {
      this.devolver(c);
    }
  }

  /** Ejecuta fn dentro de una transacción. Si fn falla, se revierte todo. */
  async transaccion<R>(fn: (db: Consultable) => Promise<R>): Promise<R> {
    const c = await this.tomar();
    try {
      await c.simple("BEGIN");
      const r = await fn(c);
      await c.simple("COMMIT");
      return r;
    } catch (e) {
      if (!c.estaCerrada) await c.simple("ROLLBACK").catch(() => c.cerrar());
      throw e;
    } finally {
      this.devolver(c);
    }
  }

  /**
   * Transacción dentro de un negocio: verifica la membresía del usuario y fija el
   * contexto para que la seguridad por fila de PostgreSQL filtre todo lo demás.
   */
  async enNegocio<R>(usuarioId: string, negocioId: string, fn: (ctx: ContextoNegocio) => Promise<R>): Promise<R> {
    const tareas: (() => Promise<unknown>)[] = [];
    const r = await this.transaccion(async (db) => {
      const { rows } = await db.query<{ rol: ContextoNegocio["rol"]; permisos: string | null }>(
        "select e.rol, current_setting('app.permisos', true) as permisos from app.entrar_negocio($1, $2) as e(rol)", [usuarioId, negocioId]);
      const rol = rows[0]!.rol;
      const permisos = (rows[0]!.permisos ?? "").split(",").filter(Boolean);
      return fn({ db, usuarioId, negocioId, rol, permisos, alConfirmar: (t) => { tareas.push(t); } });
    });
    for (const t of tareas) t().catch(() => {});   // cada tarea registra sus propios errores
    return r;
  }

  async cerrar() {
    this.cerrado = true;
    await Promise.all(this.libres.map((c) => c.cerrar()));
    this.libres = [];
  }
}
