/** Tanda 3 por HTTP: variantes, listas de precios, series y garantías, catálogo en línea. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991234601");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T061", nombre: "Moda Lucía" })).datos.id;
  for (const m of ["M17", "M23", "M18", "M10"]) assert.equal((await dueña.post(`/negocio/modulos/${m}`, { activo: true })).status, 200);
  const camiseta = await dueña.post("/productos", { nombre: "Camiseta Lucía", precio: 12, costo: 5 });
  id.camiseta = camiseta.datos.producto.id;
  const celular = await dueña.post("/productos", { nombre: "Audífonos BT Lucía", precio: 25, stock_inicial: 3 });
  id.audifonos = celular.datos.producto.id;
  await dueña.patch(`/productos/${id.audifonos}`, { garantia_meses: 6 });
  await dueña.post("/caja/abrir", { monto: 0 });
});
after(async () => { await env.app.cerrar(); });

test("variantes: tallas y colores con stock propio", async () => {
  const r = await dueña.post(`/productos/${id.camiseta}/variantes`, { opciones: [["S", "M"], ["Negro", "Blanco"]], stock: 4 });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.creadas, 4);
  const lista = await dueña.get("/productos");
  const modelo = lista.datos.productos.find((p: { id: string }) => p.id === id.camiseta);
  assert.equal(modelo.hijos, 4);
  assert.equal(modelo.stock_variantes, 16);
  assert.ok(!lista.datos.productos.some((p: { variante: string | null }) => p.variante), "las variantes no salen sueltas");
  const vs = await dueña.get(`/productos/${id.camiseta}/variantes`);
  assert.deepEqual(vs.datos.variantes.map((v: { variante: string }) => v.variante), ["M · Blanco", "M · Negro", "S · Blanco", "S · Negro"]);
  id.mNegro = vs.datos.variantes.find((v: { variante: string }) => v.variante === "M · Negro").id;
});

test("listas de precios: mayorista y por volumen, también para el cajero", async () => {
  const l = await dueña.post("/listas", { nombre: "Mayorista", descuento_pct: 10 });
  assert.equal(l.status, 201);
  const lid = l.datos.lista.id;
  await dueña.post(`/listas/${lid}/precios`, { producto_id: id.camiseta, precio: 10 });
  await dueña.post(`/listas/${lid}/precios`, { producto_id: id.camiseta, desde_cantidad: 6, precio: 9 });
  const cot = await dueña.post(`/listas/${lid}/cotizar`, { items: [{ producto_id: id.mNegro, cantidad: 2 }, { producto_id: id.audifonos, cantidad: 1 }] });
  assert.deepEqual(cot.datos.precios.map((x: { precio: number }) => x.precio), [10, 22.5]);

  const cli = await dueña.post("/clientes", { nombre: "Boutique Sol" });
  const pat = await dueña.patch(`/clientes/${cli.datos.cliente.id}`, { lista_precio_id: lid });
  assert.equal(pat.datos.cliente.lista_precio_id, lid);

  await dueña.post("/negocio/equipo", { celular: "0991234602", rol: "cajero" });
  const cajero = new Cliente(env.url);
  await cajero.entrar(env, "0991234602");
  cajero.negocio = dueña.negocio;
  const v = await cajero.post("/ventas", {
    items: [{ producto_id: id.mNegro, cantidad: 2 }], pagos: [{ metodo: "transferencia", monto: 20 }],
    cliente_id: cli.datos.cliente.id, lista_id: lid,
  });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.equal(v.datos.venta.total, 20);
});

test("series y garantías", async () => {
  const s = await dueña.post("/series", { producto_id: id.audifonos, series: ["SN-001", "SN-002", "SN-001"] });
  assert.equal(s.datos.agregadas, 2);
  const v = await dueña.post("/ventas", { items: [{ producto_id: id.audifonos, cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 25 }] });
  const vs = await dueña.post(`/ventas/${v.datos.venta.venta_id}/series`, { producto_id: id.audifonos, serie: "SN-002" });
  assert.equal(vs.status, 201, JSON.stringify(vs.datos));
  assert.ok(vs.datos.serie.garantia_hasta);
  const g = await dueña.get("/series?q=SN-002");
  assert.equal(g.datos.series[0].en_garantia, true);
  assert.equal(g.datos.series[0].venta_numero, v.datos.venta.numero);
  assert.equal((await dueña.post(`/ventas/${v.datos.venta.venta_id}/series`, { producto_id: id.audifonos, serie: "SN-002" })).status, 409);
});

test("catálogo en línea: configurar, ver sin sesión y recibir un pedido", async () => {
  const cfg = await dueña.get("/catalogo/config");
  assert.equal(cfg.datos.sugerido, "moda-lucia");
  const g = await dueña.post("/catalogo/config", { slug: "moda-lucia", whatsapp: "0991112233", costo_envio: 2, mensaje: "Envíos a todo Quito" });
  assert.equal(g.status, 200, JSON.stringify(g.datos));
  await dueña.post("/catalogo/ocultos", { producto_id: id.audifonos, oculto: true });

  const pub = await fetch(`${env.url}/api/tienda/moda-lucia`);
  assert.equal(pub.status, 200);
  const cat = (await pub.json()).catalogo;
  assert.equal(cat.whatsapp, "593991112233");
  assert.equal(cat.productos.length, 1, "los audífonos están ocultos");
  assert.equal(cat.productos[0].variantes.length, 4);

  const pedido = await fetch(`${env.url}/api/tienda/moda-lucia/pedido`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "Lucía", celular: "0998887766", tipo: "domicilio", direccion: "La Carolina",
      items: [{ producto_id: id.mNegro, cantidad: 1 }] }),
  });
  assert.equal(pedido.status, 201, await pedido.clone().text());
  assert.equal((await pedido.json()).pedido.total, 14);
  const pedidos = await dueña.get("/pedidos");
  assert.equal(pedidos.datos.pedidos[0].canal, "catalogo");
  assert.equal((await fetch(`${env.url}/api/tienda/no-existe`)).status, 404);
});
