/** Registrar un gasto o una venta libre desde cualquier pantalla (Balance, Gastos, Vender). */
import { useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Dialogo } from "./basicos";
import { DialogoCobro } from "./DialogoCobro";
import { AccionesRecibo } from "./recibo";
import { ICheckCirculo } from "./iconos";
import { diaLocal } from "./servicios";

/** Las mismas categorías que usa Treinta, para que el reporte de gastos se lea igual. */
export const CATEGORIAS_GASTO = [
  "Compra de productos e insumos", "Arriendo", "Servicios públicos", "Nómina", "Transporte y domicilios",
  "Mercadeo y publicidad", "Mantenimiento y reparaciones", "Muebles, equipos o maquinaria", "Gastos administrativos",
  "Impuestos", "Otros",
];
const METODOS: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro" };

export function NuevoGasto({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState(diaLocal());
  const [metodo, setMetodo] = useState("efectivo");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await api("POST", "/gastos", { monto: parsearNumero(monto), categoria, descripcion: descripcion || undefined, fecha, metodo });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); setOcupado(false); }
  }
  const esHoy = fecha === diaLocal();
  return (
    <Dialogo titulo="Nuevo gasto" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CampoMonto id="ng-monto" etiqueta="Valor del gasto" valor={monto} alCambiar={setMonto} grande />
        <span className="etiqueta">Categoría</span>
        <div className="chips-envolver" role="group" aria-label="Categoría">
          {CATEGORIAS_GASTO.map((c) => (
            <button type="button" key={c} className={`chip${categoria === c ? " activo" : ""}`} aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c}</button>
          ))}
        </div>
        <div className="campo"><label htmlFor="ng-desc">Descripción (opcional)</label>
          <input id="ng-desc" className="entrada" maxLength={200} placeholder="Ej.: luz de septiembre" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="ng-fecha">Fecha</label>
            <input id="ng-fecha" className="entrada" type="date" max={diaLocal()} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></div>
          <div className="campo"><label htmlFor="ng-met">Forma de pago</label>
            <select id="ng-met" className="entrada" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        {metodo === "efectivo" && esHoy && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Si la caja está abierta, sale del efectivo de la caja.</p>}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || !categoria || !(parsearNumero(monto) ?? 0)}>
          {ocupado ? "Guardando…" : `Registrar gasto${parsearNumero(monto) ? ` de ${dinero(parsearNumero(monto))}` : ""}`}
        </button>
      </form>
    </Dialogo>
  );
}

/** Venta libre: un monto y un concepto, sin elegir productos. */
export function VentaLibre({ info, alCerrar, alVender }: { info: InfoNegocio; alCerrar: () => void; alVender: () => void }) {
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [cobrar, setCobrar] = useState(false);
  const [hecha, setHecha] = useState<{ numero: number; total: number; vuelto: number; token: string; celular?: string | null } | null>(null);
  const total = parsearNumero(monto) ?? 0;

  if (hecha) {
    return (
      <Dialogo titulo="Venta registrada" alCerrar={() => { alVender(); alCerrar(); }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <span style={{ color: "var(--success)" }}><ICheckCirculo tam={48} /></span>
          <p className="muted" style={{ margin: 0 }}>Venta N.º {hecha.numero}{concepto ? ` · ${concepto}` : ""}</p>
          <p className="monto-grande" style={{ margin: 0 }}>{dinero(hecha.total)}</p>
          {hecha.vuelto > 0 && <div className="vuelto" style={{ width: "100%" }}><span>Vuelto</span><strong>{dinero(hecha.vuelto)}</strong></div>}
          <AccionesRecibo token={hecha.token} negocio={info.negocio.nombre} total={hecha.total} celular={hecha.celular} />
          <button className="boton bloque" onClick={() => { alVender(); alCerrar(); }}>Listo</button>
        </div>
      </Dialogo>
    );
  }
  if (cobrar) {
    return (
      <DialogoCobro info={info} titulo={concepto || "Venta libre"} total={total} alCerrar={() => setCobrar(false)}
        cobrar={async (d) => {
          const r = await api<{ venta: { numero: number; total: number; vuelto: number; token: string } }>("POST", "/ventas/libre", {
            monto: total, concepto: concepto || undefined, pagos: d.pagos, comprobante: d.comprobante, cliente_id: d.cliente_id });
          setHecha({ numero: r.venta.numero, total: Number(r.venta.total), vuelto: Number(r.venta.vuelto), token: r.venta.token });
        }} />
    );
  }
  return (
    <Dialogo titulo="Venta libre" alCerrar={alCerrar}>
      <form onSubmit={(e) => { e.preventDefault(); if (total > 0) setCobrar(true); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Cobra un valor sin elegir productos (no mueve el inventario).</p>
        <CampoMonto id="vl-monto" etiqueta="Valor de la venta" valor={monto} alCambiar={setMonto} grande />
        <div className="campo"><label htmlFor="vl-concepto">Concepto (opcional)</label>
          <input id="vl-concepto" className="entrada" maxLength={120} placeholder="Ej.: recarga, arreglo, servicio" value={concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        <button className="boton bloque" disabled={total <= 0}>Cobrar {dinero(total)}</button>
      </form>
    </Dialogo>
  );
}
