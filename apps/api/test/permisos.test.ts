/** Permisos por empleado por HTTP: se activan uno por uno y la API los respeta. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Cliente, levantar, type Entorno } from "./ayuda.js";

let env: Entorno;
let dueña: Cliente;
let cajero: Cliente;
let cajeroId = "";

before(async () => {
  env = await levantar();
  dueña = new Cliente(env.url);
  await dueña.entrar(env, "0991235001");
  dueña.negocio = (await dueña.post("/negocios", { tipo: "T061", nombre: "Permisos HTTP" })).datos.id;
  cajeroId = (await dueña.post("/negocio/equipo", { celular: "0991235002", rol: "cajero" })).datos.usuario_id;
  cajero = new Cliente(env.url);
  await cajero.entrar(env, "0991235002");
  cajero.negocio = dueña.negocio;
});
after(async () => { await env.app.cerrar(); });

test("sin permisos el cajero no crea productos ni ve reportes; con permisos, sí", async () => {
  assert.equal((await cajero.post("/productos", { nombre: "Nuevo del cajero", precio: 1 })).status, 403);
  assert.equal((await cajero.get("/reportes")).status, 403);
  assert.deepEqual((await cajero.get("/negocio")).datos.permisos, []);

  assert.equal((await dueña.patch(`/negocio/equipo/${cajeroId}`, { permisos: ["inventar"] })).status, 422);
  const r = await dueña.patch(`/negocio/equipo/${cajeroId}`, { permisos: ["productos", "reportes"] });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const eq = await dueña.get("/negocio/equipo");
  assert.deepEqual(eq.datos.equipo.find((m: { id: string }) => m.id === cajeroId).permisos, ["productos", "reportes"]);

  assert.deepEqual((await cajero.get("/negocio")).datos.permisos, ["productos", "reportes"]);
  assert.equal((await cajero.post("/productos", { nombre: "Nuevo del cajero", precio: 1 })).status, 201);
  assert.equal((await cajero.get("/reportes")).status, 200);
  assert.equal((await cajero.get("/balance?desde=2026-01-01")).status, 200);

  // El cajero no se da permisos a sí mismo
  assert.equal((await cajero.patch(`/negocio/equipo/${cajeroId}`, { permisos: ["anular"] })).status, 403);
});
