/** Tanda 5 por HTTP: acopio con anticipos, reportes por periodo, CSV y cambios en el equipo. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueño: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  dueño = new Cliente(env.url);
  await dueño.entrar(env, "0991234801");
  dueño.negocio = (await dueño.post("/negocios", { tipo: "T185", nombre: "Acopio Chila" })).datos.id;
  assert.equal((await dueño.post("/negocio/modulos/M25", { activo: true })).status, 200);
  id.cacao = (await dueño.post("/productos", { nombre: "Cacao seco Chila", unidad: "Quintal", precio: 150 })).datos.producto.id;
  await dueño.post("/caja/abrir", { monto: 2000 });
});
after(async () => { await env.app.cerrar(); });

test("acopio: productor, anticipo, liquidación con humedad y anulación", async () => {
  const cfg = await dueño.post("/acopio/productos", { producto_id: id.cacao, humedad_base: 7, precio_dia: 110 });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.datos));
  assert.equal(Number((await dueño.get("/acopio/productos")).datos.productos[0].precio_dia), 110);

  const mala = await dueño.post("/productores", { nombre: "X", cedula: "1234567890" });
  assert.equal(mala.status, 422);
  const pr = await dueño.post("/productores", { nombre: "María Quimís", cedula: "0926687856", celular: "0987777666" });
  assert.equal(pr.status, 201, JSON.stringify(pr.datos));
  id.maria = pr.datos.productor.id;

  assert.equal((await dueño.post("/anticipos", { productor_id: id.maria, monto: 100 })).status, 201);
  assert.equal(Number((await dueño.get("/productores")).datos.productores[0].anticipo), 100);

  const a = await dueño.post("/acopio", { productor_id: id.maria, producto_id: id.cacao, sacos: 4, peso_bruto: 4.2, tara: 0.2,
    humedad: 7, descontar_anticipo: 100 });
  assert.equal(a.status, 201, JSON.stringify(a.datos));
  assert.equal(Number(a.datos.acopio.peso_neto), 4);
  assert.equal(Number(a.datos.acopio.total), 440);
  assert.equal(Number(a.datos.acopio.a_pagar), 340);

  const lista = await dueño.get("/acopio");
  assert.equal(lista.datos.acopios.length, 1);
  assert.equal(lista.datos.resumen[0].neto, 4);

  const liq = await dueño.pedir("GET", `/acopio/${a.datos.acopio.acopio_id}/liquidacion`);
  assert.equal(liq.status, 200);
  const html = await fetch(`${env.url}/api/acopio/${a.datos.acopio.acopio_id}/liquidacion`, {
    headers: { cookie: dueño.cookie, "x-negocio": dueño.negocio! } }).then((r) => r.text());
  assert.match(html, /María Quimís/);
  assert.match(html, /Anticipo descontado/);

  assert.equal((await dueño.post(`/acopio/${a.datos.acopio.acopio_id}/anular`, { motivo: "Mal pesado" })).status, 200);
  assert.equal(Number((await dueño.get("/productores")).datos.productores[0].anticipo), 100, "el anticipo vuelve");
});

test("reportes por periodo y CSV de ventas", async () => {
  const p = await dueño.post("/productos", { nombre: "Saco Chila", precio: 1, costo: 0.4, stock_inicial: 50 });
  const v = await dueño.post("/ventas", { items: [{ producto_id: p.datos.producto.id, cantidad: 5 }], pagos: [{ metodo: "efectivo", monto: 5 }] });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const r = await dueño.get(`/reportes?desde=${hoy}&hasta=${hoy}`);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(Number(r.datos.reporte.total), 5);
  assert.equal(r.datos.reporte.productos[0].nombre, "Saco Chila");

  const csv = await fetch(`${env.url}/api/reportes/ventas.csv?desde=${hoy}&hasta=${hoy}`, {
    headers: { cookie: dueño.cookie, "x-negocio": dueño.negocio! } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition") ?? "", /ventas-/);
  const texto = await csv.text();
  assert.match(texto, /fecha;numero;estado/);
  assert.match(texto, /Saco Chila;5/);

  assert.equal((await dueño.get("/reportes?desde=2026-02-01&hasta=2026-01-01")).status, 422);
});

test("equipo: cambiar rol y el cajero no ve reportes por periodo", async () => {
  const inv = await dueño.post("/negocio/equipo", { celular: "0991234802", rol: "bodeguero" });
  assert.equal(inv.status, 201);
  const cambio = await dueño.patch(`/negocio/equipo/${inv.datos.usuario_id}`, { rol: "cajero", nombre: "Pepe" });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.datos));
  const eq = await dueño.get("/negocio/equipo");
  const pepe = eq.datos.equipo.find((m: { id: string }) => m.id === inv.datos.usuario_id);
  assert.equal(pepe.rol, "cajero");
  assert.equal(pepe.nombre, "Pepe");

  const cajero = new Cliente(env.url);
  await cajero.entrar(env, "0991234802");
  cajero.negocio = dueño.negocio;
  assert.equal((await cajero.get("/reportes")).status, 403);
  assert.equal((await cajero.post("/anticipos", { productor_id: id.maria, monto: 5 })).status, 403);
});
