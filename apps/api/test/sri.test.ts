/**
 * Etapa 4 · Facturación electrónica.
 * El SRI se reemplaza por un doble (SriFalso) y un servidor SOAP local; la firma se verifica
 * con una implementación independiente (lxml + cryptography) y el XML contra los XSD del SRI.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { Cliente, levantar, type Entorno } from "./ayuda.js";
import { abrirP12, ErrorFirma } from "../src/sri/p12.js";
import { _pitable } from "../src/sri/rc2.js";
import { _patrones, valoresCode128 } from "../src/sri/code128.js";
import { cedulaValida, rucValido, clasificar } from "../src/sri/identificacion.js";
import { cifrar, descifrar } from "../src/sri/cifrado.js";
import {
  ClienteSriHttp, ErrorConexionSri, leerAutorizacion, leerRecepcion,
  type ClienteSri, type RespuestaAutorizacion, type RespuestaRecepcion,
} from "../src/sri/cliente.js";

const FIX = path.join(import.meta.dirname, "fixtures");
const firma = (n: string) => fs.readFileSync(path.join(FIX, `firma-${n}.p12.b64`), "utf8").trim();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "alcien-sri-"));

// ---------- Verificación independiente (si hay Python con lxml y cryptography) ----------

let python = false;
try {
  execFileSync("python3", ["-c", "import lxml, cryptography"], { stdio: "ignore" });
  python = true;
} catch { /* sin Python: esas comprobaciones se saltan */ }

function verificarXml(xml: string, xsd: string) {
  if (!python) return;
  const archivo = path.join(TMP, crypto.randomUUID() + ".xml");
  fs.writeFileSync(archivo, xml);
  const firmaOk = execFileSync("python3", [path.join(import.meta.dirname, "verificar_firma.py"), archivo]).toString().trim();
  assert.equal(firmaOk, "OK", "la firma verifica con lxml + cryptography");
  const script = "import sys\nfrom lxml import etree\ns=etree.XMLSchema(etree.parse(sys.argv[1]))\nd=etree.parse(sys.argv[2])\n" +
    "print('OK' if s.validate(d) else '\\n'.join(f'{e.line}: {e.message}' for e in s.error_log))";
  const r = execFileSync("python3", ["-c", script, path.join(FIX, "xsd", xsd), archivo]).toString().trim();
  assert.equal(r, "OK", `el XML cumple ${xsd}`);
}

// ---------- SRI de mentira ----------

class SriFalso implements ClienteSri {
  modo: "ok" | "caido" | "devuelta" | "no_autorizado" | "en_proceso" = "ok";
  recibidos = new Map<string, string>();
  async recibir(ambiente: number, xml: string): Promise<RespuestaRecepcion> {
    assert.equal(ambiente, 1, "pruebas");
    if (this.modo === "caido") throw new ErrorConexionSri("No se pudo conectar con el SRI (tiempo agotado)");
    if (this.modo === "devuelta") {
      return { estado: "DEVUELTA", mensajes: [{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", tipo: "ERROR" }] };
    }
    const clave = /<claveAcceso>([0-9]{49})<\/claveAcceso>/.exec(xml)![1]!;
    if (this.recibidos.has(clave)) {
      return { estado: "DEVUELTA", mensajes: [{ identificador: "43", mensaje: "CLAVE ACCESO REGISTRADA", tipo: "ERROR" }] };
    }
    this.recibidos.set(clave, xml);
    return { estado: "RECIBIDA", mensajes: [] };
  }
  async autorizar(_a: number, clave: string): Promise<RespuestaAutorizacion> {
    if (this.modo === "caido") throw new ErrorConexionSri("No se pudo conectar con el SRI");
    if (!this.recibidos.has(clave)) return { estado: "SIN RESPUESTA", mensajes: [] };
    if (this.modo === "en_proceso") return { estado: "EN PROCESO", mensajes: [] };
    if (this.modo === "no_autorizado") {
      return { estado: "NO AUTORIZADO", mensajes: [{ identificador: "56", mensaje: "ESTABLECIMIENTO CERRADO", tipo: "ERROR" }] };
    }
    return { estado: "AUTORIZADO", numero: clave, fecha: "2026-09-27T10:15:00-05:00", mensajes: [] };
  }
}

// ---------- Piezas sueltas ----------

test("firma .p12: abre los tres formatos y detecta la contraseña equivocada", () => {
  assert.equal(new Set(_pitable).size, 256, "la tabla de RC2 es una permutación");
  for (const [n, clave] of [["moderna", "Prueba.123"], ["legacy", "Prueba.123"], ["tresdes", "clave ñandú"]] as const) {
    const f = abrirP12(Buffer.from(firma(n), "base64"), clave);
    assert.equal(f.titular, "JUAN ANDRES PEREZ LOPEZ", n);
    assert.equal(f.emisor, "AC PRUEBA ALCIEN", `${n}: elige el certificado del titular, no el de la autoridad`);
    assert.equal(f.serie, String(0x5a3c91), n);
    assert.throws(() => abrirP12(Buffer.from(firma(n), "base64"), "otra"), (e) => e instanceof ErrorFirma && /contraseña/.test(e.message));
  }
  assert.throws(() => abrirP12(Buffer.from("no es una firma"), "x"), ErrorFirma);
});

test("cédula, RUC, Code 128 y cifrado de la firma", () => {
  assert.ok(cedulaValida("1710034065"));
  assert.ok(!cedulaValida("1710034066"), "dígito verificador");
  assert.ok(!cedulaValida("2510034065"), "provincia 25 no existe");
  assert.ok(rucValido("1710034065001"));
  assert.ok(rucValido("1790012345001"), "sociedad privada");
  assert.ok(!rucValido("1710034065000"));
  assert.equal(clasificar("1710034065"), "cedula");
  assert.equal(clasificar("A1234567"), "pasaporte");
  assert.equal(clasificar("1710034066"), null);

  assert.equal(_patrones.length, 107);
  for (const [i, p] of _patrones.entries()) {
    const suma = [...p].reduce((a, b) => a + Number(b), 0);
    assert.equal(suma, i === 106 ? 13 : 11, `símbolo ${i}`);
  }
  assert.equal(new Set(_patrones).size, 107);
  // 49 dígitos: 24 pares en juego C + cambio a B + último dígito
  const v = valoresCode128("1".repeat(49));
  assert.equal(v[0], 105);
  assert.equal(v.length, 1 + 24 + 2 + 2);
  assert.equal(v[25], 100);

  const clave = crypto.randomBytes(32);
  const sobre = cifrar(clave, "negocio-a", Buffer.from("secreto"));
  assert.equal(descifrar(clave, "negocio-a", sobre).toString(), "secreto");
  assert.throws(() => descifrar(clave, "negocio-b", sobre), "una firma copiada a otro negocio no se descifra");
});

test("respuestas del SRI y cliente SOAP", async () => {
  const devuelta = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>1</claveAcceso><mensajes><mensaje><identificador>35</identificador><mensaje>ARCHIVO NO CUMPLE ESTRUCTURA XML</mensaje><informacionAdicional>cvc-complex-type.2.4.a: &lt;x&gt;</informacionAdicional><tipo>ERROR</tipo></mensaje></mensajes></comprobante></comprobantes></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse></soap:Body></soap:Envelope>`;
  const r = leerRecepcion(devuelta);
  assert.equal(r.estado, "DEVUELTA");
  assert.deepEqual(r.mensajes, [{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "cvc-complex-type.2.4.a: <x>", tipo: "ERROR" }]);

  const autorizada = (comprobante: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>123</claveAccesoConsultada><numeroComprobantes>1</numeroComprobantes><autorizaciones><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>2709202601</numeroAutorizacion><fechaAutorizacion>2026-09-27T10:15:00-05:00</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante>${comprobante}</comprobante><mensajes/></autorizacion></autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;
  const interno = `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante"><estado>NO</estado><mensajes><mensaje><mensaje>x</mensaje></mensaje></mensajes></factura>`;
  for (const comp of [`<![CDATA[${interno}]]>`, interno.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")]) {
    const a = leerAutorizacion(autorizada(comp));
    assert.equal(a.estado, "AUTORIZADO", "no confunde el comprobante de adentro");
    assert.equal(a.numero, "2709202601");
    assert.deepEqual(a.mensajes, []);
  }
  assert.equal(leerAutorizacion(`<RespuestaAutorizacionComprobante><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante>`).estado, "SIN RESPUESTA");

  // Servidor SOAP local: la ruta, la cabecera y el XML en base64
  const pedidos: { url: string; cuerpo: string }[] = [];
  const srv = http.createServer(async (req, res) => {
    let cuerpo = "";
    for await (const t of req) cuerpo += t;
    pedidos.push({ url: req.url!, cuerpo });
    res.setHeader("content-type", "text/xml");
    res.end(req.url!.includes("Recepcion")
      ? devuelta.replace("DEVUELTA", "RECIBIDA").replace(/<comprobantes>.*<\/comprobantes>/, "<comprobantes/>")
      : autorizada("<![CDATA[x]]>"));
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/ws`;
  const cli = new ClienteSriHttp({ 1: base, 2: "http://127.0.0.1:1/nada" }, 2000);
  assert.equal((await cli.recibir(1, "<factura>ñ</factura>")).estado, "RECIBIDA");
  assert.equal(pedidos[0]!.url, "/ws/RecepcionComprobantesOffline");
  const b64 = /<xml>([^<]+)<\/xml>/.exec(pedidos[0]!.cuerpo)![1]!;
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), "<factura>ñ</factura>");
  const clave = "1".repeat(49);
  assert.equal((await cli.autorizar(1, clave)).estado, "AUTORIZADO");
  assert.match(pedidos[1]!.cuerpo, new RegExp(`<claveAccesoComprobante>${clave}</claveAccesoComprobante>`));
  await assert.rejects(cli.recibir(2, "<x/>"), ErrorConexionSri, "sin conexión = error de conexión (se reintenta)");
  srv.close();
});

// ---------- De punta a punta ----------

let env: Entorno;
const sri = new SriFalso();
let ana: Cliente;
const prod: Record<string, string> = {};
const TOKEN = "t".repeat(40);

before(async () => {
  env = await levantar({ clienteSri: sri, tokenTareas: TOKEN });
  ana = new Cliente(env.url);
  await ana.entrar(env, "0991234571");
  ana.negocio = (await ana.post("/negocios", { tipo: "T045", nombre: "Víveres Ana" })).datos.id;
  for (const p of (await ana.get("/productos")).datos.productos) prod[p.nombre] = p.id;
  await ana.patch(`/productos/${prod["Arroz 1 kg"]}`, { precio: 1.35 });
  await ana.patch(`/productos/${prod["Leche 1 L"]}`, { precio: 1 });
  await ana.patch(`/productos/${prod["Queso fresco"]}`, { precio: 3 });
  await ana.post("/caja/abrir", { monto: 20 });
});
after(async () => {
  await env?.app.cerrar();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function esperarEstado(id: string, distinto = "firmado") {
  for (let i = 0; i < 60; i++) {
    const r = await ana.get(`/comprobantes/${id}`);
    if (r.datos.comprobante.estado !== distinto) return r.datos.comprobante;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error("el comprobante no cambió de estado");
}

async function xmlDe(token: string) {
  const r = await fetch(`${env.url}/api/c/${token}/xml`);
  const t = await r.text();
  return /<!\[CDATA\[([\s\S]*)\]\]><\/comprobante>/.exec(t)![1]!;
}

const DATOS = {
  ruc: "1710034065001", razon_social: "Ana María Torres", nombre_comercial: "Víveres Ana",
  dir_matriz: "Av. 10 de Agosto N20-15, Quito", estab: "001", pto_emi: "001", regimen: "rimpe_emprendedor",
};

test("configurar la facturación: datos, firma y permisos", async () => {
  // Sin configurar, la venta con factura no se guarda
  const antes = await ana.post("/ventas", {
    items: [{ producto_id: prod["Arroz 1 kg"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1.35 }], comprobante: "factura",
  });
  assert.equal(antes.status, 409, JSON.stringify(antes.datos));
  assert.equal((await ana.get("/ventas")).datos.ventas.length, 0, "la venta se revirtió");

  assert.equal((await ana.post("/sri/config", { ...DATOS, ruc: "1710034065002" })).status, 422, "RUC inválido");
  const ok = await ana.post("/sri/config", DATOS);
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));

  const mala = await ana.post("/sri/firma", { archivo: firma("moderna"), clave: "equivocada" });
  assert.equal(mala.status, 422);
  assert.match(mala.datos.error, /contraseña/);

  const subida = await ana.post("/sri/firma", { archivo: firma("legacy"), clave: "Prueba.123" });
  assert.equal(subida.status, 200, JSON.stringify(subida.datos));
  assert.equal(subida.datos.firma.titular, "JUAN ANDRES PEREZ LOPEZ");

  const cfg = await ana.get("/sri/config");
  assert.equal(cfg.datos.listo, true);
  assert.equal(cfg.datos.config.tiene_firma, true);
  assert.equal(cfg.datos.config.firma_cifrada, undefined, "la firma nunca sale de la API");

  // Una cajera no configura
  await ana.post("/negocio/equipo", { celular: "0991234572", rol: "cajero" });
  const cajera = new Cliente(env.url);
  await cajera.entrar(env, "0991234572");
  cajera.negocio = ana.negocio;
  assert.equal((await cajera.post("/sri/config", DATOS)).status, 403);
  assert.equal((await cajera.post("/sri/firma", { archivo: firma("legacy"), clave: "Prueba.123" })).status, 403);
});

test("vender con factura: firma, autorización, RIDE y XML", async () => {
  const cliente = await ana.post("/clientes", {
    nombre: "Carlos Mena", identificacion: "1710034065", correo: "carlos@example.com", direccion: "Quito",
  });
  assert.equal(cliente.status, 201, JSON.stringify(cliente.datos));
  assert.equal((await ana.post("/clientes", { nombre: "X", identificacion: "1710034066" })).status, 422, "cédula inválida");

  const v = await ana.post("/ventas", {
    items: [{ producto_id: prod["Arroz 1 kg"], cantidad: 2 }, { producto_id: prod["Queso fresco"], cantidad: 0.5 }],
    pagos: [{ metodo: "efectivo", monto: 3, recibido: 5 }, { metodo: "transferencia", monto: 1.2 }],
    cliente_id: cliente.datos.cliente.id, comprobante: "factura",
  });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.equal(v.datos.factura.numero, "001-001-000000001");
  assert.equal(v.datos.factura.clave_acceso.length, 49);

  const c = await esperarEstado(v.datos.factura.id);
  assert.equal(c.estado, "autorizado", JSON.stringify(c.mensajes));
  assert.equal(c.numero_autorizacion, c.clave_acceso);

  const xml = await xmlDe(c.token_publico);
  assert.match(xml, /<importeTotal>4.20<\/importeTotal>/);
  assert.match(xml, /<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE<\/contribuyenteRimpe>/);
  assert.match(xml, /<identificacionComprador>1710034065<\/identificacionComprador>/);
  assert.match(xml, /<formaPago>20<\/formaPago><total>1.20<\/total>/);
  assert.equal(xml, sri.recibidos.get(c.clave_acceso), "el XML guardado es el que recibió el SRI");
  verificarXml(xml, "factura_V2.1.0.xsd");

  const ride = await fetch(`${env.url}/api/c/${c.token_publico}`);
  assert.equal(ride.status, 200);
  assert.match(ride.headers.get("content-type")!, /text\/html/);
  const html = await ride.text();
  for (const t of ["FACTURA", "001-001-000000001", "Carlos Mena", "Víveres Ana", "4.20", "PRUEBAS", c.clave_acceso]) {
    assert.ok(html.includes(t), `el RIDE muestra ${t}`);
  }
  assert.equal((await fetch(`${env.url}/api/c/${"0".repeat(36)}`)).status, 404);

  const detalle = await ana.get(`/ventas/${v.datos.venta.venta_id}`);
  assert.equal(detalle.datos.comprobantes[0].estado, "autorizado");
});

test("consumidor final: hasta $50 y no se anula", async () => {
  const chica = await ana.post("/ventas", {
    items: [{ producto_id: prod["Leche 1 L"], cantidad: 2 }], pagos: [{ metodo: "efectivo", monto: 2 }], comprobante: "factura",
  });
  assert.equal(chica.status, 201, JSON.stringify(chica.datos));
  const c = await esperarEstado(chica.datos.factura.id);
  assert.equal(c.comprador.identificacion, "9999999999999");
  verificarXml(await xmlDe(c.token_publico), "factura_V2.1.0.xsd");

  const anular = await ana.post(`/ventas/${chica.datos.venta.venta_id}/anular`, { motivo: "Se equivocó" });
  assert.equal(anular.status, 409);
  assert.match(anular.datos.error, /consumidor final/);

  const grande = await ana.post("/ventas", {
    items: [{ producto_id: prod["Queso fresco"], cantidad: 20 }], pagos: [{ metodo: "efectivo", monto: 60 }], comprobante: "factura",
  });
  assert.equal(grande.status, 422);
  assert.match(grande.datos.error, /\$50/);
});

test("anular una factura autorizada emite nota de crédito", async () => {
  const cliente = (await ana.get("/clientes?q=1710034065")).datos.clientes[0];
  const v = await ana.post("/ventas", {
    items: [{ producto_id: prod["Leche 1 L"], cantidad: 3 }], pagos: [{ metodo: "tarjeta", monto: 3 }],
    cliente_id: cliente.id, comprobante: "factura",
  });
  const fac = await esperarEstado(v.datos.factura.id);
  assert.equal(fac.estado, "autorizado");

  const r = await ana.post(`/ventas/${v.datos.venta.venta_id}/anular`, { motivo: "Leche en mal estado" });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.nota_credito.numero, "001-001-000000001");
  const nc = await esperarEstado(r.datos.nota_credito.id);
  assert.equal(nc.estado, "autorizado");
  assert.equal(nc.tipo, "nota_credito");

  const xml = await xmlDe(nc.token_publico);
  assert.match(xml, /<numDocModificado>001-001-000000003<\/numDocModificado>/);
  assert.match(xml, /<motivo>Leche en mal estado<\/motivo>/);
  assert.match(xml, /<valorModificacion>3.00<\/valorModificacion>/);
  verificarXml(xml, "notaCredito_V1.1.0.xsd");

  const ride = await (await fetch(`${env.url}/api/c/${fac.token_publico}`)).text();
  assert.match(ride, /anulada con una nota de crédito/);
});

test("SRI caído, devuelto y reintentos", async () => {
  const cliente = (await ana.get("/clientes?q=1710034065")).datos.clientes[0];
  const vender = () => ana.post("/ventas", {
    items: [{ producto_id: prod["Arroz 1 kg"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1.35 }],
    cliente_id: cliente.id, comprobante: "factura",
  });

  // Sin conexión: la venta se guarda igual y la factura queda firmada, con el aviso
  sri.modo = "caido";
  const v1 = await vender();
  assert.equal(v1.status, 201);
  await new Promise((ok) => setTimeout(ok, 200));
  let c = (await ana.get(`/comprobantes/${v1.datos.factura.id}`)).datos.comprobante;
  assert.equal(c.estado, "firmado");
  assert.match(c.mensajes[0].mensaje, /No se pudo conectar/);
  assert.equal((await ana.get("/comprobantes?pendientes=1")).datos.resumen.en_proceso, 1);

  // Vuelve el SRI y la dueña pulsa "Enviar ahora"
  sri.modo = "ok";
  const ahora = await ana.post(`/comprobantes/${v1.datos.factura.id}/enviar`);
  assert.equal(ahora.status, 200, JSON.stringify(ahora.datos));
  assert.equal(ahora.datos.comprobante.estado, "autorizado");
  assert.equal((await ana.post(`/comprobantes/${v1.datos.factura.id}/enviar`)).status, 409, "ya no está pendiente");

  // Devuelta → se corrige y se vuelve a emitir con otro número
  sri.modo = "devuelta";
  const v2 = await vender();
  c = await esperarEstado(v2.datos.factura.id);
  assert.equal(c.estado, "devuelto");
  assert.equal(c.mensajes[0].identificador, "35");
  sri.modo = "ok";
  const re = await ana.post(`/comprobantes/${c.id}/reemitir`);
  assert.equal(re.status, 201, JSON.stringify(re.datos));
  const nuevo = await esperarEstado(re.datos.comprobante_id);
  assert.equal(nuevo.estado, "autorizado");
  assert.notEqual(nuevo.numero, c.numero);
  assert.equal((await ana.get(`/comprobantes/${c.id}`)).datos.comprobante.estado, "anulado");

  // La tarea programada exige su token
  assert.equal((await ana.post("/tareas/sri")).status, 404);
  const tarea = await fetch(`${env.url}/api/tareas/sri`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(tarea.status, 200);

  // Facturar después una venta hecha con nota
  const nota = await ana.post("/ventas", {
    items: [{ producto_id: prod["Leche 1 L"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1 }],
  });
  const fact = await ana.post(`/ventas/${nota.datos.venta.venta_id}/facturar`, { cliente_id: cliente.id });
  assert.equal(fact.status, 201, JSON.stringify(fact.datos));
  assert.equal((await esperarEstado(fact.datos.comprobante_id)).estado, "autorizado");
  assert.equal((await ana.post(`/ventas/${nota.datos.venta.venta_id}/facturar`, {})).status, 422, "no dos veces");
});
