/** Tanda 2 por HTTP: recetas, mesas y comandas, cocina, pedidos y delivery. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueño: Cliente;
let mesero: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  dueño = new Cliente(env.url);
  await dueño.entrar(env, "0991234591");
  dueño.negocio = (await dueño.post("/negocios", { tipo: "T001", nombre: "Restaurante Sabor" })).datos.id;
  const crear = async (nombre: string, extra: Record<string, unknown>) => {
    const r = await dueño.post("/productos", { nombre, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.datos));
    id[nombre] = r.datos.producto.id;
  };
  await crear("Arroz", { unidad: "Kilo", costo: 1.2, tipo: "insumo", stock_inicial: 10 });
  await crear("Pollo", { unidad: "Kilo", costo: 4, tipo: "insumo", stock_inicial: 5 });
  await crear("Arroz con pollo", { unidad: "Plato", precio: 4.5 });
  await crear("Limonada", { unidad: "Vaso", precio: 1, maneja_stock: false });
  await dueño.post("/caja/abrir", { monto: 20 });
  await dueño.post("/negocio/equipo", { celular: "0991234592", rol: "cajero", nombre: "Mesero" });
  mesero = new Cliente(env.url);
  await mesero.entrar(env, "0991234592");
  mesero.negocio = dueño.negocio;
});
after(async () => { await env.app.cerrar(); });

test("recetas: los insumos no se venden y el plato calcula su costo", async () => {
  const venta = await dueño.get("/productos");
  assert.ok(!venta.datos.productos.some((p: { nombre: string }) => p.nombre === "Arroz"), "los insumos no salen en Vender");
  const todos = await dueño.get("/productos?todos=1");
  assert.ok(todos.datos.productos.some((p: { nombre: string }) => p.nombre === "Arroz"));

  const r = await dueño.post(`/recetas/${id["Arroz con pollo"]}`, {
    insumos: [{ insumo_id: id["Arroz"], cantidad: 0.15 }, { insumo_id: id["Pollo"], cantidad: 0.25 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.costo, 1.18);
  const receta = await dueño.get(`/recetas/${id["Arroz con pollo"]}`);
  assert.equal(receta.datos.insumos.length, 2);
  assert.equal((await mesero.post(`/recetas/${id["Arroz con pollo"]}`, { insumos: [] })).status, 403);
});

test("mesas: comanda, cocina, dividir la cuenta y cobrar", async () => {
  assert.equal((await mesero.post("/mesas", { cantidad: 5 })).status, 403, "el mesero no arma mesas");
  assert.equal((await dueño.post("/mesas", { cantidad: 5, zona: "Salón" })).status, 201);
  let mesas = (await mesero.get("/mesas")).datos.mesas;
  assert.equal(mesas.length, 5);

  const cuenta = await mesero.post("/cuentas", { mesa_id: mesas[0].id, personas: 2 });
  assert.equal(cuenta.status, 201);
  const cid = cuenta.datos.id;
  await mesero.post(`/cuentas/${cid}/items`, { items: [
    { producto_id: id["Arroz con pollo"], cantidad: 2, nota: "uno sin ensalada" },
    { producto_id: id["Limonada"], cantidad: 2 },
  ] });
  assert.equal((await mesero.post(`/cuentas/${cid}/cocina`)).datos.enviados, 2);

  const cocina = await dueño.get("/cocina");
  assert.equal(cocina.datos.comandas.length, 2);
  assert.equal(cocina.datos.comandas[0].destino, "Mesa 1");
  const plato = cocina.datos.comandas.find((c: { nombre: string }) => c.nombre === "Arroz con pollo");
  assert.equal(plato.nota, "uno sin ensalada");
  assert.equal((await dueño.post(`/cocina/${plato.id}`, { estado: "listo" })).status, 200);

  mesas = (await mesero.get("/mesas")).datos.mesas;
  assert.equal(mesas[0].por_cobrar, 11);
  assert.equal(mesas[0].listos, 1, "la mesa avisa que hay algo listo");

  // Dividir: una persona paga las limonadas
  const det = await mesero.get(`/cuentas/${cid}`);
  const limonada = det.datos.items.find((i: { nombre: string }) => i.nombre === "Limonada");
  const parte = await mesero.post(`/cuentas/${cid}/cobrar`, { items: [limonada.id], pagos: [{ metodo: "efectivo", monto: 2 }] });
  assert.equal(parte.status, 201, JSON.stringify(parte.datos));
  assert.equal(parte.datos.venta.cuenta_cerrada, false);
  const resto = await mesero.post(`/cuentas/${cid}/cobrar`, { pagos: [{ metodo: "tarjeta", monto: 9 }] });
  assert.equal(resto.datos.venta.cuenta_cerrada, true);

  mesas = (await mesero.get("/mesas")).datos.mesas;
  assert.equal(mesas[0].cuenta_id, null, "la mesa queda libre");
  const arroz = (await dueño.get("/productos?todos=1&q=arroz")).datos.productos.find((p: { nombre: string }) => p.nombre === "Arroz");
  assert.equal(arroz.stock, 9.7, "la receta descontó los insumos");
});

test("para llevar sin mesa y cuenta anulada", async () => {
  assert.equal((await mesero.post("/cuentas", {})).status, 422, "sin mesa necesita nombre");
  const c = await mesero.post("/cuentas", { nombre: "Barra - Juan" });
  await mesero.post(`/cuentas/${c.datos.id}/items`, { items: [{ producto_id: id["Limonada"], cantidad: 1 }] });
  const lista = await mesero.get("/mesas");
  assert.equal(lista.datos.cuentas.length, 1);
  assert.equal((await mesero.post(`/cuentas/${c.datos.id}/anular`)).status, 200);
});

test("pedidos a domicilio: estados, envío y cobro", async () => {
  const pedido = await mesero.post("/pedidos", {
    tipo: "domicilio", canal: "whatsapp", nombre: "Ana", celular: "0991112233", direccion: "Calle 1 y 2",
    costo_envio: 1.5, items: [{ producto_id: id["Arroz con pollo"], cantidad: 2 }],
  });
  assert.equal(pedido.status, 201, JSON.stringify(pedido.datos));
  const pid = pedido.datos.pedido.id;
  assert.equal((await dueño.get("/cocina")).datos.pedidos.length, 1, "el pedido aparece en cocina");

  await mesero.post(`/pedidos/${pid}/estado`, { estado: "preparando" });
  await mesero.post(`/pedidos/${pid}/estado`, { estado: "en_camino", repartidor: "Luis" });
  const cobro = await mesero.post(`/pedidos/${pid}/cobrar`, { pagos: [{ metodo: "efectivo", monto: 10.5 }] });
  assert.equal(cobro.status, 201, JSON.stringify(cobro.datos));
  assert.equal(cobro.datos.venta.total, 10.5, "2 × 4,50 + 1,50 de envío");
  await mesero.post(`/pedidos/${pid}/estado`, { estado: "entregado" });
  const lista = await mesero.get("/pedidos");
  assert.equal(lista.datos.pedidos[0].estado, "entregado");
  assert.equal(lista.datos.pedidos[0].cobrado, true);
  assert.equal((await mesero.post(`/pedidos/${pid}/estado`, { estado: "cancelado" })).status, 409);
});
