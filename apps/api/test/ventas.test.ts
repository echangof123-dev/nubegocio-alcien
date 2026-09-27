import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let rosa: Cliente;
const id: Record<string, string> = {};

before(async () => {
  env = await levantar();
  rosa = new Cliente(env.url);
  await rosa.entrar(env, "0991234521");
  rosa.negocio = (await rosa.post("/negocios", { tipo: "T045", nombre: "Tienda Rosa" })).datos.id;
  const { datos } = await rosa.get("/productos");
  for (const p of datos.productos) id[p.nombre] = p.id;
});
after(async () => { await env.app.cerrar(); });

test("productos: precios, nuevo producto y stock", async () => {
  const r = await rosa.patch(`/productos/${id["Arroz 1 kg"]}`, { precio: 1.35, costo: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.producto.precio, 1.35);
  assert.equal(r.datos.producto.es_ejemplo, false, "al ponerle precio deja de ser ejemplo");
  await rosa.patch(`/productos/${id["Leche 1 L"]}`, { precio: "1,00" });
  await rosa.patch(`/productos/${id["Queso fresco"]}`, { precio: 3 });

  const malo = await rosa.patch(`/productos/${id["Pan"]}`, { precio: 0.155 });
  assert.equal(malo.status, 422, "precio con 3 decimales");

  const cats = await rosa.get("/categorias");
  const bebidas = cats.datos.categorias.find((c: { nombre: string }) => c.nombre === "Bebidas").id;
  const nuevo = await rosa.post("/productos", {
    nombre: "Agua 1 L", categoria_id: bebidas, precio: 0.60, codigo_barras: "7861234567890", stock_inicial: 24,
  });
  assert.equal(nuevo.status, 201, JSON.stringify(nuevo.datos));
  assert.equal(nuevo.datos.producto.stock, 24);
  id["Agua 1 L"] = nuevo.datos.producto.id;

  const porCodigo = await rosa.get("/productos/codigo/7861234567890");
  assert.equal(porCodigo.datos.producto.nombre, "Agua 1 L");
  assert.equal((await rosa.get("/productos/codigo/000")).status, 404);

  const duplicado = await rosa.post("/productos", { nombre: "Agua 1 L", precio: 1 });
  assert.equal(duplicado.status, 409);

  const buscar = await rosa.get("/productos?q=" + encodeURIComponent("agua 1"));
  assert.deepEqual(buscar.datos.productos.map((p: { nombre: string }) => p.nombre), ["Agua 1 L"]);
  const porCodigoEnBusqueda = await rosa.get("/productos?q=7861234567890");
  assert.equal(porCodigoEnBusqueda.datos.productos.length, 1, "la búsqueda también acepta el código de barras");

  const conteo = await rosa.post(`/productos/${id["Arroz 1 kg"]}/stock`, { stock: 10, motivo: "Conteo del lunes" });
  assert.equal(conteo.datos.stock, 10);
});

test("vender, cobrar y cuadrar la caja", async () => {
  const sinCaja = await rosa.post("/ventas", {
    items: [{ producto_id: id["Agua 1 L"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 0.6 }],
  });
  assert.equal(sinCaja.status, 409);
  assert.match(sinCaja.datos.error, /Abre la caja/);

  const abrir = await rosa.post("/caja/abrir", { monto: 20 });
  assert.equal(abrir.status, 201, JSON.stringify(abrir.datos));
  assert.equal((await rosa.post("/caja/abrir", { monto: 20 })).status, 409);

  // 1 arroz + 2 leches + 2 aguas = 1,35 + 2,00 + 1,20 = 4,55; paga con 10
  const v1 = await rosa.post("/ventas", {
    items: [
      { producto_id: id["Arroz 1 kg"], cantidad: 1 },
      { producto_id: id["Leche 1 L"], cantidad: 2 },
      { producto_id: id["Agua 1 L"], cantidad: 2 },
    ],
    pagos: [{ metodo: "efectivo", monto: 4.55, recibido: 10 }],
  });
  assert.equal(v1.status, 201, JSON.stringify(v1.datos));
  assert.equal(v1.datos.venta.total, 4.55);
  assert.equal(v1.datos.venta.vuelto, 5.45);
  assert.equal(v1.datos.venta.numero, 1);
  id.venta1 = v1.datos.venta.venta_id;

  const detalle = await rosa.get(`/ventas/${id.venta1}`);
  assert.equal(detalle.datos.detalle.length, 3);
  assert.equal(detalle.datos.pagos[0].vuelto, 5.45);
  assert.equal(detalle.datos.venta.iva + detalle.datos.venta.subtotal_gravado, 4.55);

  // Pago mixto: medio queso por transferencia + efectivo
  const v2 = await rosa.post("/ventas", {
    items: [{ producto_id: id["Queso fresco"], cantidad: 0.5 }],
    pagos: [{ metodo: "transferencia", monto: 1, referencia: "Pichincha" }, { metodo: "efectivo", monto: 0.5 }],
  });
  assert.equal(v2.status, 201, JSON.stringify(v2.datos));

  const errores = [
    [{ items: [], pagos: [{ metodo: "efectivo", monto: 1 }] }, 422],
    [{ items: [{ producto_id: id["Agua 1 L"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1 }] }, 422],
    [{ items: [{ producto_id: id["Azúcar 1 kg"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1 }] }, 422],
    [{ items: [{ producto_id: id["Agua 1 L"], cantidad: 1 }], pagos: [{ metodo: "bitcoin", monto: 0.6 }] }, 422],
    [{ items: [{ producto_id: "00000000-0000-0000-0000-000000000000", cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 1 }] }, 404],
  ] as const;
  for (const [cuerpo, status] of errores) {
    const r = await rosa.post("/ventas", cuerpo);
    assert.equal(r.status, status, `${JSON.stringify(cuerpo)} → ${JSON.stringify(r.datos)}`);
  }

  // Fiado a un cliente
  const juan = await rosa.post("/clientes", { nombre: "Juan Pérez", celular: "0999999999", limite_credito: 20 });
  assert.equal(juan.status, 201, JSON.stringify(juan.datos));
  id.juan = juan.datos.cliente.id;
  const fiado = await rosa.post("/ventas", {
    items: [{ producto_id: id["Queso fresco"], cantidad: 2 }],
    pagos: [{ metodo: "fiado", monto: 6 }], cliente_id: id.juan,
  });
  assert.equal(fiado.status, 201, JSON.stringify(fiado.datos));
  const conDeuda = await rosa.get("/clientes?con_deuda=1");
  assert.equal(conDeuda.datos.clientes[0].saldo, 6);

  const abono = await rosa.post(`/clientes/${id.juan}/abonos`, { monto: 2.5, metodo: "efectivo" });
  assert.equal(abono.datos.saldo, 3.5);
  const ficha = await rosa.get(`/clientes/${id.juan}`);
  assert.equal(ficha.datos.movimientos.length, 2);

  // Gasto y retiro
  assert.equal((await rosa.post("/gastos", { categoria: "Transporte", monto: 1.5, metodo: "efectivo" })).status, 201);
  assert.equal((await rosa.post("/caja/movimientos", { tipo: "retiro", monto: 5, motivo: "Banco" })).status, 201);

  // Anular la primera venta: devuelve stock y sale de la caja
  const anular = await rosa.post(`/ventas/${id.venta1}/anular`, { motivo: "Se equivocó de producto" });
  assert.equal(anular.status, 200, JSON.stringify(anular.datos));
  const agua = (await rosa.get("/productos/codigo/7861234567890")).datos.producto;
  assert.equal(agua.stock, 24);

  // Caja: 20 + efectivo 0,50 + abono 2,50 − gasto 1,50 − retiro 5 = 16,50
  const caja = await rosa.get("/caja");
  assert.equal(caja.datos.abierta, true);
  assert.equal(caja.datos.caja.efectivo_esperado, 16.5, JSON.stringify(caja.datos.caja));
  assert.equal(caja.datos.caja.ventas_cantidad, 2);
  assert.equal(caja.datos.caja.transferencia, 1);
  assert.equal(caja.datos.caja.fiado, 6);

  const ventasHoy = await rosa.get("/ventas");
  assert.equal(ventasHoy.datos.ventas.length, 3);
  assert.equal(ventasHoy.datos.ventas.find((v: { numero: number }) => v.numero === 1).estado, "anulada");

  const resumen = await rosa.get("/resumen/hoy");
  assert.equal(resumen.datos.resumen.ventas, 2);
  assert.equal(resumen.datos.resumen.total, 7.5);
  assert.equal(resumen.datos.resumen.fiado_por_cobrar, 3.5);

  const cerrar = await rosa.post("/caja/cerrar", { contado: 16.5 });
  assert.equal(cerrar.status, 200, JSON.stringify(cerrar.datos));
  assert.equal(cerrar.datos.caja.diferencia, 0);
  assert.equal((await rosa.get("/caja")).datos.abierta, false);
  assert.equal((await rosa.get("/caja")).datos.ultimoCierre.efectivo_contado, 16.5);
});

test("cajero: vende pero no cambia precios ni anula", async () => {
  // La dueña invita a un cajero por su celular; él entra con su propio código
  const invitar = await rosa.post("/negocio/equipo", { celular: "0991234522", rol: "cajero", nombre: "Pedro" });
  assert.equal(invitar.status, 201, JSON.stringify(invitar.datos));
  const cajero = new Cliente(env.url);
  const entrada = await cajero.entrar(env, "0991234522");
  assert.equal(entrada.negocios.length, 1, "al entrar ya ve la tienda");
  cajero.negocio = rosa.negocio;

  await cajero.post("/caja/abrir", { monto: 10 });
  const venta = await cajero.post("/ventas", {
    items: [{ producto_id: id["Agua 1 L"], cantidad: 1 }], pagos: [{ metodo: "efectivo", monto: 0.6, recibido: 1 }],
  });
  assert.equal(venta.status, 201, JSON.stringify(venta.datos));
  assert.equal((await cajero.patch(`/productos/${id["Agua 1 L"]}`, { precio: 0.1 })).status, 403);
  assert.equal((await cajero.post("/ventas", {
    items: [{ producto_id: id["Agua 1 L"], cantidad: 1, precio: 0.1 }], pagos: [{ metodo: "efectivo", monto: 0.1 }],
  })).status, 403);
  assert.equal((await cajero.post(`/ventas/${venta.datos.venta.venta_id}/anular`, { motivo: "Prueba" })).status, 403);
  assert.equal((await cajero.post("/negocio/modulos/M17", { activo: true })).status, 403);
  assert.equal((await cajero.get("/negocio")).datos.rol, "cajero");
  assert.equal((await cajero.post("/negocio/equipo", { celular: "0991234523", rol: "cajero" })).status, 403);

  // La dueña lo desactiva y ya no puede entrar
  const equipo = await rosa.get("/negocio/equipo");
  assert.equal(equipo.datos.equipo.length, 2);
  assert.equal((await rosa.patch(`/negocio/equipo/${entrada.usuario.id}`, { activo: false })).status, 200);
  assert.equal((await cajero.get("/negocio")).status, 403);
});
