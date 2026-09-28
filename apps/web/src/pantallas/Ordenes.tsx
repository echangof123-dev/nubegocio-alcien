import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio, Producto } from "../tipos";
import { cantidad as fmtCantidad, dinero, fecha, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IBuscar, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { DialogoCobro } from "../componentes/DialogoCobro";
import { DatosCliente, enlaceWa, useProfesionales } from "../componentes/servicios";

type Estado = "recibida" | "diagnostico" | "esperando_repuesto" | "en_reparacion" | "lista" | "entregada" | "cancelada";
interface Orden {
  id: string; numero: number; nombre: string; celular: string | null; equipo: string; identificador: string | null; problema: string;
  estado: Estado; fecha_prometida: string | null; creado_en: string; venta_id: string | null; tecnico: string | null; total: number;
}
interface Detalle {
  orden: Orden & { diagnostico: string | null; token_publico: string };
  items: { id: number; nombre: string; tipo: "repuesto" | "mano_obra"; cantidad: number; precio: number; total: number }[];
  historial: { estado: Estado; nota: string | null; creado_en: string }[];
}
export const ESTADOS_ORDEN: Record<Estado, [string, string]> = {
  recibida: ["Recibida", "gris"], diagnostico: ["En diagnóstico", "no"], esperando_repuesto: ["Esperando repuesto", "no"],
  en_reparacion: ["En reparación", "no"], lista: ["Lista", "ok"], entregada: ["Entregada", "ok"], cancelada: ["Cancelada", "gris"],
};
const FLUJO: Estado[] = ["recibida", "diagnostico", "esperando_repuesto", "en_reparacion", "lista"];

/** Órdenes de trabajo: recepción del equipo, diagnóstico, repuestos, mano de obra y entrega. */
export function Ordenes({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [vista, setVista] = useState<"abiertas" | "todas">("abiertas");
  const [q, setQ] = useState("");
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(() => {
    const est = vista === "abiertas" ? "&estado=abiertas" : "";
    api<{ ordenes: Orden[] }>("GET", `/ordenes?q=${encodeURIComponent(q)}${est}`).then((r) => setOrdenes(r.ordenes)).catch(() => setOrdenes([]));
  }, [vista, q]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Órdenes de trabajo</h1>
      <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Recibir equipo</button>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={vista === "abiertas"} className={`chip${vista === "abiertas" ? " activo" : ""}`} onClick={() => setVista("abiertas")}>En el taller</button>
        <button role="tab" aria-selected={vista === "todas"} className={`chip${vista === "todas" ? " activo" : ""}`} onClick={() => setVista("todas")}>Todas</button>
      </div>
      <div className="con-icono">
        <IBuscar tam={20} />
        <label htmlFor="buscar-orden" className="oculto">Buscar orden</label>
        <input id="buscar-orden" className="entrada" placeholder="Número, cliente, equipo o placa" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!ordenes ? <Cargando /> : ordenes.length === 0 ? <div className="vacio"><p>{q ? "No hay órdenes con esa búsqueda." : "No hay equipos en el taller."}</p></div>
        : ordenes.map((o) => (
          <button key={o.id} className="tarjeta" style={{ gap: 6, textAlign: "left" }} onClick={() => setAbierta(o.id)}>
            <div className="fila"><strong>N.º {o.numero} · {o.equipo}</strong><span className={`insignia ${ESTADOS_ORDEN[o.estado][1]}`}>{ESTADOS_ORDEN[o.estado][0]}</span></div>
            <span className="muted" style={{ fontSize: 14 }}>{o.nombre}{o.identificador ? ` · ${o.identificador}` : ""}{o.tecnico ? ` · ${o.tecnico}` : ""}</span>
            <div className="fila"><span className="muted" style={{ fontSize: 13 }}>{fecha(o.creado_en)}{o.fecha_prometida ? ` · entrega ${fecha(o.fecha_prometida + "T12:00:00")}` : ""}</span>
              <strong>{dinero(o.total)}{o.venta_id ? " ✓" : ""}</strong></div>
          </button>
        ))}
      {nueva && <NuevaOrden alCerrar={() => setNueva(false)} alGuardar={(id, n) => { setNueva(false); avisar(`Orden N.º ${n} creada`); cargar(); setAbierta(id); }} />}
      {abierta && <DetalleOrden id={abierta} info={info} avisar={avisar} alCerrar={() => { setAbierta(null); cargar(); }} />}
    </div>
  );
}

function NuevaOrden({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (id: string, numero: number) => void }) {
  const tecnicos = useProfesionales();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [equipo, setEquipo] = useState("");
  const [identificador, setIdentificador] = useState("");
  const [problema, setProblema] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [entrega, setEntrega] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ orden: { id: string; numero: number } }>("POST", "/ordenes", {
        cliente_id: cliente?.id, nombre: nombre || undefined, celular: celular || undefined, equipo, identificador: identificador || undefined,
        problema, tecnico_id: tecnico || undefined, fecha_prometida: entrega || undefined,
      });
      alGuardar(r.orden.id, r.orden.numero);
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Recibir equipo" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <DatosCliente id="or" cliente={cliente} setCliente={setCliente} nombre={nombre} setNombre={setNombre} celular={celular} setCelular={setCelular} />
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="or-eq">Equipo o vehículo</label>
            <input id="or-eq" className="entrada" maxLength={120} placeholder="Moto Honda CB190" value={equipo} onChange={(e) => setEquipo(e.target.value)} /></div>
          <div className="campo"><label htmlFor="or-id">Placa, serie o IMEI</label>
            <input id="or-id" className="entrada" maxLength={60} value={identificador} onChange={(e) => setIdentificador(e.target.value)} /></div>
        </div>
        <div className="campo"><label htmlFor="or-pr">¿Qué problema tiene?</label>
          <textarea id="or-pr" className="entrada" rows={3} maxLength={500} value={problema} onChange={(e) => setProblema(e.target.value)} /></div>
        <div className="rejilla-2">
          {tecnicos.length > 0 && (
            <div className="campo"><label htmlFor="or-tec">Técnico</label>
              <select id="or-tec" className="entrada" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
                <option value="">Sin asignar</option>{tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select></div>
          )}
          <div className="campo"><label htmlFor="or-ent">Entrega estimada</label>
            <input id="or-ent" className="entrada" type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!equipo.trim() || !problema.trim() || (!cliente && nombre.trim().length < 2)}>Crear orden</button>
      </form>
    </Dialogo>
  );
}

function DetalleOrden({ id, info, avisar, alCerrar }: { id: string; info: InfoNegocio; avisar: (t: string) => void; alCerrar: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [agregar, setAgregar] = useState<"repuesto" | "mano_obra" | null>(null);
  const [linea, setLinea] = useState<{ producto: Producto; tipo: "repuesto" | "mano_obra"; cantidad: string; precio: string } | null>(null);
  const [diagnostico, setDiagnostico] = useState("");
  const [cobrar, setCobrar] = useState(false);
  const cargar = useCallback(() => {
    api<Detalle>("GET", `/ordenes/${id}`).then((r) => { setD(r); setDiagnostico(r.orden.diagnostico ?? ""); }).catch((e) => avisar(mensajeDe(e)));
  }, [id, avisar]);
  useEffect(cargar, [cargar]);

  async function estado(e: Estado) {
    try {
      await api("POST", `/ordenes/${id}/estado`, { estado: e, diagnostico: diagnostico !== (d?.orden.diagnostico ?? "") ? diagnostico : undefined });
      cargar();
    } catch (err) { avisar(mensajeDe(err)); }
  }
  async function guardarLinea(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", `/ordenes/${id}/items`, { items: [{ producto_id: linea!.producto.id, tipo: linea!.tipo,
        cantidad: parsearNumero(linea!.cantidad) ?? 1, precio: parsearNumero(linea!.precio) ?? undefined }] });
      setLinea(null);
      cargar();
    } catch (err) { avisar(mensajeDe(err)); }
  }
  async function quitar(item: number) {
    try { await api("DELETE", `/ordenes/${id}/items/${item}`); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  if (!d) return <Dialogo titulo="Orden" alCerrar={alCerrar}><Cargando /></Dialogo>;
  const o = d.orden;
  const total = d.items.reduce((s, i) => s + Number(i.total), 0);
  const editable = !o.venta_id && o.estado !== "entregada" && o.estado !== "cancelada";
  const enlace = `${location.origin}/api/o/${o.token_publico}`;
  const wa = enlaceWa(o.celular, o.estado === "lista"
    ? `Hola ${o.nombre}, tu ${o.equipo} ya está listo en ${info.negocio.nombre}. Total: ${dinero(total)}. Detalle: ${enlace}`
    : `Hola ${o.nombre}, puedes ver el estado de tu ${o.equipo} (orden N.º ${o.numero}) aquí: ${enlace}`);
  const siguiente = FLUJO[FLUJO.indexOf(o.estado) + 1];

  if (cobrar) {
    return (
      <DialogoCobro info={info} titulo={`Cobrar orden N.º ${o.numero}`} total={total} alCerrar={() => setCobrar(false)}
        cobrar={async (c) => {
          const r = await api<{ venta: { numero: number } }>("POST", `/ordenes/${id}/cobrar`, { pagos: c.pagos, comprobante: c.comprobante });
          setCobrar(false);
          avisar(`Venta N.º ${r.venta.numero} registrada`);
          cargar();
        }} />
    );
  }

  return (
    <Dialogo titulo={`Orden N.º ${o.numero}`} alCerrar={alCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="fila"><strong>{o.equipo}</strong><span className={`insignia ${ESTADOS_ORDEN[o.estado][1]}`}>{ESTADOS_ORDEN[o.estado][0]}</span></div>
        <span className="muted" style={{ fontSize: 14 }}>{o.nombre}{o.celular ? ` · ${o.celular}` : ""}{o.identificador ? ` · ${o.identificador}` : ""}</span>
        <p style={{ margin: 0 }}>{o.problema}</p>
        {editable ? (
          <div className="campo"><label htmlFor="od-diag">Diagnóstico</label>
            <textarea id="od-diag" className="entrada" rows={2} maxLength={1000} value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} /></div>
        ) : o.diagnostico && <p style={{ margin: 0 }}><strong>Diagnóstico:</strong> {o.diagnostico}</p>}

        <span className="etiqueta">Repuestos y mano de obra</span>
        {d.items.map((i) => (
          <div key={i.id} className="linea-carrito">
            <div className="info"><strong>{Number(i.cantidad) !== 1 ? `${fmtCantidad(i.cantidad)} × ` : ""}{i.nombre}</strong>
              <span>{i.tipo === "mano_obra" ? "Mano de obra" : "Repuesto"} · {dinero(i.total)}</span></div>
            {editable && <button className="boton texto" aria-label={`Quitar ${i.nombre}`} onClick={() => quitar(i.id)}><IBasura tam={18} /></button>}
          </div>
        ))}
        {editable && (
          <div className="acciones-fila">
            <button className="boton pequeno secundario" onClick={() => setAgregar("repuesto")}><IMas tam={16} /> Repuesto</button>
            <button className="boton pequeno secundario" onClick={() => setAgregar("mano_obra")}><IMas tam={16} /> Mano de obra</button>
          </div>
        )}
        <div className="fila"><span>Total</span><strong>{dinero(total)}</strong></div>

        {editable && (
          <div className="acciones-fila">
            {siguiente && <button className="boton pequeno" onClick={() => estado(siguiente)}>{ESTADOS_ORDEN[siguiente][0]}</button>}
            {total > 0 && <button className="boton pequeno" onClick={() => setCobrar(true)}>Cobrar</button>}
            {total === 0 && <button className="boton pequeno secundario" onClick={() => estado("entregada")}>Entregar sin cobro</button>}
            <button className="boton texto pequeno" onClick={() => estado("cancelada")}>Cancelar orden</button>
          </div>
        )}
        {o.venta_id && o.estado !== "entregada" && <button className="boton bloque" onClick={() => estado("entregada")}>Entregar al cliente</button>}
        {wa && <a className="boton secundario bloque" href={wa} target="_blank" rel="noopener">{o.estado === "lista" ? "Avisar que está lista" : "Enviar seguimiento por WhatsApp"}</a>}

        <span className="etiqueta">Historial</span>
        {d.historial.map((h, i) => (
          <span key={i} className="muted" style={{ fontSize: 13 }}>{fecha(h.creado_en)} · {ESTADOS_ORDEN[h.estado][0]}{h.nota ? ` — ${h.nota}` : ""}</span>
        ))}
      </div>
      {agregar && <SelectorProducto filtro="todos" titulo={agregar === "repuesto" ? "Elegir repuesto" : "Elegir mano de obra"} alCerrar={() => setAgregar(null)}
        alElegir={(p) => { setLinea({ producto: p, tipo: agregar, cantidad: "1", precio: p.precio != null ? String(p.precio).replace(".", ",") : "" }); setAgregar(null); }} />}
      {linea && (
        <Dialogo titulo={linea.producto.nombre} alCerrar={() => setLinea(null)}>
          <form onSubmit={guardarLinea} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="rejilla-2">
              <CampoMonto id="ol-c" etiqueta="Cantidad" valor={linea.cantidad} alCambiar={(v) => setLinea({ ...linea, cantidad: v })} />
              <CampoMonto id="ol-p" etiqueta="Precio" valor={linea.precio} alCambiar={(v) => setLinea({ ...linea, precio: v })} />
            </div>
            <button className="boton bloque" disabled={!linea.precio}>Agregar</button>
          </form>
        </Dialogo>
      )}
    </Dialogo>
  );
}
