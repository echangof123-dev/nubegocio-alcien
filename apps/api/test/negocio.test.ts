import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
before(async () => { env = await levantar(); });
after(async () => { await env.app.cerrar(); });

test("alta automática: de '¿qué negocio tienes?' a vender", async () => {
  const rosa = new Cliente(env.url);
  await rosa.entrar(env, "0991234511");

  const tipos = await rosa.get("/tipos-negocio?q=" + encodeURIComponent("tengo una tienda de bario"));
  assert.equal(tipos.status, 200);
  assert.equal(tipos.datos.tipos[0].codigo, "T045");

  const creado = await rosa.post("/negocios", { tipo: "T045", nombre: "Tienda Doña Rosa" });
  assert.equal(creado.status, 201, JSON.stringify(creado.datos));
  rosa.negocio = creado.datos.id;

  const n = await rosa.get("/negocio");
  assert.equal(n.status, 200, JSON.stringify(n.datos));
  assert.equal(n.datos.rol, "dueno");
  assert.equal(n.datos.negocio.tipo, "Tienda de barrio");
  assert.equal(n.datos.negocio.plan, "negocio");
  assert.equal(n.datos.negocio.suscripcion, "prueba");
  assert.deepEqual(n.datos.negocio.metodos_pago, ["efectivo", "transferencia", "tarjeta"]);
  const estado = (m: string) => n.datos.modulos.find((x: { modulo: string }) => x.modulo === m)?.estado;
  assert.equal(estado("M01"), "activo");
  assert.equal(estado("M19"), "activo", "SRI en la prueba del plan Negocio");
  assert.equal(estado("M17"), "sugerido");

  const productos = await rosa.get("/productos");
  assert.ok(productos.datos.productos.some((p: { nombre: string; es_ejemplo: boolean }) => p.nombre === "Arroz 1 kg" && p.es_ejemplo));

  const yo = await rosa.get("/yo");
  assert.equal(yo.datos.negocios.length, 1);

  // Activar un módulo sugerido
  const act = await rosa.post("/negocio/modulos/M17", { activo: true });
  assert.equal(act.status, 200);
  assert.equal(act.datos.modulos.find((x: { modulo: string }) => x.modulo === "M17").estado, "activo", "en la prueba gratis se usa todo (Listas de precios es de Pro)");

  // Configuración
  const cfg = await rosa.patch("/negocio/config", { metodos_pago: ["efectivo", "deuna"], iva_defecto: 15 });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.datos));
  assert.deepEqual(cfg.datos.config.metodos_pago, ["efectivo", "deuna"]);
});

test("un usuario no puede entrar al negocio de otro", async () => {
  const a = new Cliente(env.url);
  await a.entrar(env, "0991234512");
  a.negocio = (await a.post("/negocios", { tipo: "T001", nombre: "Restaurante A" })).datos.id;

  const b = new Cliente(env.url);
  await b.entrar(env, "0991234513");
  b.negocio = a.negocio;
  const r = await b.get("/negocio");
  assert.equal(r.status, 403);
  assert.equal((await b.get("/productos")).status, 403);

  b.negocio = "no-es-un-uuid";
  assert.equal((await b.get("/negocio")).status, 422);
});

test("tipo de negocio nuevo con IA", async () => {
  const c = new Cliente(env.url);
  await c.entrar(env, "0991234514");

  env.ia.respuesta = {
    nombre: "Venta de artesanías de tagua",
    familia: "F06",
    sinonimos: ["tagua"],
    categorias: ["Bisutería", "Figuras"],
    productos: [{ categoria: "Bisutería", nombre: "Collar de tagua", unidad: "Unidad" }],
  };
  const r = await c.post("/tipos-negocio/sugerir", { descripcion: "hago cosas de tagua para turistas" });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.origen, "ia");
  assert.match(r.datos.tipo.codigo, /^IA\d{4}$/);

  const creado = await c.post("/negocios", { tipo: r.datos.tipo.codigo, nombre: "Tagua Linda" });
  assert.equal(creado.status, 201);
  c.negocio = creado.datos.id;
  const prods = await c.get("/productos");
  assert.deepEqual(prods.datos.productos.map((p: { nombre: string }) => p.nombre), ["Collar de tagua"]);

  // Si la IA no responde, igual se puede seguir con la familia general
  env.ia.respuesta = null;
  const sinIa = await c.post("/tipos-negocio/sugerir", { descripcion: "reparo relojes antiguos" });
  assert.equal(sinIa.datos.origen, "general");
  assert.equal(sinIa.datos.tipo.familia, "F06");

  // Una descripción que ya está en el catálogo no gasta IA
  const antes = env.ia.llamadas;
  const conocido = await c.post("/tipos-negocio/sugerir", { descripcion: "ferreteria" });
  assert.equal(conocido.datos.origen, "catalogo");
  assert.equal(conocido.datos.tipo.codigo, "T109");
  assert.equal(env.ia.llamadas, antes);
});

test("validaciones al crear negocio", async () => {
  const c = new Cliente(env.url);
  await c.entrar(env, "0991234515");
  assert.equal((await c.post("/negocios", { tipo: "T999", nombre: "X Y" })).status, 404);
  assert.equal((await c.post("/negocios", { tipo: "T045", nombre: "" })).status, 422);
  assert.equal((await c.post("/negocios", { tipo: "T045", nombre: "Con RUC", ruc: "123" })).status, 422);
  assert.equal((await c.post("/negocios", { tipo: "T045", nombre: "Con RUC", ruc: "1790012345001" })).status, 201);
});
