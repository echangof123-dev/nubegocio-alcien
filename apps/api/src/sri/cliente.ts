/**
 * Servicios web del SRI (esquema offline): recepción y autorización de comprobantes.
 *   Pruebas:    https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...
 *   Producción: https://cel.sri.gob.ec/comprobantes-electronicos-ws/...
 */
import { leerXml, buscar, buscarTodos, textoDe, type NodoXml } from "./xml.js";

export interface MensajeSri {
  identificador?: string;
  mensaje: string;
  informacionAdicional?: string;
  tipo?: string;
}

export interface RespuestaRecepcion {
  estado: "RECIBIDA" | "DEVUELTA";
  mensajes: MensajeSri[];
}

export interface RespuestaAutorizacion {
  estado: "AUTORIZADO" | "NO AUTORIZADO" | "EN PROCESO" | "SIN RESPUESTA";
  numero?: string;
  fecha?: string;
  mensajes: MensajeSri[];
}

export interface ClienteSri {
  recibir(ambiente: number, xmlFirmado: string): Promise<RespuestaRecepcion>;
  autorizar(ambiente: number, claveAcceso: string): Promise<RespuestaAutorizacion>;
}

/** Falla de red o del servicio del SRI: el comprobante se reintenta más tarde. */
export class ErrorConexionSri extends Error {}

export const URL_SRI = {
  1: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws",
  2: "https://cel.sri.gob.ec/comprobantes-electronicos-ws",
} as const;

function mensajes(n: NodoXml | undefined): MensajeSri[] {
  return buscarTodos(buscar(n, "mensajes"), "mensaje")
    .filter((m) => m.hijos.length > 0)            // <mensaje> contiene otro <mensaje> con el texto
    .map((m) => {
      const r: MensajeSri = { mensaje: m.hijos.find((h) => h.nombre === "mensaje")?.texto.trim() ?? "" };
      const id = m.hijos.find((h) => h.nombre === "identificador")?.texto.trim();
      const info = m.hijos.find((h) => h.nombre === "informacionAdicional")?.texto.trim();
      const tipo = m.hijos.find((h) => h.nombre === "tipo")?.texto.trim();
      if (id) r.identificador = id;
      if (info) r.informacionAdicional = info;
      if (tipo) r.tipo = tipo;
      return r;
    });
}

export function leerRecepcion(xml: string): RespuestaRecepcion {
  const doc = leerXml(xml);
  const r = doc.nombre === "RespuestaRecepcionComprobante" ? doc : buscar(doc, "RespuestaRecepcionComprobante");
  const estado = textoDe(r, "estado");
  if (estado !== "RECIBIDA" && estado !== "DEVUELTA") throw new ErrorConexionSri(`Respuesta de recepción inesperada: ${estado || "vacía"}`);
  return { estado, mensajes: mensajes(buscar(r, "comprobantes")) };
}

export function leerAutorizacion(xml: string): RespuestaAutorizacion {
  // El comprobante autorizado viene dentro (CDATA o escapado); no interesa aquí
  const doc = leerXml(xml);
  const r = doc.nombre === "RespuestaAutorizacionComprobante" ? doc : buscar(doc, "RespuestaAutorizacionComprobante");
  if (!r) throw new ErrorConexionSri("Respuesta de autorización inesperada");
  const autorizaciones = buscarTodos(buscar(r, "autorizaciones"), "autorizacion");
  if (!autorizaciones.length) return { estado: "SIN RESPUESTA", mensajes: [] };
  // Si hay varias (reintentos), manda la autorizada; si no, la más reciente
  const a = autorizaciones.find((x) => textoDe(x, "estado") === "AUTORIZADO") ?? autorizaciones[0]!;
  const estado = textoDe(a, "estado");
  const directos = (nombre: string) => a.hijos.find((h) => h.nombre === nombre)?.texto.trim() || undefined;
  return {
    estado: estado === "AUTORIZADO" || estado === "NO AUTORIZADO" || estado === "EN PROCESO" ? estado : "EN PROCESO",
    numero: directos("numeroAutorizacion"),
    fecha: directos("fechaAutorizacion"),
    mensajes: mensajes(a),
  };
}

function sobre(ns: string, cuerpo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="${ns}"><soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;
}

export class ClienteSriHttp implements ClienteSri {
  constructor(private readonly urls: Record<number, string> = URL_SRI, private readonly timeoutMs = 20_000) {}

  private async post(url: string, cuerpo: string): Promise<string> {
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: '""' },
        body: cuerpo,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ErrorConexionSri(`No se pudo conectar con el SRI (${(e as Error).name === "TimeoutError" ? "tiempo agotado" : (e as Error).message})`);
    }
    const texto = await r.text();
    if (!r.ok && !texto.includes("Respuesta")) throw new ErrorConexionSri(`El SRI respondió ${r.status}`);
    return texto;
  }

  private base(ambiente: number): string {
    const u = this.urls[ambiente];
    if (!u) throw new Error(`Ambiente inválido: ${ambiente}`);
    return u;
  }

  async recibir(ambiente: number, xmlFirmado: string): Promise<RespuestaRecepcion> {
    const b64 = Buffer.from(xmlFirmado, "utf8").toString("base64");
    const r = await this.post(`${this.base(ambiente)}/RecepcionComprobantesOffline`,
      sobre("http://ec.gob.sri.ws.recepcion", `<ec:validarComprobante><xml>${b64}</xml></ec:validarComprobante>`));
    return leerRecepcion(r);
  }

  async autorizar(ambiente: number, claveAcceso: string): Promise<RespuestaAutorizacion> {
    if (!/^[0-9]{49}$/.test(claveAcceso)) throw new Error("Clave de acceso inválida");
    const r = await this.post(`${this.base(ambiente)}/AutorizacionComprobantesOffline`,
      sobre("http://ec.gob.sri.ws.autorizacion",
        `<ec:autorizacionComprobante><claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante></ec:autorizacionComprobante>`));
    return leerAutorizacion(r);
  }
}
