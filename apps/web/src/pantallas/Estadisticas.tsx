import { useEffect, useMemo, useState } from "react";
import { api, archivo, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puede } from "../tipos";
import { cantidad as fmtCantidad, dinero, redondear } from "../formato";
import { Aviso, Cargando } from "../componentes/basicos";
import { diaLocal, sumarDias } from "../componentes/servicios";

interface Reporte {
  desde: string; hasta: string; ventas: number; total: number; base: number; iva: number; descuentos: number; costo: number; sin_costo: number;
  ticket_promedio: number; anuladas: number; total_anterior: number; compras: number; gastos: number; fiado_por_cobrar: number;
  por_dia: { dia: string; total: number; ventas: number }[];
  por_hora: { hora: number; total: number }[];
  por_metodo: { metodo: string; total: number }[];
  productos: { nombre: string; cantidad: number; total: number; utilidad: number | null }[];
  categorias: { categoria: string; total: number }[];
  vendedores: { vendedor: string; ventas: number; total: number }[];
  gastos_categorias: { categoria: string; total: number }[];
}
type Periodo = "hoy" | "7" | "mes" | "anterior" | "30";
const METODOS: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado" };

function rango(p: Periodo): [string, string] {
  const hoy = diaLocal();
  const d = new Date(hoy + "T12:00:00");
  if (p === "hoy") return [hoy, hoy];
  if (p === "7") return [sumarDias(hoy, -6), hoy];
  if (p === "30") return [sumarDias(hoy, -29), hoy];
  if (p === "mes") return [diaLocal(new Date(d.getFullYear(), d.getMonth(), 1, 12)), hoy];
  const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
  const fin = new Date(d.getFullYear(), d.getMonth(), 0, 12);
  return [diaLocal(ini), diaLocal(fin)];
}
const corto = (dia: string) => new Date(dia + "T12:00:00").toLocaleDateString("es-EC", { day: "numeric", month: "short" });

/** Reportes por periodo: ventas, utilidad, gastos, qué se vende, cómo pagan y quién vende. */
export function Estadisticas({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [propio, setPropio] = useState<[string, string] | null>(null);
  const [rep, setRep] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desde, hasta] = propio ?? rango(periodo);

  useEffect(() => {
    if (!puede(info, "reportes")) return;
    setRep(null);
    api<{ reporte: Reporte }>("GET", `/reportes?desde=${desde}&hasta=${hasta}`)
      .then((r) => { setRep(r.reporte); setError(null); }).catch((e) => setError(mensajeDe(e)));
  }, [desde, hasta, info]);

  if (!puede(info, "reportes")) {
    return <div className="contenido"><Aviso tipo="info" titulo="Solo para el dueño o un administrador">Tus ventas del día están en Reportes.</Aviso></div>;
  }

  const n = (x: unknown) => Number(x ?? 0);
  const utilidad = rep ? redondear(n(rep.base) - n(rep.costo)) : 0;
  const ganancia = rep ? redondear(utilidad - n(rep.gastos)) : 0;
  const cambio = rep && n(rep.total_anterior) > 0 ? Math.round(((n(rep.total) - n(rep.total_anterior)) / n(rep.total_anterior)) * 100) : null;

  return (
    <div className="contenido" style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
      <h1>Reportes por periodo</h1>
      <div className="chips" role="group" aria-label="Periodo">
        {([["hoy", "Hoy"], ["7", "7 días"], ["mes", "Este mes"], ["anterior", "Mes pasado"], ["30", "30 días"]] as const).map(([p, t]) => (
          <button key={p} className={`chip${!propio && periodo === p ? " activo" : ""}`} aria-pressed={!propio && periodo === p}
            onClick={() => { setPropio(null); setPeriodo(p); }}>{t}</button>
        ))}
      </div>
      <div className="rejilla-2">
        <div className="campo"><label htmlFor="es-desde">Desde</label>
          <input id="es-desde" className="entrada" type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setPropio([e.target.value, hasta])} /></div>
        <div className="campo"><label htmlFor="es-hasta">Hasta</label>
          <input id="es-hasta" className="entrada" type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setPropio([desde, e.target.value])} /></div>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!rep ? (!error && <Cargando />) : (
        <>
          <div className="rejilla-cifras">
            <Cifra titulo="Vendiste" valor={dinero(rep.total)}
              nota={cambio === null ? `${rep.ventas} ${Number(rep.ventas) === 1 ? "venta" : "ventas"}` : `${rep.ventas} ${Number(rep.ventas) === 1 ? "venta" : "ventas"} · ${cambio >= 0 ? "▲" : "▼"} ${Math.abs(cambio)} % vs. periodo anterior`} />
            <Cifra titulo="Utilidad bruta" valor={dinero(utilidad)} nota={n(rep.sin_costo) > 0 ? `Sin contar ${dinero(rep.sin_costo)} de productos sin costo` : "Ventas sin IVA menos costo"} />
            <Cifra titulo="Gastos" valor={dinero(rep.gastos)} nota={`Ganancia estimada ${dinero(ganancia)}`} />
            <Cifra titulo="Venta promedio" valor={dinero(rep.ticket_promedio)} nota={rep.anuladas ? `${rep.anuladas} anuladas` : "Sin anulaciones"} />
          </div>

          {rep.por_dia.length > 1 && <GraficoDias dias={rep.por_dia} />}

          <div className="rejilla-2" style={{ alignItems: "start" }}>
            <Ranking titulo="Lo que más vendes" filas={rep.productos.map((p) => ({ nombre: p.nombre, valor: n(p.total), nota: `${fmtCantidad(n(p.cantidad))} · utilidad ${p.utilidad === null ? "—" : dinero(p.utilidad)}` }))} />
            <Ranking titulo="Cómo te pagan" filas={rep.por_metodo.map((m) => ({ nombre: METODOS[m.metodo] ?? m.metodo, valor: n(m.total) }))} />
            {rep.categorias.length > 1 && <Ranking titulo="Por categoría" filas={rep.categorias.map((c) => ({ nombre: c.categoria, valor: n(c.total) }))} />}
            {rep.vendedores.length > 0 && <Ranking titulo="Por vendedor" filas={rep.vendedores.map((v) => ({ nombre: v.vendedor, valor: n(v.total), nota: `${v.ventas} ${Number(v.ventas) === 1 ? "venta" : "ventas"}` }))} />}
            {rep.gastos_categorias.length > 0 && <Ranking titulo="Gastos" filas={rep.gastos_categorias.map((g) => ({ nombre: g.categoria, valor: n(g.total) }))} />}
          </div>

          <div className="tarjeta" style={{ gap: 6 }}>
            <h3>Resumen</h3>
            {([["Ventas sin IVA", rep.base], ["IVA cobrado", rep.iva], ["Descuentos dados", rep.descuentos], ["Costo de lo vendido", rep.costo],
               ["Compras del periodo", rep.compras], ["Gastos", rep.gastos], ["Te deben hoy (fiado)", rep.fiado_por_cobrar]] as const).map(([t, v]) => (
              <div key={t} className="fila"><span className="muted">{t}</span><span>{dinero(n(v))}</span></div>
            ))}
          </div>
          <button className="boton secundario" onClick={() => archivo(`/reportes/ventas.csv?desde=${desde}&hasta=${hasta}`, { descargar: `ventas-${desde}-a-${hasta}.csv` }).catch((e) => avisar(mensajeDe(e)))}>
            Descargar ventas para Excel
          </button>
        </>
      )}
    </div>
  );
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="tarjeta" style={{ gap: 2 }}>
      <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{titulo}</span>
      <span className="monto-grande">{valor}</span>
      <span className="muted" style={{ fontSize: 12 }}>{nota}</span>
    </div>
  );
}

/** Ventas por día: barras de una sola serie, valor al tocar o pasar el mouse, y tabla para lectores de pantalla. */
function GraficoDias({ dias }: { dias: Reporte["por_dia"] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = useMemo(() => Math.max(...dias.map((d) => Number(d.total)), 1), [dias]);
  const cada = Math.ceil(dias.length / 7);
  const sel = activo !== null ? dias[activo] : null;
  return (
    <div className="tarjeta" style={{ gap: 8 }}>
      <div className="fila">
        <h3>Ventas por día</h3>
        <span className="muted" style={{ fontSize: 13 }}>{sel ? `${corto(sel.dia)}: ${dinero(Number(sel.total))} · ${sel.ventas} ventas` : `Máximo ${dinero(max)}`}</span>
      </div>
      <div className="grafico-dias" aria-hidden="true" onMouseLeave={() => setActivo(null)}>
        {dias.map((d, i) => (
          <button key={d.dia} tabIndex={-1} className={`columna${activo === i ? " activa" : ""}`}
            onMouseEnter={() => setActivo(i)} onClick={() => setActivo(activo === i ? null : i)}>
            <span className="barra" style={{ height: `${Math.max((Number(d.total) / max) * 100, Number(d.total) > 0 ? 2 : 0)}%` }} />
          </button>
        ))}
      </div>
      <div className="grafico-ejes" aria-hidden="true">
        {dias.map((d, i) => <span key={d.dia}>{i % cada === 0 ? corto(d.dia) : ""}</span>)}
      </div>
      <table className="oculto">
        <caption>Ventas por día</caption>
        <thead><tr><th>Día</th><th>Total</th><th>Ventas</th></tr></thead>
        <tbody>{dias.map((d) => <tr key={d.dia}><td>{corto(d.dia)}</td><td>{dinero(Number(d.total))}</td><td>{d.ventas}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Ranking({ titulo, filas }: { titulo: string; filas: { nombre: string; valor: number; nota?: string }[] }) {
  const max = Math.max(...filas.map((f) => f.valor), 1);
  return (
    <div className="tarjeta" style={{ gap: 10 }}>
      <h3>{titulo}</h3>
      {filas.length === 0 && <p className="muted">Sin datos en este periodo.</p>}
      {filas.map((f) => (
        <div key={f.nombre} className="ranking">
          <div className="fila"><span>{f.nombre}</span><strong>{dinero(f.valor)}</strong></div>
          <div className="pista"><span style={{ width: `${(f.valor / max) * 100}%` }} /></div>
          {f.nota && <span className="muted" style={{ fontSize: 12 }}>{f.nota}</span>}
        </div>
      ))}
    </div>
  );
}
