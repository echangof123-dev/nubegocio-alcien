/** Tanda 1 de módulos por HTTP: módulos, proveedores, compras, lotes y cotizaciones. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991234581");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T045", nombre: "Tienda Compras" })).datos.id;
  for (const p of (await dueña.get("/productos")).datos.productos) id[p.nombre] = p.id;
  await dueña.patch(`/productos/${id["Arroz 1 kg"]}`, { precio: 1.35 });
  await dueña.post("/caja/abrir", { monto: 50 });
});
after(async () => { await env.app.cerrar(); });

test("módulos: los 26 con su estado y se pueden activar", async () => {
  const r = await dueña.get("/modulos");
  assert.equal(r.datos.modulos.length, 26);
  const m24 = r.datos.modulos.find((m: { modulo: string }) => m.modulo === "M24");
  assert.equal(m24.estado, "disponible");
  const act = await dueña.post("/negocio/modulos/M24", { activo: true });
  assert.equal(act.status, 200, JSON.stringify(act.datos));
  const r2 = await dueña.get("/modulos");
  assert.equal(r2.datos.modulos.find((m: { modulo: string }) => m.modulo === "M24").estado, "activo", "en la prueba gratis se usa todo");
});

test("proveedores y compras: stock, costo, caja y cuentas por pagar", async () => {
  assert.equal((await dueña.post("/proveedores", { nombre: "X", ruc: "1790012345002" })).status, 422, "RUC inválido");
  const pr = await dueña.post("/proveedores", { nombre: "Distribuidora Andina", ruc: "1790012345001", celular: "0991112222" });
  assert.equal(pr.status, 201, JSON.stringify(pr.datos));

  const compra = await dueña.post("/compras", {
    proveedor_id: pr.datos.proveedor.id, metodo: "efectivo", documento: "001-001-000123",
    items: [{ producto_id: id["Arroz 1 kg"], cantidad: 20, costo: 1.05, lote: "A1", vence: "2027-01-31" }],
  });
  assert.equal(compra.status, 201, JSON.stringify(compra.datos));
  assert.equal(compra.datos.compra.total, 21);
  const prod = (await dueña.get("/productos?q=arroz")).datos.productos[0];
  assert.equal(prod.stock, 20);
  assert.equal(prod.costo, 1.05);
  assert.equal((await dueña.get("/caja")).datos.caja.efectivo_esperado, 29, "50 − 21 pagados de la caja");

  const credito = await dueña.post("/compras", {
    proveedor_id: pr.datos.proveedor.id, metodo: "credito",
    items: [{ producto_id: id["Leche 1 L"], cantidad: 12, costo: 0.75 }],
  });
  assert.equal(credito.status, 201);
  let lista = await dueña.get("/compras?por_pagar=1");
  assert.equal(lista.datos.resumen.por_pagar, 9);
  const pago = await dueña.post(`/compras/${credito.datos.compra.id}/pagos`, { monto: 9, metodo: "transferencia" });
  assert.equal(pago.datos.saldo, 0);
  lista = await dueña.get("/compras?por_pagar=1");
  assert.equal(lista.datos.compras.length, 0);

  const det = await dueña.get(`/compras/${compra.datos.compra.id}`);
  assert.equal(det.datos.detalle[0].lote, "A1");
  const lotes = await dueña.get("/lotes?dias=365");
  assert.equal(lotes.datos.lotes.length, 1);

  const anular = await dueña.post(`/compras/${compra.datos.compra.id}/anular`, { motivo: "Se devolvió todo" });
  assert.equal(anular.status, 200);
  assert.equal((await dueña.get("/caja")).datos.caja.efectivo_esperado, 50, "el efectivo vuelve a la caja");
});

test("cotizaciones: crear, enlace público y convertir en venta", async () => {
  const cli = await dueña.post("/clientes", { nombre: "Constructora Sol", celular: "0993334444" });
  const q = await dueña.post("/cotizaciones", {
    cliente_id: cli.datos.cliente.id, dias_validez: 7, nota: "Entrega en 2 días",
    items: [{ producto_id: id["Arroz 1 kg"], cantidad: 10, descuento: 1.5 }],
  });
  assert.equal(q.status, 201, JSON.stringify(q.datos));
  assert.equal(q.datos.cotizacion.total, 12);

  const pub = await fetch(`${env.url}/api/q/${q.datos.cotizacion.token_publico}`);
  assert.equal(pub.status, 200);
  const html = await pub.text();
  for (const t of ["COTIZACIÓN", "Constructora Sol", "Arroz 1 kg", "$ 12.00", "Entrega en 2 días"]) assert.ok(html.includes(t), t);

  const venta = await dueña.post(`/cotizaciones/${q.datos.cotizacion.id}/vender`, { pagos: [{ metodo: "transferencia", monto: 12 }] });
  assert.equal(venta.status, 201, JSON.stringify(venta.datos));
  assert.equal(venta.datos.venta.total, 12);
  const lista = await dueña.get("/cotizaciones");
  assert.equal(lista.datos.cotizaciones[0].estado, "aceptada");
  assert.equal((await dueña.post(`/cotizaciones/${q.datos.cotizacion.id}/vender`, { pagos: [{ metodo: "efectivo", monto: 12 }] })).status, 409);
});

test("el cajero no registra compras", async () => {
  await dueña.post("/negocio/equipo", { celular: "0991234582", rol: "cajero" });
  const cajero = new Cliente(env.url);
  await cajero.entrar(env, "0991234582");
  cajero.negocio = dueña.negocio;
  const r = await cajero.post("/compras", { metodo: "efectivo", items: [{ producto_id: id["Arroz 1 kg"], cantidad: 1, costo: 1 }] });
  assert.equal(r.status, 403);
  assert.equal((await cajero.post("/proveedores", { nombre: "Y" })).status, 403);
});
