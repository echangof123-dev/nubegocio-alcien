/**
 * Asistente del negocio: entiende frases comunes en español (sin IA de pago) y responde con datos
 * del negocio, o propone registrar una venta o un gasto, que el usuario confirma antes de guardar.
 */

export type Periodo = { desde: string; hasta: string; nombre: string };

export type Intencion =
  | { tipo: "ventas"; periodo: Periodo }
  | { tipo: "ganancia"; periodo: Periodo }
  | { tipo: "gastos"; periodo: Periodo }
  | { tipo: "mas_vendido"; periodo: Periodo }
  | { tipo: "deudas" }
  | { tipo: "por_acabarse" }
  | { tipo: "caja" }
  | { tipo: "stock"; producto: string }
  | { tipo: "precio"; producto: string }
  | { tipo: "vender"; items: { cantidad: number; producto: string }[]; metodo: string | null; monto: number | null }
  | { tipo: "gasto"; monto: number; categoria: string; descripcion: string | null; metodo: string | null }
  | { tipo: "saludo" }
  | { tipo: "ayuda" };

export const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/(\d)[.,](\d)/g, "$1#$2").replace(/[¿?¡!.,;:"'#]/g, (c) => (c === "#" ? "#" : " "))
  .replace(/(\d)#(\d)/g, "$1.$2").replace(/#/g, " ").replace(/\s+/g, " ").trim();

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
  media: 0.5, medio: 0.5, docena: 12,
};

/** "12,50" · "12.50" · "$12" · "doce" → número */
export function leerNumero(t: string): number | null {
  const limpio = t.replace(/^\$/, "").replace(/usd$|dolares?$/, "");
  if (/^\d+([.,]\d{1,3})?$/.test(limpio)) return Number(limpio.replace(",", "."));
  return NUMEROS[limpio] ?? null;
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

/** El periodo que menciona la frase, en la fecha de Ecuador. Por defecto, hoy. */
export function leerPeriodo(t: string, ahora = new Date()): Periodo {
  const hoy = new Date(ahora.getTime() - 5 * 3600e3);
  hoy.setUTCHours(12, 0, 0, 0);
  const dia = (n: number) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  if (/\bayer\b/.test(t)) return { desde: dia(-1), hasta: dia(-1), nombre: "ayer" };
  if (/semana pasada/.test(t)) {
    const lunes = -((hoy.getUTCDay() + 6) % 7);
    return { desde: dia(lunes - 7), hasta: dia(lunes - 1), nombre: "la semana pasada" };
  }
  if (/(esta|la) semana|ultimos 7|7 dias/.test(t)) {
    const lunes = -((hoy.getUTCDay() + 6) % 7);
    return { desde: dia(lunes), hasta: dia(0), nombre: "esta semana" };
  }
  if (/mes pasado/.test(t)) {
    const ini = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1, 12));
    const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0, 12));
    return { desde: ymd(ini), hasta: ymd(fin), nombre: "el mes pasado" };
  }
  if (/(este|el) mes|en el mes|del mes/.test(t)) {
    return { desde: ymd(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1, 12))), hasta: dia(0), nombre: "este mes" };
  }
  if (/(este|el) ano|en el ano/.test(t)) {
    return { desde: `${hoy.getUTCFullYear()}-01-01`, hasta: dia(0), nombre: "este año" };
  }
  return { desde: dia(0), hasta: dia(0), nombre: "hoy" };
}

const METODOS: [RegExp, string][] = [
  [/\b(en )?efectivo|cash\b/, "efectivo"], [/transferencia|transfirio|deposito/, "transferencia"],
  [/tarjeta|datafono/, "tarjeta"], [/deuna|de una\b/, "deuna"], [/fiad[oa]|credito|me debe/, "fiado"],
];
const metodoDe = (t: string) => METODOS.find(([re]) => re.test(t))?.[1] ?? null;

export const CATEGORIAS_GASTO: [RegExp, string][] = [
  [/arriendo|alquiler|renta del local/, "Arriendo"],
  [/luz|agua|internet|telefono|celular|gas\b|servicios? basicos?|electricidad|plan/, "Servicios públicos"],
  [/sueldo|nomina|pago a (mi )?(empleado|ayudante|trabajador)|quincena|jornal/, "Nómina"],
  [/taxi|transporte|pasaje|gasolina|combustible|flete|envio|delivery|domicilio|carrera/, "Transporte y domicilios"],
  [/publicidad|anuncio|volantes|facebook|instagram|redes/, "Mercadeo y publicidad"],
  [/arreglo|reparacion|mantenimiento|pintura|plomero|tecnico/, "Mantenimiento y reparaciones"],
  [/mercaderia|mercancia|producto|insumo|proveedor|compra de/, "Compra de productos e insumos"],
  [/impuesto|sri|permiso|patente|municipio/, "Impuestos"],
  [/mueble|equipo|maquina|refrigeradora|vitrina|balanza/, "Muebles, equipos o maquinaria"],
  [/papeleria|contador|banco|comision/, "Gastos administrativos"],
];

const RELLENO = /\b(el|la|los|las|de|del|un|una|unos|unas|por|en|a|al|me|mi|mis|que|y|con|para|hoy|ayer)\b/g;
const limpiarProducto = (t: string) => t.replace(RELLENO, " ").replace(/\s+/g, " ").trim();

/** Qué quiere el usuario. Las reglas van de lo más específico a lo más general. */
export function entender(mensaje: string, ahora = new Date()): Intencion {
  const t = normalizar(mensaje);
  if (!t) return { tipo: "ayuda" };

  // Registrar un gasto: "gaste 10 en taxi", "pague 25 de luz"
  const g = t.match(/^(?:gaste|pague|registra(?:r)? (?:un )?gasto(?: de)?|gasto(?: de)?)\s+\$?\s*([\d.,]+|\w+)\s*(?:dolares|usd)?\s*(?:en|de|por|para)?\s*(.*)$/);
  if (g) {
    const monto = leerNumero(g[1]!);
    if (monto && monto > 0) {
      const resto = g[2]!.trim();
      const categoria = CATEGORIAS_GASTO.find(([re]) => re.test(resto))?.[1] ?? "Otros";
      const descripcion = resto.replace(/\b(en |con |por )?(efectivo|transferencia|tarjeta)\b/, "").trim() || null;
      return { tipo: "gasto", monto, categoria, descripcion, metodo: metodoDe(resto) };
    }
  }

  // Registrar una venta: "vendi 2 colas y un pan en efectivo", "registra una venta de 5 dolares"
  const v = t.match(/^(?:vendi|registra(?:r)? (?:una )?venta(?: de)?|anota (?:una )?venta(?: de)?|venta de)\s+(.*)$/);
  if (v) {
    const metodo = metodoDe(v[1]!);
    const cuerpo = v[1]!.replace(/\b(en |con |por |a )?(efectivo|transferencia|tarjeta|deuna|de una|fiado|fiada|credito)\b/g, " ").trim();
    const soloMonto = cuerpo.match(/^\$?\s*([\d.,]+)\s*(dolares|usd|\$)?$/);
    if (soloMonto) return { tipo: "vender", items: [], metodo, monto: leerNumero(soloMonto[1]!) };
    const items = cuerpo.split(/\s*(?:,|\by\b|\bmas\b|\+)\s*/).map((parte) => {
      const m = parte.trim().match(/^([\d.,]+|\w+)\s+(.+)$/);
      const n = m ? leerNumero(m[1]!) : null;
      return n ? { cantidad: n, producto: limpiarProducto(m![2]!) } : { cantidad: 1, producto: limpiarProducto(parte) };
    }).filter((x) => x.producto.length >= 2);
    if (items.length) return { tipo: "vender", items, metodo, monto: null };
  }

  if (/^(hola|buen(os|as) (dias|tardes|noches)|que tal|hey)\b/.test(t) && t.split(" ").length <= 4) return { tipo: "saludo" };
  if (/ayuda|que (puedes|sabes) hacer|como (te )?uso|que te puedo preguntar/.test(t)) return { tipo: "ayuda" };

  if (/(quien|quienes|cuanto|cuantos) me deben|deudas?|fiados?|por cobrar|me debe/.test(t)) return { tipo: "deudas" };
  if (/acaba|agotad|stock bajo|poco stock|falta(n)? (de )?(productos|mercaderia)|que (me )?falta|reponer|pedir al proveedor/.test(t)) return { tipo: "por_acabarse" };
  if (/(cuanto|que) (hay|tengo) en (la )?caja|efectivo en caja|cuadr(ar|e) (la )?caja|caja de hoy/.test(t)) return { tipo: "caja" };
  if (/(mas|mejor) vend|lo que mas|producto estrella|top/.test(t)) return { tipo: "mas_vendido", periodo: leerPeriodo(t, ahora) };
  if (/gan(e|ancia|ado|amos)|utilidad|cuanto (me )?queda|rentab/.test(t)) return { tipo: "ganancia", periodo: leerPeriodo(t, ahora) };
  if (/gast(e|o|os|amos|ado)|egresos|cuanto (pague|salio)/.test(t)) return { tipo: "gastos", periodo: leerPeriodo(t, ahora) };
  if (/vend(i|imos|ido|iste|ieron)|ventas|ingres|factur(e|amos|ado)|cuanto (hice|entro|llevo)|como (me |nos )?(fue|va)/.test(t)) {
    return { tipo: "ventas", periodo: leerPeriodo(t, ahora) };
  }

  const precio = t.match(/(?:cuanto (?:cuesta|vale|esta)|precio (?:de|del)?|a cuanto (?:esta|vendo|sale))\s+(.+)$/);
  if (precio) {
    const producto = limpiarProducto(precio[1]!);
    if (producto.length >= 2) return { tipo: "precio", producto };
  }
  const stock = t.match(/(?:cuant[oa]s?|que stock|stock|inventario|existencias?)\s+(?:de\s+)?(?:hay de |tengo de |me quedan? de |quedan? de |me quedan? |quedan? |tengo |hay )?(.+?)(?:\s+(?:me )?quedan?|\s+tengo|\s+hay)?$/);
  if (stock && /cuant|stock|inventario|existencia|queda/.test(t)) {
    const producto = limpiarProducto(stock[1]!.replace(/\b(me quedan?|quedan?|tengo|hay|en stock|en bodega)\b/g, " "));
    if (producto.length >= 2) return { tipo: "stock", producto };
  }
  return { tipo: "ayuda" };
}

/** Palabras de un nombre sin tildes ni plural simple, para comparar con lo que escribió el usuario. */
export function raices(t: string): string[] {
  return normalizar(t).split(" ").filter((w) => w.length >= 2 && !/^(de|del|la|el|los|las|con|sin|y)$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/** Qué tan bien calza lo escrito con el nombre del producto (0 a 1). */
export function parecido(buscado: string, nombre: string): number {
  const b = raices(buscado), n = raices(nombre);
  if (!b.length || !n.length) return 0;
  const calzan = b.filter((w) => n.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length;
  return calzan / b.length * (0.75 + 0.25 * Math.min(1, calzan / n.length));
}
