/**
 * Acceso sin contraseña: código de 6 dígitos por WhatsApp y sesión de 30 días.
 * Solo se guardan hashes: ni el código ni el token de sesión quedan en la base.
 */
import crypto from "node:crypto";
import type { Consultable } from "../db/pool.js";
import { ErrorApp, invalido } from "../http/errores.js";
import type { EnviadorCodigos } from "./whatsapp.js";
import { Limitador } from "./limite.js";

const MINUTOS_CODIGO = 5;
const INTENTOS_MAXIMOS = 5;
const CODIGOS_POR_CELULAR = 3;          // cada 15 minutos
const DIAS_SESION = 30;

export class ServicioAcceso {
  private porIp: Limitador;
  private global: Limitador;

  constructor(
    private readonly db: Consultable,
    private readonly enviador: EnviadorCodigos,
    private readonly secreto: string,
    limites: { porIp: number; global: number } = { porIp: 10, global: 500 },
  ) {
    this.porIp = new Limitador(limites.porIp, 15 * 60_000);
    this.global = new Limitador(limites.global, 60 * 60_000);
  }

  private hashCodigo(celular: string, codigo: string) {
    return crypto.createHmac("sha256", this.secreto).update(`${celular}:${codigo}`).digest("hex");
  }

  static hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async pedirCodigo(celular: string, ip: string): Promise<{ expiraEn: string }> {
    if (!this.porIp.permitir(ip) || !this.global.permitir("todos")) {
      throw new ErrorApp(429, "Demasiados intentos. Espera unos minutos.", "limite");
    }
    const { rows } = await this.db.query<{ n: number }>(
      `select count(*)::int as n from auth.codigo_acceso
       where celular = $1 and creado_en > now() - interval '15 minutes'`, [celular]);
    if (rows[0]!.n >= CODIGOS_POR_CELULAR) {
      throw new ErrorApp(429, "Ya te enviamos varios códigos. Espera 15 minutos.", "limite");
    }

    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const { rows: ins } = await this.db.query<{ expira_en: string }>(
      `insert into auth.codigo_acceso (celular, codigo_hash, expira_en)
       values ($1, $2, now() + make_interval(mins => $3)) returning expira_en`,
      [celular, this.hashCodigo(celular, codigo), MINUTOS_CODIGO]);

    try {
      await this.enviador.enviar(celular, codigo);
    } catch (e) {
      // Si no se pudo enviar, el código no debe contar para el límite ni servir
      await this.db.query("delete from auth.codigo_acceso where celular = $1 and codigo_hash = $2",
        [celular, this.hashCodigo(celular, codigo)]);
      throw new ErrorApp(502, "No pudimos enviar el código por WhatsApp. Intenta de nuevo.", "envio");
    }
    return { expiraEn: ins[0]!.expira_en };
  }

  /** Verifica el código y crea la sesión. Devuelve el token (se entrega una sola vez). */
  async verificarCodigo(celular: string, codigo: string, dispositivo: string | null) {
    if (!/^\d{6}$/.test(codigo)) throw invalido("El código tiene 6 dígitos");

    const { rows } = await this.db.query<{ id: string; codigo_hash: string; intentos: number }>(
      `select id, codigo_hash, intentos from auth.codigo_acceso
       where celular = $1 and usado_en is null and expira_en > now()
       order by creado_en desc limit 1`, [celular]);
    const fila = rows[0];
    if (!fila) throw new ErrorApp(422, "El código venció o no existe. Pide uno nuevo.", "codigo_vencido");
    if (fila.intentos >= INTENTOS_MAXIMOS) {
      throw new ErrorApp(429, "Demasiados intentos con este código. Pide uno nuevo.", "limite");
    }

    const esperado = Buffer.from(fila.codigo_hash, "hex");
    const recibido = Buffer.from(this.hashCodigo(celular, codigo), "hex");
    if (!crypto.timingSafeEqual(esperado, recibido)) {
      await this.db.query("update auth.codigo_acceso set intentos = intentos + 1 where id = $1", [fila.id]);
      const quedan = INTENTOS_MAXIMOS - fila.intentos - 1;
      throw new ErrorApp(422, quedan > 0 ? `Código incorrecto. Te quedan ${quedan} intentos.` : "Código incorrecto. Pide uno nuevo.", "codigo_incorrecto");
    }

    // Marca el código como usado solo si nadie lo usó en paralelo
    const usado = await this.db.query(
      "update auth.codigo_acceso set usado_en = now() where id = $1 and usado_en is null", [fila.id]);
    if (usado.rowCount !== 1) throw new ErrorApp(422, "El código ya se usó. Pide uno nuevo.", "codigo_vencido");

    const { rows: u } = await this.db.query<{ id: string; nombre: string | null; nuevo: boolean }>(
      `insert into auth.usuario (celular) values ($1)
       on conflict (celular) do update set celular = excluded.celular
       returning id, nombre, (xmax = 0) as nuevo`, [celular]);
    const usuario = u[0]!;

    const token = crypto.randomBytes(32).toString("base64url");
    await this.db.query(
      `insert into auth.sesion (usuario_id, token_hash, dispositivo, expira_en)
       values ($1, $2, $3, now() + make_interval(days => $4))`,
      [usuario.id, ServicioAcceso.hashToken(token), dispositivo?.slice(0, 200) ?? null, DIAS_SESION]);

    return { token, usuario, diasSesion: DIAS_SESION };
  }

  async resolverSesion(token: string): Promise<{ usuarioId: string; sesionId: string } | null> {
    if (token.length < 20 || token.length > 100) return null;
    const { rows } = await this.db.query<{ id: string; usuario_id: string }>(
      `select id, usuario_id from auth.sesion
       where token_hash = $1 and revocada_en is null and expira_en > now()`,
      [ServicioAcceso.hashToken(token)]);
    const s = rows[0];
    return s ? { usuarioId: s.usuario_id, sesionId: s.id } : null;
  }

  async cerrarSesion(sesionId: string) {
    await this.db.query("update auth.sesion set revocada_en = now() where id = $1", [sesionId]);
  }
}
