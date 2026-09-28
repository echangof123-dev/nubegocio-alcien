import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
before(async () => { env = await levantar(); });
after(async () => { await env.app.cerrar(); });

test("la API responde y está sana", async () => {
  const c = new Cliente(env.url);
  const r = await c.get("/salud");
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos, { ok: true });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("rutas desconocidas y métodos no permitidos", async () => {
  const c = new Cliente(env.url);
  assert.equal((await c.get("/no-existe")).status, 404);
  assert.equal((await c.pedir("DELETE", "/salud")).status, 405);
});

test("acceso con código por WhatsApp", async () => {
  const c = new Cliente(env.url);

  const malo = await c.post("/auth/codigo", { celular: "12345" });
  assert.equal(malo.status, 422);

  const pedido = await c.post("/auth/codigo", { celular: "099 123 4501" });
  assert.equal(pedido.status, 200, JSON.stringify(pedido.datos));
  assert.equal(pedido.datos.celular, "+593991234501", "se normaliza a E.164");
  assert.equal(pedido.datos.codigoDev, undefined, "el código nunca viaja en la respuesta fuera de desarrollo");
  const codigo = env.enviador.codigos.get("+593991234501")!;
  assert.match(codigo, /^\d{6}$/);

  const otro = codigo === "000000" ? "111111" : "000000";
  const incorrecto = await c.post("/auth/verificar", { celular: "0991234501", codigo: otro });
  assert.equal(incorrecto.status, 422);
  assert.match(incorrecto.datos.error, /Te quedan 4 intentos/);

  assert.equal((await c.get("/yo")).status, 401, "sin sesión todavía");

  const ok = await c.post("/auth/verificar", { celular: "0991234501", codigo });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.nuevo, true);
  assert.equal(ok.datos.token, undefined, "el token solo va en la cookie");
  const setCookie = ok.headers.get("set-cookie")!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const yo = await c.get("/yo");
  assert.equal(yo.status, 200);
  assert.equal(yo.datos.usuario.celular, "+593991234501");
  assert.deepEqual(yo.datos.negocios, []);

  // El código ya no sirve una segunda vez
  const c2 = new Cliente(env.url);
  const repetido = await c2.post("/auth/verificar", { celular: "0991234501", codigo });
  assert.equal(repetido.status, 422);

  // Salir invalida la sesión
  assert.equal((await c.post("/auth/salir")).status, 204);
  const cookieVieja = c.cookie;
  const c3 = new Cliente(env.url);
  c3.cookie = cookieVieja;
  assert.equal((await c3.get("/yo")).status, 401);
});

test("límite de códigos por celular", async () => {
  const c = new Cliente(env.url);
  for (let i = 0; i < 3; i++) assert.equal((await c.post("/auth/codigo", { celular: "0991234502" })).status, 200);
  const cuarto = await c.post("/auth/codigo", { celular: "0991234502" });
  assert.equal(cuarto.status, 429);
});

test("cinco intentos fallidos bloquean el código", async () => {
  const c = new Cliente(env.url);
  await c.post("/auth/codigo", { celular: "0991234503" });
  const codigo = env.enviador.codigos.get("+593991234503")!;
  const malo = codigo === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i++) await c.post("/auth/verificar", { celular: "0991234503", codigo: malo });
  const bloqueado = await c.post("/auth/verificar", { celular: "0991234503", codigo });
  assert.equal(bloqueado.status, 429, "ni el código correcto sirve tras 5 fallos");
});

test("si WhatsApp falla, el código no queda contando", async () => {
  const c = new Cliente(env.url);
  env.enviador.fallar = true;
  const r = await c.post("/auth/codigo", { celular: "0991234504" });
  env.enviador.fallar = false;
  assert.equal(r.status, 502);
  for (let i = 0; i < 3; i++) assert.equal((await c.post("/auth/codigo", { celular: "0991234504" })).status, 200);
});

test("protección de peticiones", async () => {
  const c = new Cliente(env.url);
  const ajeno = await c.pedir("POST", "/auth/codigo", { celular: "0991234505" }, { origin: "https://sitio-malo.com" });
  assert.equal(ajeno.status, 403, "otro sitio no puede hacer peticiones que cambian datos");

  const r = await fetch(env.url + "/api/auth/codigo", { method: "POST", headers: { "content-type": "text/plain" }, body: "celular=0991234505" });
  assert.equal(r.status, 415, "solo JSON");

  const grande = await c.post("/auth/codigo", { celular: "x".repeat(2_000_000) });
  assert.equal(grande.status, 413);

  const token = await c.pedir("GET", "/yo", undefined, { authorization: "Bearer inventado-inventado-inventado" });
  assert.equal(token.status, 401);
});
