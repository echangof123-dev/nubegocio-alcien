import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero } from "../formato";
import { Aviso, Cargando } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";
import { NuevoGasto, VentaLibre } from "../componentes/movimientos";
import { imprimirRecibo, whatsappRecibo } from "../componentes/recibo";
import { diaLocal, horaCorta, sumarDias } from "../componentes/servicios";

interface Movimiento {
  tipo: "venta" | "abono" | "gasto" | "compra" | "anticipo"; id: string; fecha: string; concepto: string; detalle: string;
  monto: number; fiado: number; metodo: string | null; token: string | null; numero: number | null;
}
interface BalanceDatos { ingresos: number; egresos: number; fiado: number; ventas: number; movimientos: Movimiento[] }
type Periodo = "hoy" | "ayer" | "semana" | "mes";
const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado", otro: "Otro", anticipo: "Anticipo" };
const metodos = (m: string | null) => (m ?? "").split("+").filter(Boolean).map((x) => METODO[x] ?? x).join(" + ");

function rango(p: Periodo): [string, string] {
  const hoy = diaLocal();
  if (p === "hoy") return [hoy, hoy];
  if (p === "ayer") return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
  if (p === "semana") return [sumarDias(hoy, -6), hoy];
  const d = new Date(hoy + "T12:00:00");
  return [diaLocal(new Date(d.getFullYear(), d.getMonth(), 1, 12)), hoy];
}
const diaCorto = (iso: string) => new Date(iso).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" });

/** Balance: lo que entró y lo que salió, como la pantalla principal de Treinta. */
export function Balance({ info, avisar, navegar }: { info: InfoNegocio; avisar: (t: string) => void; navegar: (r: string) => void }) {
  const gestiona = puedeGestionar(info.rol);
  const [periodo, setPeriodo] = useState<Periodo>("hoy");
  const [vista, setVista] = useState<"ingresos" | "egresos">("ingresos");
  const [datos, setDatos] = useState<BalanceDatos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gasto, setGasto] = useState(false);
  const [libre, setLibre] = useState(false);
  const [desde, hasta] = rango(periodo);

  const cargar = useCallback(() => {
    api<{ balance: BalanceDatos }>("GET", `/balance?desde=${desde}&hasta=${hasta}`)
      .then((r) => { setDatos(r.balance); setError(null); }).catch((e) => setError(mensajeDe(e)));
  }, [desde, hasta]);
  useEffect(cargar, [cargar]);

  const n = (x: unknown) => Number(x ?? 0);
  const lista = (datos?.movimientos ?? []).filter((m) => (vista === "ingresos" ? n(m.monto) > 0 || n(m.fiado) > 0 : n(m.monto) < 0));
  const balance = datos ? n(datos.ingresos) - n(datos.egresos) : 0;
  let diaAnterior = "";

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Balance</h1>
      {gestiona && (
        <div className="chips" role="group" aria-label="Periodo">
          {([["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "7 días"], ["mes", "Este mes"]] as const).map(([p, t]) => (
            <button key={p} className={`chip${periodo === p ? " activo" : ""}`} aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>{t}</button>
          ))}
        </div>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos ? (!error && <Cargando />) : (
        <>
          <div className="tarjeta balance-resumen">
            <div className="fila"><span className="muted">Balance</span>
              <strong className={`monto-grande ${balance < 0 ? "negativo" : ""}`}>{balance < 0 ? "− " : ""}{dinero(Math.abs(balance))}</strong></div>
            <div className="rejilla-2">
              <div><span className="muted" style={{ fontSize: 13 }}>Ingresos</span><div className="positivo" style={{ fontWeight: 800, fontSize: 20 }}>{dinero(datos.ingresos)}</div></div>
              <div><span className="muted" style={{ fontSize: 13 }}>Egresos</span><div className="negativo" style={{ fontWeight: 800, fontSize: 20 }}>{dinero(datos.egresos)}</div></div>
            </div>
            {n(datos.fiado) > 0 && <span className="muted" style={{ fontSize: 13 }}>Además vendiste {dinero(datos.fiado)} fiado (entra al balance cuando te pagan).</span>}
          </div>

          <div className="rejilla-2">
            <button className="boton" onClick={() => navegar("/")}><IMas tam={20} /> Nueva venta</button>
            <button className="boton peligro" onClick={() => setGasto(true)}><IMas tam={20} /> Nuevo gasto</button>
          </div>
          <button className="boton texto" style={{ alignSelf: "center" }} onClick={() => setLibre(true)}>Venta libre (sin productos)</button>

          <div className="chips" role="tablist">
            <button role="tab" aria-selected={vista === "ingresos"} className={`chip${vista === "ingresos" ? " activo" : ""}`} onClick={() => setVista("ingresos")}>Ingresos</button>
            <button role="tab" aria-selected={vista === "egresos"} className={`chip${vista === "egresos" ? " activo" : ""}`} onClick={() => setVista("egresos")}>Egresos</button>
          </div>
          <div className="tarjeta" style={{ padding: "4px 16px" }}>
            {lista.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>{vista === "ingresos" ? "Todavía no hay ingresos en este periodo." : "No hay egresos en este periodo."}</p>}
            {lista.map((m) => {
              const dia = diaLocal(new Date(m.fecha));
              const cabecera = periodo !== "hoy" && periodo !== "ayer" && dia !== diaAnterior;
              diaAnterior = dia;
              return (
                <div key={m.tipo + m.id}>
                  {cabecera && <div className="etiqueta" style={{ paddingTop: 12, textTransform: "capitalize" }}>{diaCorto(m.fecha)}</div>}
                  <div className="movimiento">
                    <div className="textos">
                      <strong>{m.concepto}</strong>
                      <span>{horaCorta(m.fecha)}{m.metodo ? ` · ${metodos(m.metodo)}` : ""}{m.detalle ? ` · ${m.detalle}` : ""}</span>
                      {m.tipo === "venta" && m.token && (
                        <span className="acciones-mini">
                          <a href={whatsappRecibo(m.token, info.negocio.nombre, n(m.monto) + n(m.fiado))} target="_blank" rel="noopener">Enviar recibo</a>
                          <button type="button" onClick={() => imprimirRecibo(m.token!)}>Imprimir</button>
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong className={n(m.monto) < 0 ? "negativo" : "positivo"}>{n(m.monto) < 0 ? "− " : "+ "}{dinero(Math.abs(n(m.monto)))}</strong>
                      {n(m.fiado) > 0 && <div className="muted" style={{ fontSize: 12 }}>{dinero(m.fiado)} fiado</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="acciones-fila" style={{ justifyContent: "center" }}>
            <button className="boton texto" onClick={() => navegar("/reportes")}>Ventas del día y anulaciones</button>
            {gestiona && <button className="boton texto" onClick={() => navegar("/gastos")}>Todos los gastos</button>}
            {gestiona && <button className="boton texto" onClick={() => navegar("/estadisticas")}>Reportes por periodo</button>}
          </div>
        </>
      )}
      {gasto && <NuevoGasto alCerrar={() => setGasto(false)} alGuardar={() => { setGasto(false); avisar("Gasto registrado"); setVista("egresos"); cargar(); }} />}
      {libre && <VentaLibre info={info} alCerrar={() => setLibre(false)} alVender={() => { setVista("ingresos"); cargar(); }} />}
    </div>
  );
}
