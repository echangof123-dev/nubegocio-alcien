/**
 * Arranca la API en un puerto libre contra la base de pruebas y ofrece un cliente HTTP
 * que guarda la cookie de sesión, como lo haría el navegador.
 */
import type { AddressInfo } from "node:net";
import { cargarConfig } from "../src/config.js";
import { crearApp, type App } from "../src/app.js";
import type { EnviadorCodigos } from "../src/auth/whatsapp.js";
import type { GeneradorPlantillas, PropuestaTipo } from "../src/ia/plantillas.js";
import type { ClienteSri } from "../src/sri/cliente.js";

export class EnviadorPrueba implements EnviadorCodigos {
  codigos = new Map<string, string>();
  fallar = false;
  async enviar(celular: string, codigo: string) {
    if (this.fallar) throw new Error("WhatsApp caído");
    this.codigos.set(celular, codigo);
  }
}

export class IAPrueba implements GeneradorPlantillas {
  respuesta: PropuestaTipo | null = null;
  llamadas = 0;
  async proponer() { this.llamadas++; return this.respuesta; }
}

export interface Entorno {
  app: App;
  url: string;
  enviador: EnviadorPrueba;
  ia: IAPrueba;
}

export async function levantar(opc: { clienteSri?: ClienteSri; tokenTareas?: string } = {}): Promise<Entorno> {
  const cfg = cargarConfig({
    ...process.env,
    ALCIEN_ENTORNO: "pruebas",
    PGHOST: process.env.PGHOST_API ?? "127.0.0.1",
    PGUSER: process.env.PGUSER_API ?? "alcien_api",
    PGPASSWORD: process.env.PGPASSWORD_API ?? "alcien-dev",
    PGDATABASE: process.env.PGDATABASE_API ?? "alcien_api_test",
    PORT: "0",
    ...(opc.tokenTareas ? { ALCIEN_TOKEN_TAREAS: opc.tokenTareas } : {}),
  });
  const enviador = new EnviadorPrueba();
  const ia = new IAPrueba();
  const app = crearApp(cfg, { enviador, ia, silencioso: true, clienteSri: opc.clienteSri, esperaSriMs: 0 });
  await new Promise<void>((ok) => app.servidor.listen(0, "127.0.0.1", ok));
  const { port } = app.servidor.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}`, enviador, ia };
}

export class Cliente {
  cookie = "";
  negocio = "";
  constructor(private readonly base: string) {}

  async pedir(metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.negocio) headers["x-negocio"] = this.negocio;
    if (cuerpo !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(this.base + "/api" + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const texto = await r.text();
    const datos = texto && (r.headers.get("content-type") ?? "").includes("json") ? JSON.parse(texto) : texto || null;
    return { status: r.status, datos, headers: r.headers };
  }

  get(ruta: string) { return this.pedir("GET", ruta); }
  post(ruta: string, cuerpo: unknown = {}) { return this.pedir("POST", ruta, cuerpo); }
  patch(ruta: string, cuerpo: unknown) { return this.pedir("PATCH", ruta, cuerpo); }

  /** Pide código, lo lee del enviador de prueba y entra. */
  async entrar(env: Entorno, celular: string) {
    const r1 = await this.post("/auth/codigo", { celular });
    if (r1.status !== 200) throw new Error(`pedir código: ${r1.status} ${JSON.stringify(r1.datos)}`);
    const codigo = env.enviador.codigos.get(r1.datos.celular)!;
    const r2 = await this.post("/auth/verificar", { celular, codigo });
    if (r2.status !== 200) throw new Error(`verificar: ${r2.status} ${JSON.stringify(r2.datos)}`);
    return r2.datos;
  }
}
