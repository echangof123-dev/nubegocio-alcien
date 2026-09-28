/** Tanda 4 por HTTP: citas, comisiones, órdenes de trabajo, reservas y membresías. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991234701");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T119", nombre: "Salón Vilma" })).datos.id;
  for (const m of ["M13", "M22", "M26"]) assert.equal((await dueña.post(`/negocio/modulos/${m}`, { activo: true })).status, 200);
  id.corte = (await dueña.post("/productos", { nombre: "Corte Vilma", precio: 12, maneja_stock: false })).datos.producto.id;
  await dueña.post("/caja/abrir", { monto: 0 });
});
after(async () => { await env.app.cerrar(); });

test("citas: agenda por profesional, choque de horario y cobro con comisión", async () => {
  const pr = await dueña.post("/profesionales", { nombre: "Vilma", comision_pct: 50 });
  assert.equal(pr.status, 201, JSON.stringify(pr.datos));
  id.vilma = pr.datos.profesional.id;
  const c = await dueña.post("/citas", { nombre: "Karla", celular: "0990001111", profesional_id: id.vilma, servicio_id: id.corte,
    inicio: "2030-03-01T15:00:00Z", duracion_min: 60 });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  const choque = await dueña.post("/citas", { nombre: "Otra", profesional_id: id.vilma, inicio: "2030-03-01T15:30:00Z" });
  assert.equal(choque.status, 409);
  assert.equal(choque.datos.codigo, "ocupado");

  const ag = await dueña.get("/citas?desde=2030-03-01");
  assert.equal(ag.datos.citas.length, 1);
  assert.equal(ag.datos.citas[0].profesional, "Vilma");

  const cobro = await dueña.post(`/citas/${c.datos.cita.id}/cobrar`, { pagos: [{ metodo: "efectivo", monto: 12 }] });
  assert.equal(cobro.status, 201, JSON.stringify(cobro.datos));
  assert.equal(Number(cobro.datos.venta.comision), 6);

  const com = await dueña.get("/comisiones");
  assert.equal(Number(com.datos.resumen.find((x: { id: string }) => x.id === id.vilma).pendiente), 6);
  const pago = await dueña.post(`/profesionales/${id.vilma}/pagar`, {});
  assert.equal(Number(pago.datos.pagado), 6);
});

test("órdenes de trabajo: repuestos, mano de obra, cobro y seguimiento público", async () => {
  const rep = await dueña.post("/productos", { nombre: "Batería Vilma", precio: 20, stock_inicial: 2 });
  const mo = await dueña.post("/productos", { nombre: "Mano de obra Vilma", maneja_stock: false });
  const o = await dueña.post("/ordenes", { nombre: "Luis", equipo: "Moto Honda", identificador: "ABC-123", problema: "No prende", tecnico_id: id.vilma });
  assert.equal(o.status, 201, JSON.stringify(o.datos));
  const oid = o.datos.orden.id;
  const it = await dueña.post(`/ordenes/${oid}/items`, { items: [
    { producto_id: rep.datos.producto.id, tipo: "repuesto" },
    { producto_id: mo.datos.producto.id, tipo: "mano_obra", precio: 10 }] });
  assert.equal(it.status, 201, JSON.stringify(it.datos));
  const extra = await dueña.post(`/ordenes/${oid}/items`, { items: [{ producto_id: mo.datos.producto.id, tipo: "mano_obra", precio: 99 }] });
  assert.equal(extra.status, 201);
  const conExtra = await dueña.get(`/ordenes/${oid}`);
  const quitar = conExtra.datos.items.find((i: { precio: number }) => Number(i.precio) === 99).id;
  assert.equal((await dueña.pedir("DELETE", `/ordenes/${oid}/items/${quitar}`)).status, 200);
  assert.equal((await dueña.post(`/ordenes/${oid}/estado`, { estado: "lista", diagnostico: "Batería muerta" })).status, 200);
  assert.equal((await dueña.post(`/ordenes/${oid}/estado`, { estado: "entregada" })).status, 409);

  const det = await dueña.get(`/ordenes/${oid}`);
  assert.equal(det.datos.items.length, 2);
  assert.equal(det.datos.historial.length, 2);

  const pub = await fetch(`${env.url}/api/o/${o.datos.orden.token_publico}`);
  assert.equal(pub.status, 200);
  const html = await pub.text();
  assert.match(html, /Lista para retirar/);
  assert.match(html, /\$ 30,00/);
  assert.equal((await fetch(`${env.url}/api/o/${"0".repeat(36)}`)).status, 404);

  const cobro = await dueña.post(`/ordenes/${oid}/cobrar`, { pagos: [{ metodo: "efectivo", monto: 30 }] });
  assert.equal(cobro.status, 201, JSON.stringify(cobro.datos));
  assert.equal((await dueña.post(`/ordenes/${oid}/estado`, { estado: "entregada" })).status, 200);
  const abiertas = await dueña.get("/ordenes?estado=abiertas");
  assert.equal(abiertas.datos.ordenes.length, 0);
});

test("reservas: noches, fechas cruzadas y cobro", async () => {
  const h = await dueña.post("/recursos", { nombre: "Suite", tipo: "Habitación", unidad: "noche", precio: 40 });
  assert.equal(h.status, 201, JSON.stringify(h.datos));
  const rv = await dueña.post("/reservas", { recurso_id: h.datos.recurso.id, nombre: "Pareja Mora",
    desde: "2030-07-10T19:00:00Z", hasta: "2030-07-12T17:00:00Z" });
  assert.equal(rv.status, 201, JSON.stringify(rv.datos));
  assert.equal(Number(rv.datos.reserva.total), 80);
  const cruce = await dueña.post("/reservas", { recurso_id: h.datos.recurso.id, nombre: "X", desde: "2030-07-11T19:00:00Z", hasta: "2030-07-13T17:00:00Z" });
  assert.equal(cruce.status, 409);
  const lista = await dueña.get("/reservas?desde=2030-07-09&dias=7");
  assert.equal(lista.datos.reservas.length, 1);
  const cobro = await dueña.post(`/reservas/${rv.datos.reserva.id}/cobrar`, { pagos: [{ metodo: "transferencia", monto: 80 }] });
  assert.equal(cobro.status, 201, JSON.stringify(cobro.datos));
});

test("membresías: vender, marcar asistencia y ver socios", async () => {
  const pl = await dueña.post("/planes-membresia", { nombre: "Mensual", precio: 30, duracion_dias: 30 });
  assert.equal(pl.status, 201, JSON.stringify(pl.datos));
  const cli = await dueña.post("/clientes", { nombre: "Sofía Gym" });
  const cid = cli.datos.cliente.id;
  assert.equal((await dueña.post("/asistencias", { cliente_id: cid })).status, 409);
  const v = await dueña.post("/membresias", { cliente_id: cid, plan_id: pl.datos.plan.id, pagos: [{ metodo: "efectivo", monto: 30 }] });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.equal((await dueña.post("/asistencias", { cliente_id: cid })).status, 201);
  const socios = await dueña.get("/socios");
  assert.equal(socios.datos.socios[0].situacion, "vigente");
  assert.equal((await dueña.get("/asistencias")).datos.asistencias.length, 1);
});
