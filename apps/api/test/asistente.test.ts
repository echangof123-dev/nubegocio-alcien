/** Asistente: entiende frases comunes y responde con datos del negocio; propone ventas y gastos. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { entender, parecido } from "../src/asistente.js";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

const lunes = new Date("2026-09-28T15:00:00Z");

test("entiende preguntas y órdenes en español", () => {
  assert.deepEqual(entender("¿Cuánto vendí ayer?", lunes), { tipo: "ventas", periodo: { desde: "2026-09-27", hasta: "2026-09-27", nombre: "ayer" } });
  assert.equal(entender("cuánto gané el mes pasado", lunes).tipo, "ganancia");
  assert.equal(entender("qué es lo que más vendo", lunes).tipo, "mas_vendido");
  assert.equal(entender("quién me debe").tipo, "deudas");
  assert.equal(entender("qué se está acabando").tipo, "por_acabarse");
  assert.deepEqual(entender("cuanto cuesta el pan"), { tipo: "precio", producto: "pan" });
  assert.deepEqual(entender("cuántas colas me quedan"), { tipo: "stock", producto: "colas" });
  assert.deepEqual(entender("vendí 2 colas y un pan en efectivo"),
    { tipo: "vender", items: [{ cantidad: 2, producto: "colas" }, { cantidad: 1, producto: "pan" }], metodo: "efectivo", monto: null });
  assert.deepEqual(entender("registra una venta de 12,50 por transferencia"), { tipo: "vender", items: [], metodo: "transferencia", monto: 12.5 });
  assert.deepEqual(entender("pagué 30 de luz por transferencia"),
    { tipo: "gasto", monto: 30, categoria: "Servicios públicos", descripcion: "luz", metodo: "transferencia" });
  assert.equal(entender("asdf").tipo, "ayuda");
  assert.ok(parecido("colas", "Coca Cola 500 ml") >= 0.5);
  assert.ok(parecido("arroz", "Aceite 1 litro") < 0.5);
});

let env: Entorno;
let dueña: Cliente;
before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991235101");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T061", nombre: "Tienda Asistente" })).datos.id;
  await dueña.post("/productos", { nombre: "Coca Cola 500 ml", precio: 0.75, stock_inicial: 24 });
  await dueña.post("/productos", { nombre: "Pan de yuca", precio: 0.25, stock_inicial: 50 });
  await dueña.post("/caja/abrir", { monto: 10 });
});
after(async () => { await env.app.cerrar(); });

const preguntar = async (mensaje: string) => (await dueña.post("/asistente", { mensaje })).datos.respuesta;

test("responde con los datos del negocio y propone la venta sin guardarla", async () => {
  const propuesta = await preguntar("vendí 2 colas y 4 panes en efectivo");
  assert.equal(propuesta.accion.tipo, "venta");
  assert.equal(propuesta.accion.total, 2.5);
  assert.equal((await preguntar("¿cuánto vendí hoy?")).texto, "Todavía no hay ventas hoy.", "proponer no registra");

  // La web confirma con la acción propuesta
  const v = await dueña.post("/ventas", { items: propuesta.accion.items, pagos: [{ metodo: "efectivo", monto: propuesta.accion.total }] });
  assert.equal(v.status, 201, JSON.stringify(v.datos));
  assert.match((await preguntar("¿cuánto vendí hoy?")).texto, /Hoy vendiste \$ 2,50 en 1 venta/);
  assert.match((await preguntar("cuántas colas me quedan")).texto, /Te quedan 22/);
  assert.match((await preguntar("cuanto cuesta el pan")).texto, /Pan de yuca cuesta \$ 0,25/);
  assert.match((await preguntar("qué es lo que más vendo")).texto, /Coca Cola/);
  assert.match((await preguntar("cuánto hay en caja")).texto, /\$ 12,50/);
  const gasto = await preguntar("gasté 3 en taxi");
  assert.equal(gasto.accion.categoria, "Transporte y domicilios");
  assert.equal((await preguntar("hola")).sugerencias.length > 3, true);
});
