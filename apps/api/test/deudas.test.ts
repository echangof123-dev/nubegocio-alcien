/** Tanda 7 por HTTP: deudas por cobrar y por pagar, logo, combos, propina, varios negocios, jornada y venta sin internet. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
const id: Record<string, string> = {};
const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991235201");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T061", nombre: "Tienda Deudas" })).datos.id;
  await dueña.post("/caja/abrir", { monto: 100 });
});
after(async () => { await env.app.cerrar(); });

test("deudas: a mano por cobrar y por pagar, con abonos", async () => {
  await dueña.post("/negocio/modulos/M14", { activo: true });
  await dueña.post("/negocio/modulos/M15", { activo: true });
  const c = await dueña.post("/clientes", { nombre: "Vecino Deuda" });
  const d = await dueña.post(`/clientes/${c.datos.cliente.id}/deudas`, { monto: 12, concepto: "Cuaderno de fiados viejo", fecha_pago: "2030-01-10" });
  assert.equal(d.status, 201, JSON.stringify(d.datos));
  const pr = await dueña.post("/proveedores", { nombre: "Proveedor Deuda" });
  const dp = await dueña.post("/deudas-proveedor", { proveedor_id: pr.datos.proveedor.id, monto: 80, concepto: "Mercadería", vence: "2030-01-05" });
  assert.equal(dp.status, 201, JSON.stringify(dp.datos));
  const lista = await dueña.get("/deudas");
  assert.equal(lista.datos.total_cobrar, 12);
  assert.equal(lista.datos.total_pagar, 80);
  const pago = await dueña.post(`/deudas-proveedor/${dp.datos.deuda.id}/pagar`, { monto: 30, metodo: "efectivo" });
  assert.equal(Number(pago.datos.saldo), 50);
  const mov = await dueña.get(`/clientes/${c.datos.cliente.id}`);
  assert.equal(mov.datos.movimientos[0].concepto, "Cuaderno de fiados viejo");
});

test("logo en el recibo y el catálogo; combos; propina", async () => {
  const logo = await dueña.post("/negocio/logo", { tipo: "image/jpeg", datos: JPEG });
  assert.equal(logo.status, 201, JSON.stringify(logo.datos));
  const img = await fetch(`${env.url}/api/logo/${dueña.negocio}?v=1`);
  assert.equal(img.status, 200);

  const cafe = await dueña.post("/productos", { nombre: "Café Combo", precio: 1, costo: 0.3, stock_inicial: 10 });
  const pan = await dueña.post("/productos", { nombre: "Pan Combo", precio: 0.3, costo: 0.1, stock_inicial: 10 });
  const combo = await dueña.post("/productos", { nombre: "Desayuno Combo", precio: 1.5, maneja_stock: false });
  const armar = await dueña.post(`/productos/${combo.datos.producto.id}/combo`, { componentes: [
    { producto_id: cafe.datos.producto.id, cantidad: 1 }, { producto_id: pan.datos.producto.id, cantidad: 2 }] });
  assert.equal(armar.status, 200, JSON.stringify(armar.datos));
  assert.equal(Number(armar.datos.costo), 0.5);
  assert.equal((await dueña.get(`/productos/${combo.datos.producto.id}/combo`)).datos.componentes.length, 2);

  const v = await dueña.post("/ventas", { items: [{ producto_id: combo.datos.producto.id, cantidad: 1 }], propina: 0.15,
    pagos: [{ metodo: "efectivo", monto: 1.65 }] });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.equal(Number(v.datos.venta.total), 1.65);
  const prods = await dueña.get("/productos?q=Pan Combo");
  assert.equal(Number(prods.datos.productos[0].stock), 8);
  const html = await (await fetch(`${env.url}/api/r/${v.datos.venta.token}`)).text();
  assert.match(html, /\/api\/logo\//);
  assert.match(html, /Propina/);
});

test("venta sin internet: la misma clave no se registra dos veces", async () => {
  const p = await dueña.post("/productos", { nombre: "Chicle Offline", precio: 0.1, stock_inicial: 100 });
  const cuerpo = { clave: "3f2a1b6c-0d4e-4f5a-9b8c-7d6e5f4a3b2c", items: [{ producto_id: p.datos.producto.id, cantidad: 3 }], pagos: [{ metodo: "efectivo", monto: 0.3 }] };
  const a = await dueña.post("/ventas", cuerpo);
  const b = await dueña.post("/ventas", cuerpo);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.datos.repetida, true);
  assert.equal(b.datos.venta.numero, a.datos.venta.numero);
  assert.equal(Number((await dueña.get("/productos?q=Chicle Offline")).datos.productos[0].stock), 97);
});

test("varios negocios y jornada", async () => {
  const otro = await dueña.post("/negocios", { tipo: "T001", nombre: "Sucursal Norte" });
  assert.equal(otro.status, 201);
  const r = await dueña.get("/mis-negocios/resumen");
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.negocios.length, 2);
  assert.ok(r.datos.negocios.find((n: { nombre: string }) => n.nombre === "Tienda Deudas").total > 0);

  assert.equal((await dueña.get("/jornada")).datos.abierta, null);
  assert.equal((await dueña.post("/jornada", {})).datos.jornada.estado, "entrada");
  assert.ok((await dueña.get("/jornada")).datos.abierta);
  const eq = await dueña.get("/jornadas");
  assert.equal(eq.datos.equipo[0].trabajando, true);
  assert.equal((await dueña.post("/jornada", {})).datos.jornada.estado, "salida");
});
