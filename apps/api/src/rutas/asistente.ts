/** Asistente del negocio: preguntas sobre ventas, gastos, deudas y stock; propone ventas y gastos. */
import type { Router } from "../http/servidor.js";
import type { ContextoNegocio } from "../db/pool.js";
import { objeto, texto } from "../http/validar.js";
import { entender, parecido, type Intencion } from "../asistente.js";
import { puede } from "./comun.js";

const dinero = (n: unknown) => "$ " + Number(n ?? 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = (n: unknown) => Number(n ?? 0).toLocaleString("es-EC", { maximumFractionDigits: 3 });
const METODO: Record<string, string> = { efectivo: "efectivo", transferencia: "transferencia", tarjeta: "tarjeta", deuna: "DeUna", fiado: "fiado" };

interface Respuesta {
  texto: string;
  filas?: { etiqueta: string; valor: string }[];
  accion?: Record<string, unknown>;
  sugerencias?: string[];
}
interface ProductoAsis { id: string; nombre: string; precio: number | null; stock: number; unidad: string; maneja_stock: boolean }

const AYUDA: Respuesta = {
  texto: "Puedo contarte cómo va tu negocio y anotar ventas o gastos. Prueba con:",
  sugerencias: ["¿Cuánto vendí hoy?", "¿Cuánto gané este mes?", "¿Qué es lo que más vendo?", "¿Quién me debe?",
    "¿Qué se está acabando?", "¿Cuánto hay en caja?", "Vendí 2 colas en efectivo", "Gasté 5 en taxi"],
};

async function productos(ctx: ContextoNegocio): Promise<ProductoAsis[]> {
  const { rows } = await ctx.db.query<ProductoAsis>(
    `select id, nombre, precio, stock, unidad, maneja_stock from app.producto
     where activo and tipo = 'venta' and not exists (select 1 from app.producto h where h.padre_id = producto.id and h.activo)
     order by nombre limit 3000`);
  return rows;
}
function mejor(lista: ProductoAsis[], buscado: string) {
  const puntuados = lista.map((p) => ({ p, s: parecido(buscado, p.nombre) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
  return { elegido: puntuados[0] && (puntuados.length === 1 || puntuados[0].s > puntuados[1]!.s) ? puntuados[0].p : null, opciones: puntuados.slice(0, 4).map((x) => x.p) };
}

export async function responder(ctx: ContextoNegocio, i: Intencion): Promise<Respuesta> {
  const q = ctx.db;
  const conReportes = puede(ctx, "reportes");
  const soloHoy = (p: { nombre: string }) => !conReportes && p.nombre !== "hoy";
  switch (i.tipo) {
    case "saludo": return { ...AYUDA, texto: "¡Hola! " + AYUDA.texto };
    case "ayuda": return AYUDA;

    case "ventas": {
      if (soloHoy(i.periodo)) return { texto: "Solo el dueño o un administrador pueden ver las ventas de otros días." };
      const { rows } = await q.query<{ r: any }>("select app.reporte_periodo($1, $2) as r", [i.periodo.desde, i.periodo.hasta]);
      const r = rows[0]!.r;
      if (!Number(r.ventas)) return { texto: `Todavía no hay ventas ${i.periodo.nombre}.`, sugerencias: ["¿Cuánto vendí ayer?", "¿Cuánto vendí este mes?"] };
      const cambio = Number(r.total_anterior) > 0 ? Math.round((Number(r.total) - Number(r.total_anterior)) / Number(r.total_anterior) * 100) : null;
      return {
        texto: `${i.periodo.nombre[0]!.toUpperCase() + i.periodo.nombre.slice(1)} vendiste ${dinero(r.total)} en ${r.ventas} ${Number(r.ventas) === 1 ? "venta" : "ventas"}.` +
          (cambio !== null && conReportes ? ` Es ${Math.abs(cambio)} % ${cambio >= 0 ? "más" : "menos"} que el periodo anterior.` : ""),
        filas: [
          { etiqueta: "Venta promedio", valor: dinero(r.ticket_promedio) },
          ...(r.por_metodo as { metodo: string; total: number }[]).map((m) => ({ etiqueta: `En ${METODO[m.metodo] ?? m.metodo}`, valor: dinero(m.total) })),
        ],
        sugerencias: ["¿Qué es lo que más vendo?", "¿Cuánto gané?"],
      };
    }
    case "ganancia": {
      if (!conReportes) return { texto: "Solo el dueño o un administrador pueden ver las ganancias." };
      const { rows } = await q.query<{ r: any }>("select app.reporte_periodo($1, $2) as r", [i.periodo.desde, i.periodo.hasta]);
      const r = rows[0]!.r;
      const utilidad = Number(r.base) - Number(r.costo);
      const ganancia = utilidad - Number(r.gastos);
      return {
        texto: `${i.periodo.nombre[0]!.toUpperCase() + i.periodo.nombre.slice(1)} tu ganancia estimada es ${dinero(ganancia)}.`,
        filas: [
          { etiqueta: "Ventas sin IVA", valor: dinero(r.base) }, { etiqueta: "Costo de lo vendido", valor: "− " + dinero(r.costo) },
          { etiqueta: "Gastos", valor: "− " + dinero(r.gastos) }, { etiqueta: "Ganancia", valor: dinero(ganancia) },
        ],
        sugerencias: Number(r.sin_costo) > 0 ? ["¿Qué se está acabando?"] : ["¿Cuánto gasté este mes?"],
        ...(Number(r.sin_costo) > 0 ? { texto: `${i.periodo.nombre[0]!.toUpperCase() + i.periodo.nombre.slice(1)} tu ganancia estimada es ${dinero(ganancia)}. Ojo: ${dinero(r.sin_costo)} de ventas son de productos sin costo, así que no se descuenta su costo.` } : {}),
      };
    }
    case "gastos": {
      if (soloHoy(i.periodo)) return { texto: "Solo el dueño o un administrador pueden ver los gastos de otros días." };
      const { rows } = await q.query<{ r: any }>("select app.reporte_periodo($1, $2) as r", [i.periodo.desde, i.periodo.hasta]);
      const r = rows[0]!.r;
      if (!Number(r.gastos)) return { texto: `No hay gastos registrados ${i.periodo.nombre}.`, sugerencias: ["Gasté 5 en taxi"] };
      return {
        texto: `${i.periodo.nombre[0]!.toUpperCase() + i.periodo.nombre.slice(1)} gastaste ${dinero(r.gastos)}.`,
        filas: (r.gastos_categorias as { categoria: string; total: number }[]).map((g) => ({ etiqueta: g.categoria, valor: dinero(g.total) })),
      };
    }
    case "mas_vendido": {
      if (soloHoy(i.periodo)) return { texto: "Solo el dueño o un administrador pueden ver otros días." };
      const { rows } = await q.query<{ r: any }>("select app.reporte_periodo($1, $2) as r", [i.periodo.desde, i.periodo.hasta]);
      const top = (rows[0]!.r.productos as { nombre: string; cantidad: number; total: number }[]).slice(0, 5);
      if (!top.length) return { texto: `No hay ventas ${i.periodo.nombre}.`, sugerencias: ["¿Qué es lo que más vendo este mes?"] };
      return {
        texto: `Lo que más vendiste ${i.periodo.nombre}: ${top[0]!.nombre}.`,
        filas: top.map((p) => ({ etiqueta: `${p.nombre} (${cant(p.cantidad)})`, valor: dinero(p.total) })),
      };
    }
    case "deudas": {
      const { rows } = await q.query<{ nombre: string; saldo: number; fecha_pago: string | null }>(
        `select s.nombre, s.saldo, c.fecha_pago from app.cliente_saldo s join app.cliente c on c.id = s.cliente_id
         where s.saldo > 0 order by s.saldo desc limit 8`);
      const { rows: t } = await q.query<{ total: number; n: number }>("select coalesce(sum(saldo), 0) as total, count(*)::int as n from app.cliente_saldo where saldo > 0");
      if (!rows.length) return { texto: "Nadie te debe. 🎉" };
      return {
        texto: `Te deben ${dinero(t[0]!.total)} entre ${t[0]!.n} ${Number(t[0]!.n) === 1 ? "cliente" : "clientes"}.`,
        filas: rows.map((c) => ({ etiqueta: c.nombre + (c.fecha_pago ? ` (paga ${c.fecha_pago.slice(8, 10)}/${c.fecha_pago.slice(5, 7)})` : ""), valor: dinero(c.saldo) })),
        accion: { tipo: "ir", ruta: "/clientes", texto: "Ver clientes que deben" },
      };
    }
    case "por_acabarse": {
      const { rows } = await q.query<{ nombre: string; stock: number; unidad: string }>(
        `select nombre, stock, unidad from app.producto where activo and maneja_stock and tipo in ('venta', 'insumo')
           and (stock <= 0 or (stock_minimo is not null and stock <= stock_minimo))
         order by stock <= 0 desc, stock limit 10`);
      if (!rows.length) return { texto: "No hay productos agotados ni por acabarse. Para que te avise, pon el stock mínimo en cada producto." };
      return {
        texto: `Hay ${rows.length === 10 ? "10 o más" : rows.length} ${rows.length === 1 ? "producto" : "productos"} por reponer.`,
        filas: rows.map((p) => ({ etiqueta: p.nombre, valor: Number(p.stock) <= 0 ? "Agotado" : `Quedan ${cant(p.stock)}` })),
        accion: { tipo: "ir", ruta: "/inventario", texto: "Ver inventario" },
      };
    }
    case "caja": {
      const { rows } = await q.query<any>("select * from app.resumen_caja()");
      const c = rows[0];
      if (!c || c.estado !== "abierto") return { texto: "La caja está cerrada.", accion: { tipo: "ir", ruta: "/caja", texto: "Ir a la caja" } };
      return {
        texto: `En la caja debería haber ${dinero(c.efectivo_esperado)} en efectivo.`,
        filas: [
          { etiqueta: "Abriste con", valor: dinero(c.monto_apertura) }, { etiqueta: "Ventas en efectivo", valor: dinero(c.efectivo_ventas) },
          { etiqueta: "Retiros y gastos", valor: "− " + dinero(Number(c.retiros) + Number(c.gastos_efectivo)) },
        ],
        accion: { tipo: "ir", ruta: "/caja", texto: "Ir a la caja" },
      };
    }
    case "stock":
    case "precio": {
      const { elegido, opciones } = mejor(await productos(ctx), i.producto);
      if (!elegido) {
        return opciones.length
          ? { texto: `¿Cuál de estos?`, sugerencias: opciones.map((p) => (i.tipo === "stock" ? `¿Cuántos ${p.nombre} me quedan?` : `¿Cuánto cuesta ${p.nombre}?`)) }
          : { texto: `No encontré «${i.producto}» entre tus productos.` };
      }
      if (i.tipo === "precio") return { texto: elegido.precio === null ? `${elegido.nombre} todavía no tiene precio.` : `${elegido.nombre} cuesta ${dinero(elegido.precio)}.` };
      return { texto: elegido.maneja_stock ? `Te quedan ${cant(elegido.stock)} ${elegido.unidad.toLowerCase()} de ${elegido.nombre}.` : `${elegido.nombre} no lleva control de stock.` };
    }
    case "vender": {
      const metodo = i.metodo === "fiado" ? null : i.metodo ?? "efectivo";
      if (i.metodo === "fiado") return { texto: "Para vender fiado hay que elegir al cliente: hazlo desde Vender.", accion: { tipo: "ir", ruta: "/", texto: "Ir a vender" } };
      if (i.monto) {
        return {
          texto: `¿Registro una venta libre de ${dinero(i.monto)} en ${METODO[metodo!]}?`,
          accion: { tipo: "venta_libre", monto: i.monto, metodo, texto: `Registrar venta de ${dinero(i.monto)}` },
        };
      }
      const lista = await productos(ctx);
      const lineas: { producto_id: string; nombre: string; cantidad: number; precio: number }[] = [];
      const dudas: string[] = [];
      for (const it of i.items) {
        const { elegido, opciones } = mejor(lista, it.producto);
        if (!elegido) { dudas.push(opciones.length ? `«${it.producto}» (¿${opciones.slice(0, 3).map((o) => o.nombre).join(", ")}?)` : `«${it.producto}»`); continue; }
        if (elegido.precio === null) { dudas.push(`${elegido.nombre} (no tiene precio)`); continue; }
        lineas.push({ producto_id: elegido.id, nombre: elegido.nombre, cantidad: it.cantidad, precio: Number(elegido.precio) });
      }
      if (!lineas.length) return { texto: `No encontré ${dudas.join(" ni ")} entre tus productos. Escribe el nombre como está en Productos.` };
      const total = Math.round(lineas.reduce((s, l) => s + Math.round(l.cantidad * l.precio * 100) / 100, 0) * 100) / 100;
      return {
        texto: `¿Registro esta venta en ${METODO[metodo!]}?` + (dudas.length ? ` (No encontré ${dudas.join(", ")}.)` : ""),
        filas: lineas.map((l) => ({ etiqueta: `${cant(l.cantidad)} × ${l.nombre}`, valor: dinero(l.cantidad * l.precio) })).concat([{ etiqueta: "Total", valor: dinero(total) }]),
        accion: { tipo: "venta", items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })), metodo, total, texto: `Registrar venta de ${dinero(total)}` },
      };
    }
    case "gasto": {
      if (ctx.rol === "bodeguero" && !puede(ctx, "gastos")) return { texto: "No tienes permiso para registrar gastos." };
      const metodo = i.metodo ?? "efectivo";
      return {
        texto: `¿Registro un gasto de ${dinero(i.monto)} en «${i.categoria}»${i.descripcion ? ` (${i.descripcion})` : ""}, pagado en ${metodo}?`,
        accion: { tipo: "gasto", monto: i.monto, categoria: i.categoria, descripcion: i.descripcion, metodo, texto: `Registrar gasto de ${dinero(i.monto)}` },
      };
    }
  }
}

export function rutasAsistente(r: Router) {
  r.negocio("POST", "/asistente", async (p, ctx) => {
    const mensaje = texto(objeto(p.cuerpo).mensaje, "El mensaje", { max: 300 });
    return { respuesta: await responder(ctx, entender(mensaje)) };
  });
}
