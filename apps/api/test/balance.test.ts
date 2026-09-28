/** Tanda 6 por HTTP: gastos, venta libre, recibo, balance, clientes, inventario, carga desde Excel y fotos. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
let cajero: Cliente;
const id: Record<string, string> = {};
const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
// JPEG mínimo válido (1×1)
const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991234901");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T061", nombre: "Bazar Treinta" })).datos.id;
  await dueña.post("/negocio/equipo", { celular: "0991234902", rol: "cajero" });
  cajero = new Cliente(env.url);
  await cajero.entrar(env, "0991234902");
  cajero.negocio = dueña.negocio;
  await dueña.post("/caja/abrir", { monto: 50 });
});
after(async () => { await env.app.cerrar(); });

test("gastos: con fecha, sin caja, listado y anulación", async () => {
  const g = await dueña.post("/gastos", { categoria: "Arriendo", monto: 250, metodo: "transferencia", descripcion: "Local septiembre" });
  assert.equal(g.status, 201, JSON.stringify(g.datos));
  const futuro = await dueña.post("/gastos", { categoria: "Arriendo", monto: 1, fecha: "2099-01-01" });
  assert.equal(futuro.status, 422);
  const efectivo = await cajero.post("/gastos", { categoria: "Transporte", monto: 3 });
  assert.equal(efectivo.status, 201);
  const lista = await dueña.get("/gastos");
  assert.equal(lista.datos.gastos.length, 2);
  assert.equal((await cajero.post(`/gastos/${efectivo.datos.id}/anular`, {})).status, 403);
  assert.equal((await dueña.post(`/gastos/${efectivo.datos.id}/anular`, {})).status, 200);
  assert.equal((await dueña.get("/gastos")).datos.gastos.find((x: { id: string }) => x.id === efectivo.datos.id).estado, "anulado");
});

test("venta libre y recibo público para WhatsApp o impresora", async () => {
  const v = await cajero.post("/ventas/libre", { monto: 7.25, concepto: "Recarga", pagos: [{ metodo: "efectivo", monto: 7.25, recibido: 10 }] });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.equal(Number(v.datos.venta.vuelto), 2.75);
  id.token = v.datos.venta.token;
  const r = await fetch(`${env.url}/api/r/${id.token}?ancho=58`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Bazar Treinta/);
  assert.match(html, /Recarga/);
  assert.match(html, /Vuelto/);
  assert.match(html, /size:58mm/);
  assert.equal((await fetch(`${env.url}/api/r/${"a".repeat(36)}`)).status, 404);

  // El recibo lleva la dirección y el mensaje del negocio
  assert.equal((await dueña.patch("/negocio/config", { direccion: "Av. 9 de Octubre 100", mensaje_recibo: "Vuelva pronto" })).status, 200);
  const html2 = await (await fetch(`${env.url}/api/r/${id.token}`)).text();
  assert.match(html2, /Av\. 9 de Octubre 100/);
  assert.match(html2, /Vuelva pronto/);

  const ventas = await dueña.get("/ventas");
  assert.equal(ventas.datos.ventas[0].token, id.token);
});

test("balance: ingresos, egresos y el cajero solo ve hoy", async () => {
  const b = await dueña.get("/balance");
  assert.equal(b.status, 200, JSON.stringify(b.datos));
  assert.equal(Number(b.datos.balance.ingresos), 7.25);
  assert.equal(Number(b.datos.balance.egresos), 250);
  assert.ok(b.datos.balance.movimientos.some((m: { tipo: string }) => m.tipo === "gasto"));
  assert.equal((await cajero.get("/balance")).status, 200);
  assert.equal((await cajero.get("/balance?desde=2026-01-01")).status, 403);
});

test("clientes: notas, fecha de pago e historial de compras", async () => {
  const c = await dueña.post("/clientes", { nombre: "Doña Carmen", celular: "0987654321" });
  const cid = c.datos.cliente.id;
  const pat = await dueña.patch(`/clientes/${cid}`, { notas: "Prefiere transferencia", fecha_pago: "2030-01-15", limite_credito: 50 });
  assert.equal(pat.status, 200, JSON.stringify(pat.datos));
  assert.equal(pat.datos.cliente.notas, "Prefiere transferencia");
  await dueña.post("/ventas/libre", { monto: 4, concepto: "Pan", pagos: [{ metodo: "efectivo", monto: 4 }], cliente_id: cid });
  const h = await dueña.get(`/clientes/${cid}/compras`);
  assert.equal(h.datos.compras.length, 1);
  assert.equal(h.datos.favoritos[0].nombre, "Pan");
  const lista = await dueña.get("/clientes?q=Carmen");
  assert.equal(Number(lista.datos.clientes[0].comprado), 4);
});

test("inventario: carga desde Excel, alertas, movimientos, fotos y descargas", async () => {
  const imp = await dueña.post("/productos/importar", { filas: [
    { nombre: "Cuaderno Excel", categoria: "Útiles", precio: "1,50", costo: "0,80", stock: "3", stock_minimo: "5" },
    { nombre: "Lápiz Excel", precio: 0.35, costo: 0.1, stock: 100 },
    { nombre: "", precio: 1 },
  ] });
  assert.equal(imp.status, 200, JSON.stringify(imp.datos));
  assert.equal(imp.datos.resultado.nuevos, 2);
  assert.equal(imp.datos.resultado.errores.length, 1);
  assert.equal((await cajero.post("/productos/importar", { filas: [{ nombre: "X" }] })).status, 403);

  const inv = await dueña.get("/inventario");
  assert.ok(inv.datos.alertas.some((a: { nombre: string }) => a.nombre === "Cuaderno Excel"), "stock bajo");
  assert.ok(Number(inv.datos.resumen.valor_costo) >= 12.4);
  assert.equal((await cajero.get("/inventario")).datos.resumen.valor_costo, undefined, "el cajero no ve costos");

  const prods = await dueña.get("/productos?q=Cuaderno Excel");
  const pid = prods.datos.productos[0].id;
  const mov = await dueña.get(`/productos/${pid}/movimientos`);
  assert.equal(mov.datos.movimientos[0].tipo, "inicial");

  assert.equal((await dueña.post(`/productos/${pid}/foto`, { tipo: "image/png", datos: JPEG })).status, 422, "la firma no coincide");
  const foto = await dueña.post(`/productos/${pid}/foto`, { tipo: "image/jpeg", datos: JPEG });
  assert.equal(foto.status, 201, JSON.stringify(foto.datos));
  const img = await fetch(`${env.url}/api/f/${pid}?v=${foto.datos.foto_version}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.match(img.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(Buffer.from(await img.arrayBuffer()).toString("base64"), JPEG);
  assert.equal((await dueña.pedir("DELETE", `/productos/${pid}/foto`)).status, 200);
  assert.equal((await fetch(`${env.url}/api/f/${pid}`)).status, 404);

  const h = { cookie: dueña.cookie, "x-negocio": dueña.negocio };
  const invCsv = await (await fetch(`${env.url}/api/reportes/inventario.csv`, { headers: h })).text();
  assert.match(invCsv, /Cuaderno Excel;Útiles;Unidad;;1,5;0,8;3;5;2,4/);
  const gasCsv = await (await fetch(`${env.url}/api/reportes/gastos.csv?desde=${hoy()}&hasta=${hoy()}`, { headers: h })).text();
  assert.match(gasCsv, /Arriendo;Local septiembre;250/);
});
