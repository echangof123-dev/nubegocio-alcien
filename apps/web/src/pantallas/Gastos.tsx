import { useCallback, useEffect, useMemo, useState } from "react";
import { api, archivo, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, fecha } from "../formato";
import { Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";
import { NuevoGasto } from "../componentes/movimientos";
import { diaLocal } from "../componentes/servicios";

interface Gasto { id: string; fecha: string; categoria: string; descripcion: string | null; monto: number; metodo: string; estado: "vigente" | "anulado"; proveedor: string | null; registrado_por: string | null }
const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro" };

function mesRango(desplazar: number): [string, string, string] {
  const hoy = new Date(diaLocal() + "T12:00:00");
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() + desplazar, 1, 12);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + desplazar + 1, 0, 12);
  const hasta = desplazar === 0 ? diaLocal() : diaLocal(fin);
  return [diaLocal(ini), hasta, ini.toLocaleDateString("es-EC", { month: "long", year: "numeric" })];
}

/** Gastos del negocio por mes y por categoría, con anulación y descarga para Excel. */
export function Gastos({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [mes, setMes] = useState(0);
  const [desde, hasta, nombreMes] = mesRango(mes);
  const [gastos, setGastos] = useState<Gasto[] | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [anular, setAnular] = useState<Gasto | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<{ gastos: Gasto[] }>("GET", `/gastos?desde=${desde}&hasta=${hasta}`).then((r) => setGastos(r.gastos)).catch(() => setGastos([]));
  }, [desde, hasta]);
  useEffect(cargar, [cargar]);

  const vigentes = (gastos ?? []).filter((g) => g.estado === "vigente");
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of vigentes) m.set(g.categoria, (m.get(g.categoria) ?? 0) + Number(g.monto));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gastos]);   // eslint-disable-line react-hooks/exhaustive-deps
  const total = vigentes.reduce((s, g) => s + Number(g.monto), 0);
  const visibles = (gastos ?? []).filter((g) => !categoria || g.categoria === categoria);

  async function confirmarAnular() {
    try { await api("POST", `/gastos/${anular!.id}/anular`, {}); avisar("Gasto anulado"); setAnular(null); cargar(); }
    catch (e) { avisar(mensajeDe(e)); setAnular(null); }
  }

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Gastos</h1>
      <button className="boton bloque" onClick={() => setNuevo(true)}><IMas tam={20} /> Nuevo gasto</button>
      <div className="fila">
        <button className="boton secundario pequeno" onClick={() => setMes(mes - 1)} aria-label="Mes anterior">‹</button>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes}</strong>
        <button className="boton secundario pequeno" disabled={mes === 0} onClick={() => setMes(mes + 1)} aria-label="Mes siguiente">›</button>
      </div>
      {!gastos ? <Cargando /> : (
        <>
          <div className="tarjeta" style={{ gap: 2 }}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Gastaste</span>
            <span className="monto-grande">{dinero(total)}</span>
            <span className="muted" style={{ fontSize: 13 }}>{vigentes.length} {vigentes.length === 1 ? "gasto" : "gastos"}</span>
          </div>
          {porCategoria.length > 0 && (
            <div className="chips" role="group" aria-label="Categoría">
              <button className={`chip${categoria === null ? " activo" : ""}`} onClick={() => setCategoria(null)}>Todas</button>
              {porCategoria.map(([c, v]) => (
                <button key={c} className={`chip${categoria === c ? " activo" : ""}`} onClick={() => setCategoria(c)}>{c} · {dinero(v)}</button>
              ))}
            </div>
          )}
          <div className="tarjeta" style={{ padding: "4px 16px" }}>
            {visibles.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>No hay gastos este mes.</p>}
            {visibles.map((g) => (
              <div key={g.id} className="movimiento" style={{ opacity: g.estado === "anulado" ? 0.55 : 1 }}>
                <div className="textos">
                  <strong className={g.estado === "anulado" ? "anulada" : ""}>{g.categoria}</strong>
                  <span>{fecha(g.fecha + "T12:00:00")} · {METODO[g.metodo] ?? g.metodo}{g.descripcion ? ` · ${g.descripcion}` : ""}{g.proveedor ? ` · ${g.proveedor}` : ""}</span>
                  {g.estado === "anulado" && <span>Anulado</span>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong className="negativo">− {dinero(g.monto)}</strong>
                  {gestiona && g.estado === "vigente" && <div><button className="boton texto pequeno" onClick={() => setAnular(g)}>Anular</button></div>}
                </div>
              </div>
            ))}
          </div>
          {gestiona && (
            <button className="boton secundario" onClick={() => archivo(`/reportes/gastos.csv?desde=${desde}&hasta=${hasta}`, { descargar: `gastos-${desde}-a-${hasta}.csv` }).catch((e) => avisar(mensajeDe(e)))}>
              Descargar gastos para Excel
            </button>
          )}
        </>
      )}
      {nuevo && <NuevoGasto alCerrar={() => setNuevo(false)} alGuardar={() => { setNuevo(false); avisar("Gasto registrado"); setMes(0); cargar(); }} />}
      {anular && (
        <Dialogo titulo="Anular gasto" alCerrar={() => setAnular(null)}>
          <p>¿Anular el gasto de <strong>{dinero(anular.monto)}</strong> en {anular.categoria.toLowerCase()}?</p>
          <button className="boton peligro bloque" onClick={confirmarAnular}>Anular gasto</button>
        </Dialogo>
      )}
    </div>
  );
}
