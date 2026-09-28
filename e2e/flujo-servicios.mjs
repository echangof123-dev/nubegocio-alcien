// Recorrido de un negocio de servicios: una peluquería con agenda, cobro de la cita y comisión
// de la estilista; y también (activando módulos) una orden de trabajo, una reserva y una membresía.
//   BASE=http://localhost:8080 node e2e/flujo-servicios.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const CAPTURAS = path.join(path.dirname(new URL(import.meta.url).pathname), "capturas", "servicios");
fs.mkdirSync(CAPTURAS, { recursive: true });

const celular = "09" + String(Date.now() + 29).slice(-8);
const errores = [];
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-EC", timezoneId: "America/Guayaquil" });
const pagina = await contexto.newPage();
pagina.on("pageerror", (e) => errores.push(e.message));
pagina.on("console", (m) => { if (m.type() === "error" && !/status of 40[149]/.test(m.text())) errores.push(m.text()); });

let n = 0;
const foto = async (nombre, p = pagina) => p.screenshot({ path: path.join(CAPTURAS, `${String(++n).padStart(2, "0")}-${nombre}.png`) });
const esperarTexto = (t, p = pagina) => p.getByText(t, { exact: false }).first().waitFor({ timeout: 10_000 });
const api = (metodo, ruta, cuerpo) => pagina.evaluate(async ([metodo, ruta, cuerpo]) => {
  const r = await fetch("/api" + ruta, {
    method: metodo, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-negocio": localStorage.getItem("alcien.negocio") ?? "" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}, [metodo, ruta, cuerpo]);
const dialogo = () => pagina.getByRole("dialog").last();

try {
  await pagina.goto(BASE);
  await pagina.getByLabel("Tu número de celular").fill(celular);
  await pagina.getByRole("button", { name: "Enviar código por WhatsApp" }).click();
  await esperarTexto("Modo de prueba");
  const codigo = (await pagina.getByText("Tu código es").innerText()).match(/\d{6}/)[0];
  await pagina.getByLabel("Código de 6 dígitos").fill(codigo);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  await pagina.getByLabel("Tipo de negocio").fill("peluqueria");
  await pagina.getByRole("listitem").filter({ hasText: "Peluquería" }).first().click();
  await pagina.getByLabel("Nombre del negocio").fill("Salón Bella");
  await pagina.getByRole("button", { name: "Crear mi negocio" }).click();
  await esperarTexto("La caja está cerrada");

  const corte = await api("POST", "/productos", { nombre: "Corte y cepillado", precio: 15, maneja_stock: false, unidad: "Servicio" });
  if (corte.status !== 201) throw new Error(JSON.stringify(corte.datos));
  await api("PATCH", `/productos/${corte.datos.producto.id}`, { duracion_min: 60 });
  for (const m of ["M13", "M22", "M26"]) await api("POST", `/negocio/modulos/${m}`, { activo: true });
  await api("POST", "/caja/abrir", { monto: 20 });
  await pagina.reload();

  // Más muestra las pantallas de servicios
  await pagina.getByRole("link", { name: "Más" }).click();
  await esperarTexto("Agenda");
  await foto("mas-servicios");

  // Profesional con comisión
  await pagina.getByRole("button", { name: /Profesionales/ }).click();
  await pagina.getByRole("button", { name: "Agregar profesional" }).click();
  await pagina.getByLabel("Nombre", { exact: true }).fill("Daniela");
  await pagina.getByLabel(/Comisión %/).fill("40");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await esperarTexto("40 % de comisión");

  // Agendar una cita
  await pagina.goto(BASE + "/agenda");
  await pagina.getByRole("button", { name: "Agendar cita" }).click();
  await pagina.getByLabel("Nombre del cliente").fill("Paola Ruiz");
  await pagina.getByLabel("Celular").fill("0991231234");
  await pagina.getByRole("button", { name: /Elegir servicio/ }).click();
  await pagina.getByLabel("Buscar", { exact: true }).fill("Corte y cep");
  await pagina.getByRole("button", { name: /Corte y cepillado/ }).click();
  await pagina.getByLabel("Lo atiende").selectOption({ label: "Daniela" });
  await pagina.getByLabel("Hora").fill("23:00");
  await foto("agendar");
  await pagina.getByRole("button", { name: "Agendar", exact: true }).click();
  await esperarTexto("Paola Ruiz");
  await esperarTexto("con Daniela");
  await foto("agenda");

  // Cobrar la cita
  await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
  await pagina.getByRole("button", { name: "Continuar al cobro" }).click();
  await pagina.getByRole("button", { name: "Cobrar $ 15,00" }).click();
  await esperarTexto("Cobrada");
  await foto("cita-cobrada");

  // La comisión quedó por pagar
  await pagina.goto(BASE + "/profesionales");
  await esperarTexto("$ 6,00");
  await pagina.getByRole("button", { name: "Pagar comisiones" }).click();
  await pagina.getByRole("button", { name: "Pagar $ 6,00" }).click();
  await esperarTexto("Pagaste $ 6,00");
  await foto("comisiones");

  // Orden de trabajo con seguimiento público
  const rep = await api("POST", "/productos", { nombre: "Secador repuesto motor", precio: 8, stock_inicial: 2 });
  if (rep.status !== 201) throw new Error(JSON.stringify(rep.datos));
  await pagina.goto(BASE + "/ordenes");
  await pagina.getByRole("button", { name: "Recibir equipo" }).click();
  await pagina.getByLabel("Nombre del cliente").fill("Jorge Salas");
  await pagina.getByLabel("Equipo o vehículo").fill("Secador Remington");
  await pagina.getByLabel("¿Qué problema tiene?").fill("No calienta");
  await pagina.getByRole("button", { name: "Crear orden" }).click();
  await esperarTexto("Orden N.º 1");
  await pagina.getByRole("button", { name: /Repuesto/ }).click();
  await pagina.getByLabel("Buscar", { exact: true }).fill("Secador rep");
  await pagina.getByRole("button", { name: /Secador repuesto motor/ }).click();
  await dialogo().getByRole("button", { name: "Agregar" }).click();
  await esperarTexto("$ 8,00");
  await pagina.getByLabel("Diagnóstico").fill("Motor quemado");
  await pagina.getByRole("button", { name: "En diagnóstico" }).click();
  await foto("orden");
  const orden = await api("GET", "/ordenes?estado=abiertas");
  const detalle = await api("GET", `/ordenes/${orden.datos.ordenes[0].id}`);
  const seguimiento = await (await navegador.newContext()).newPage();
  await seguimiento.goto(`${BASE}/api/o/${detalle.datos.orden.token_publico}`);
  await esperarTexto("En diagnóstico", seguimiento);
  await esperarTexto("Motor quemado", seguimiento);
  await foto("orden-seguimiento", seguimiento);
  await dialogo().getByRole("button", { name: "Cobrar" }).click();
  await pagina.getByRole("button", { name: "Cobrar $ 8,00" }).click();
  await pagina.getByRole("button", { name: "Entregar al cliente" }).click();
  await esperarTexto("Entregada");
  await pagina.keyboard.press("Escape");

  // Reserva de una sala
  await pagina.goto(BASE + "/reservas");
  await pagina.getByRole("button", { name: "Agregar" }).click();
  await pagina.getByLabel("Nombre", { exact: true }).fill("Sala VIP");
  await pagina.getByLabel("Tipo").selectOption("Salón");
  await pagina.getByRole("button", { name: "por hora" }).click();
  await pagina.getByLabel(/Precio por hora/).fill("10");
  await pagina.getByRole("button", { name: "Guardar" }).click();
  await pagina.getByRole("button", { name: /Reservar Sala VIP/ }).first().click();
  await pagina.getByLabel("Nombre del cliente").fill("Novia Andrea");
  await pagina.getByRole("button", { name: "Reservar", exact: true }).click();
  await esperarTexto("Reserva N.º 1 guardada");
  await esperarTexto("$ 10,00");
  await foto("reservas");

  // Membresía: plan, venta y entrada
  await pagina.goto(BASE + "/membresias");
  await pagina.getByRole("tab", { name: "Planes" }).click();
  await pagina.getByRole("button", { name: "Nuevo plan" }).click();
  await pagina.getByLabel("Precio").fill("40");
  await pagina.getByLabel(/Clases incluidas/).fill("4");
  await pagina.getByRole("button", { name: "Crear plan" }).click();
  await pagina.getByRole("button", { name: "Vender membresía" }).click();
  await pagina.getByRole("button", { name: /Nuevo cliente|Crear cliente/ }).first().click();
  await pagina.getByLabel("Nombre").last().fill("Carla Mena");
  await dialogo().getByRole("button", { name: /Guardar/ }).click();
  await pagina.getByRole("button", { name: "Continuar al cobro" }).click();
  await pagina.getByRole("button", { name: "Cobrar $ 40,00" }).click();
  await esperarTexto("al día hasta");
  await pagina.getByRole("button", { name: "Marcar entrada" }).click();
  await esperarTexto("le quedan 3 clases");
  await foto("membresias");

  if (errores.length) throw new Error("Errores en la consola del navegador:\n" + errores.join("\n"));
  console.log(`✔ Recorrido de servicios sin errores (${n} capturas en e2e/capturas/servicios)`);
} catch (e) {
  await foto("error").catch(() => {});
  console.error("✘ " + e.message);
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
}
