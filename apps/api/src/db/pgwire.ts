/**
 * Cliente mínimo de PostgreSQL (protocolo v3) sin dependencias.
 *
 * Soporta lo que la API necesita y nada más:
 *   · conexión por TCP, TLS o socket Unix (Cloud SQL en Cloud Run usa /cloudsql/...),
 *   · autenticación SCRAM-SHA-256, MD5 y texto plano,
 *   · consultas con parámetros (protocolo extendido, formato texto),
 *   · consultas simples (BEGIN, COMMIT...),
 *   · conversión de tipos comunes (int, numeric, bool, json, arrays de texto).
 *
 * Si más adelante se prefiere el paquete `pg`, solo cambia este archivo: el resto
 * de la API usa la interfaz `Consultable` de pool.ts.
 */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export interface OpcionesConexion {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl?: boolean | tls.ConnectionOptions;
  applicationName?: string;
  connectTimeoutMs?: number;
}

export interface Resultado<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  command: string;
}

/** Error devuelto por PostgreSQL, con su código SQLSTATE. */
export class ErrorPostgres extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly constraint?: string;
  readonly severity?: string;
  constructor(campos: Map<string, string>) {
    super(campos.get("M") ?? "Error de PostgreSQL");
    this.name = "ErrorPostgres";
    this.code = campos.get("C") ?? "XX000";
    this.detail = campos.get("D");
    this.hint = campos.get("H");
    this.constraint = campos.get("n");
    this.severity = campos.get("V") ?? campos.get("S");
  }
}

/** Envuelve un arreglo JS para enviarlo como arreglo de PostgreSQL (text[], uuid[]...). */
export class ArregloPg {
  constructor(readonly valores: (string | number | null)[]) {}
}

// ---------- Conversión de valores ----------

const OID = {
  bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701,
  numeric: 1700, jsonb: 3802, textArray: 1009, varcharArray: 1015, uuidArray: 2951,
  timestamp: 1114, timestamptz: 1184,
} as const;

function citarElementoArreglo(v: string | number | null): string {
  if (v === null) return "NULL";
  const s = String(v);
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function aTextoPg(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof ArregloPg) return "{" + valor.valores.map(citarElementoArreglo).join(",") + "}";
  if (typeof valor === "boolean") return valor ? "t" : "f";
  if (valor instanceof Date) return valor.toISOString();
  if (Buffer.isBuffer(valor)) return "\\x" + valor.toString("hex");   // bytea
  if (typeof valor === "object") return JSON.stringify(valor);   // json / jsonb
  return String(valor);
}

function parsearArregloTexto(s: string): (string | null)[] {
  // Formato: {a,"b c",NULL,"d\"e"}  (arreglos de una dimensión)
  const out: (string | null)[] = [];
  if (s.length < 2 || s === "{}") return out;
  let i = 1;
  while (i < s.length - 1) {
    if (s[i] === '"') {
      let v = "";
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") i++;
        v += s[i];
        i++;
      }
      out.push(v);
      i++; // comilla de cierre
    } else {
      let fin = s.indexOf(",", i);
      if (fin === -1) fin = s.length - 1;
      const v = s.slice(i, fin);
      out.push(v === "NULL" ? null : v);
      i = fin;
    }
    if (s[i] === ",") i++;
  }
  return out;
}

function desdeTextoPg(texto: string, oid: number): unknown {
  switch (oid) {
    case OID.bool: return texto === "t";
    case OID.bytea: return Buffer.from(texto.slice(2), "hex");      // formato hex: \x0a1b...
    case OID.int2: case OID.int4: case OID.oid: return Number(texto);
    case OID.int8: {
      const n = Number(texto);
      return Number.isSafeInteger(n) ? n : texto;
    }
    case OID.float4: case OID.float8: case OID.numeric: return Number(texto);
    case OID.json: case OID.jsonb: return JSON.parse(texto);
    case OID.textArray: case OID.varcharArray: case OID.uuidArray: return parsearArregloTexto(texto);
    // La sesión usa TimeZone=UTC: "2026-09-27 16:28:01.79+00" → "2026-09-27T16:28:01.79+00:00"
    case OID.timestamptz: return texto.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
    case OID.timestamp: return texto.replace(" ", "T");
    default: return texto; // text, uuid, fechas (ISO), citext...
  }
}

// ---------- Lectura de mensajes ----------

class Lector {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}
  int32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  int16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  byte() { return this.buf[this.pos++]!; }
  cstring() {
    const fin = this.buf.indexOf(0, this.pos);
    const s = this.buf.toString("utf8", this.pos, fin);
    this.pos = fin + 1;
    return s;
  }
  bytes(n: number) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  resto() { return this.buf.subarray(this.pos); }
}

function mensaje(tipo: string | null, ...partes: Buffer[]): Buffer {
  const cuerpo = Buffer.concat(partes);
  const largo = Buffer.alloc(4);
  largo.writeInt32BE(cuerpo.length + 4);
  return tipo === null ? Buffer.concat([largo, cuerpo]) : Buffer.concat([Buffer.from(tipo), largo, cuerpo]);
}
const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };

// ---------- SCRAM-SHA-256 ----------

const hmac = (clave: Buffer, datos: string | Buffer) => crypto.createHmac("sha256", clave).update(datos).digest();
const sha256 = (datos: Buffer) => crypto.createHash("sha256").update(datos).digest();

// ---------- Conexión ----------

type Pendiente = {
  resolver: (r: Resultado) => void;
  rechazar: (e: Error) => void;
  filas: Record<string, unknown>[];
  campos: { nombre: string; oid: number }[];
  comando: string;
  error: ErrorPostgres | null;
};

export class ConexionPg {
  private socket!: net.Socket | tls.TLSSocket;
  private buffer: Buffer = Buffer.alloc(0);
  private pendiente: Pendiente | null = null;
  private cola: Promise<unknown> = Promise.resolve();
  private listoInicial: { resolver: () => void; rechazar: (e: Error) => void } | null = null;
  private scram: { clienteBare: string; nonce: string; password: string; firmaServidor?: Buffer } | null = null;
  private cerrada = false;
  /** Se llama si la conexión se cae fuera de una consulta. */
  onError: (e: Error) => void = () => {};

  constructor(private readonly opc: OpcionesConexion) {}

  get estaCerrada() { return this.cerrada; }

  async conectar(): Promise<void> {
    const { host, port } = this.opc;
    const esUnix = host.startsWith("/");
    const plano = esUnix
      ? net.createConnection({ path: `${host}/.s.PGSQL.${port}` })
      : net.createConnection({ host, port });
    plano.setNoDelay(true);
    plano.setKeepAlive(true, 30_000);

    const timeout = this.opc.connectTimeoutMs ?? 10_000;
    await new Promise<void>((ok, mal) => {
      const t = setTimeout(() => { plano.destroy(); mal(new Error("Tiempo de conexión a PostgreSQL agotado")); }, timeout);
      plano.once("connect", () => { clearTimeout(t); ok(); });
      plano.once("error", (e) => { clearTimeout(t); mal(e); });
    });

    if (this.opc.ssl && !esUnix) {
      // SSLRequest
      plano.write(mensaje(null, i32(80877103)));
      const respuesta = await new Promise<string>((ok, mal) => {
        plano.once("data", (d) => ok(d.toString("utf8", 0, 1)));
        plano.once("error", mal);
      });
      if (respuesta !== "S") throw new Error("El servidor PostgreSQL no acepta TLS");
      const opcTls = typeof this.opc.ssl === "object" ? this.opc.ssl : {};
      this.socket = tls.connect({ socket: plano, servername: host, ...opcTls });
      await new Promise<void>((ok, mal) => {
        (this.socket as tls.TLSSocket).once("secureConnect", ok);
        this.socket.once("error", mal);
      });
    } else {
      this.socket = plano;
    }

    this.socket.on("data", (d) => this.alRecibir(d));
    this.socket.on("error", (e) => this.alFallar(e));
    this.socket.on("close", () => this.alFallar(new Error("Conexión con PostgreSQL cerrada")));

    const listo = new Promise<void>((resolver, rechazar) => { this.listoInicial = { resolver, rechazar }; });
    this.socket.write(mensaje(null,
      i32(196608), // protocolo 3.0
      cstr("user"), cstr(this.opc.user),
      cstr("database"), cstr(this.opc.database),
      cstr("application_name"), cstr(this.opc.applicationName ?? "alcien-api"),
      cstr("client_encoding"), cstr("UTF8"),
      cstr("TimeZone"), cstr("UTC"),
      cstr("DateStyle"), cstr("ISO, YMD"),
      Buffer.from([0]),
    ));
    await listo;
  }

  /** Consulta con parámetros ($1, $2...). Una a la vez por conexión. */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<Resultado<T>> {
    const tarea = () => this.ejecutar(() => {
      const valores = params.map(aTextoPg);
      const partesBind: Buffer[] = [cstr(""), cstr(""), i16(0), i16(valores.length)];
      for (const v of valores) {
        if (v === null) partesBind.push(i32(-1));
        else { const b = Buffer.from(v, "utf8"); partesBind.push(i32(b.length), b); }
      }
      partesBind.push(i16(0)); // resultados en texto
      this.socket.write(Buffer.concat([
        mensaje("P", cstr(""), cstr(sql), i16(0)),
        mensaje("B", ...partesBind),
        mensaje("D", Buffer.from("P"), cstr("")),
        mensaje("E", cstr(""), i32(0)),
        mensaje("S"),
      ]));
    });
    const p = this.cola.then(tarea, tarea);
    this.cola = p.catch(() => undefined);
    return p as Promise<Resultado<T>>;
  }

  /** Consulta simple sin parámetros (BEGIN, COMMIT, ROLLBACK, SET...). */
  simple(sql: string): Promise<Resultado> {
    const tarea = () => this.ejecutar(() => { this.socket.write(mensaje("Q", cstr(sql))); });
    const p = this.cola.then(tarea, tarea);
    this.cola = p.catch(() => undefined);
    return p;
  }

  async cerrar(): Promise<void> {
    if (this.cerrada) return;
    this.cerrada = true;
    try { this.socket.write(mensaje("X")); } catch { /* ya cerrada */ }
    this.socket.end();
  }

  private ejecutar(enviar: () => void): Promise<Resultado> {
    if (this.cerrada) return Promise.reject(new Error("Conexión con PostgreSQL cerrada"));
    return new Promise<Resultado>((resolver, rechazar) => {
      this.pendiente = { resolver, rechazar, filas: [], campos: [], comando: "", error: null };
      try { enviar(); } catch (e) { this.pendiente = null; rechazar(e as Error); }
    });
  }

  private alFallar(e: Error) {
    const primeraVez = !this.cerrada;
    this.cerrada = true;
    if (this.listoInicial) { this.listoInicial.rechazar(e); this.listoInicial = null; }
    if (this.pendiente) { this.pendiente.rechazar(e); this.pendiente = null; }
    if (primeraVez) this.onError(e);
  }

  private alRecibir(datos: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, datos]) : datos;
    while (this.buffer.length >= 5) {
      const largo = this.buffer.readInt32BE(1);
      if (this.buffer.length < largo + 1) break;
      const tipo = String.fromCharCode(this.buffer[0]!);
      const cuerpo = this.buffer.subarray(5, largo + 1);
      this.buffer = this.buffer.subarray(largo + 1);
      try {
        this.procesar(tipo, cuerpo);
      } catch (e) {
        this.alFallar(e as Error);
        this.socket.destroy();
        return;
      }
    }
  }

  private procesar(tipo: string, cuerpo: Buffer) {
    const r = new Lector(cuerpo);
    switch (tipo) {
      case "R": return this.autenticar(r);
      case "S": case "K": case "N": case "1": case "2": case "n": case "A": return; // parámetros, clave, avisos...
      case "Z": { // ReadyForQuery
        if (this.listoInicial) { const l = this.listoInicial; this.listoInicial = null; l.resolver(); return; }
        const p = this.pendiente;
        this.pendiente = null;
        if (!p) return;
        if (p.error) p.rechazar(p.error);
        else p.resolver({ rows: p.filas, rowCount: p.filas.length || numeroDeFilas(p.comando), command: p.comando.split(" ")[0] ?? "" });
        return;
      }
      case "T": { // RowDescription
        if (!this.pendiente) return;
        const n = r.int16();
        const campos: { nombre: string; oid: number }[] = [];
        for (let i = 0; i < n; i++) {
          const nombre = r.cstring();
          r.int32(); r.int16();
          const oid = r.int32();
          r.int16(); r.int32(); r.int16();
          campos.push({ nombre, oid });
        }
        this.pendiente.campos = campos;
        return;
      }
      case "D": { // DataRow
        const p = this.pendiente;
        if (!p) return;
        const n = r.int16();
        const fila: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const largo = r.int32();
          const campo = p.campos[i]!;
          fila[campo.nombre] = largo === -1 ? null : desdeTextoPg(r.bytes(largo).toString("utf8"), campo.oid);
        }
        p.filas.push(fila);
        return;
      }
      case "C": // CommandComplete
        if (this.pendiente) this.pendiente.comando = r.cstring();
        return;
      case "E": { // ErrorResponse
        const campos = new Map<string, string>();
        for (;;) {
          const cod = r.byte();
          if (cod === 0) break;
          campos.set(String.fromCharCode(cod), r.cstring());
        }
        const err = new ErrorPostgres(campos);
        if (this.listoInicial) { const l = this.listoInicial; this.listoInicial = null; l.rechazar(err); return; }
        if (this.pendiente && !this.pendiente.error) this.pendiente.error = err;
        return;
      }
      default:
        return; // ParseComplete, BindComplete, NoData, EmptyQuery, PortalSuspended
    }
  }

  private autenticar(r: Lector) {
    const clase = r.int32();
    const password = this.opc.password ?? "";
    switch (clase) {
      case 0: return; // AuthenticationOk
      case 3: // texto plano
        this.socket.write(mensaje("p", cstr(password)));
        return;
      case 5: { // MD5
        const sal = r.bytes(4);
        const interno = crypto.createHash("md5").update(password + this.opc.user).digest("hex");
        const externo = crypto.createHash("md5").update(Buffer.concat([Buffer.from(interno), sal])).digest("hex");
        this.socket.write(mensaje("p", cstr("md5" + externo)));
        return;
      }
      case 10: { // SASL: el servidor lista mecanismos
        const mecanismos: string[] = [];
        for (let m = r.cstring(); m; m = r.cstring()) mecanismos.push(m);
        if (!mecanismos.includes("SCRAM-SHA-256")) throw new Error("PostgreSQL pide un mecanismo SASL no soportado");
        const nonce = crypto.randomBytes(18).toString("base64");
        const clienteBare = `n=,r=${nonce}`;
        this.scram = { clienteBare, nonce, password };
        const inicial = Buffer.from("n,," + clienteBare, "utf8");
        this.socket.write(mensaje("p", cstr("SCRAM-SHA-256"), i32(inicial.length), inicial));
        return;
      }
      case 11: { // SASLContinue
        const s = this.scram;
        if (!s) throw new Error("SCRAM fuera de orden");
        const primeroServidor = r.resto().toString("utf8");
        const attrs = new Map(primeroServidor.split(",").map((p) => [p[0]!, p.slice(2)] as [string, string]));
        const nonceServidor = attrs.get("r") ?? "";
        const sal = Buffer.from(attrs.get("s") ?? "", "base64");
        const iter = Number(attrs.get("i"));
        if (!nonceServidor.startsWith(s.nonce) || !iter) throw new Error("Respuesta SCRAM inválida");
        const salada = crypto.pbkdf2Sync(s.password.normalize("NFKC"), sal, iter, 32, "sha256");
        const claveCliente = hmac(salada, "Client Key");
        const sinPrueba = `c=biws,r=${nonceServidor}`;
        const authMsg = `${s.clienteBare},${primeroServidor},${sinPrueba}`;
        const firma = hmac(sha256(claveCliente), authMsg);
        const prueba = Buffer.from(claveCliente.map((b, i) => b ^ firma[i]!));
        s.firmaServidor = hmac(hmac(salada, "Server Key"), authMsg);
        this.socket.write(mensaje("p", Buffer.from(`${sinPrueba},p=${prueba.toString("base64")}`, "utf8")));
        return;
      }
      case 12: { // SASLFinal: verificar que el servidor es quien dice ser
        const s = this.scram;
        const final = r.resto().toString("utf8");
        const v = final.startsWith("v=") ? Buffer.from(final.slice(2), "base64") : Buffer.alloc(0);
        if (!s?.firmaServidor || v.length !== s.firmaServidor.length || !crypto.timingSafeEqual(v, s.firmaServidor)) {
          throw new Error("La firma SCRAM del servidor no coincide");
        }
        this.scram = null;
        return;
      }
      default:
        throw new Error(`Método de autenticación de PostgreSQL no soportado (${clase})`);
    }
  }
}

function numeroDeFilas(comando: string): number {
  const partes = comando.split(" ");
  const n = Number(partes[partes.length - 1]);
  return Number.isFinite(n) ? n : 0;
}
