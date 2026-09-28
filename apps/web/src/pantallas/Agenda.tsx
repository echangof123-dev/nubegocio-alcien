import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio, Producto } from "../tipos";
import { dinero, redondear } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IMas, IVolver } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { DialogoCobro } from "../componentes/DialogoCobro";
import { aIso, DatosCliente, diaLocal, enlaceWa, horaCorta, nombreDia, sumarDias, useProfesionales } from "../componentes/servicios";

type Estado = "agendada" | "confirmada" | "atendida" | "no_vino" | "cancelada";
interface Cita {
  id: string; nombre: string; celular: string | null; inicio: string; fin: string; estado: Estado; nota: string | null;
  venta_id: string | null; cliente_id: string | null; profesional_id: string | null; profesional: string | null; color: string | null;
  servicio_id: string | null; servicio: string | null; servicio_precio: number | null;
}
const ESTADOS: Record<Estado, [string, string]> = {
  agendada: ["Agendada", "gris"], confirmada: ["Confirmada", "ok"], atendida: ["Atendida", "ok"], no_vino: ["No vino", "mal"], cancelada: ["Cancelada", "gris"],
};

/** Agenda del día por profesional: agendar, confirmar por WhatsApp y cobrar. */
export function Agenda({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [dia, setDia] = useState(diaLocal());
  const [citas, setCitas] = useState<Cita[] | null>(null);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [cobrar, setCobrar] = useState<Cita | null>(null);
  const profesionales = useProfesionales();

  const cargar = useCallback(() => {
    api<{ citas: Cita[] }>("GET", `/citas?desde=${dia}`).then((r) => setCitas(r.citas)).catch(() => setCitas([]));
  }, [dia]);
  useEffect(cargar, [cargar]);

  async function estado(c: Cita, e: Estado) {
    try { await api("PATCH", `/citas/${c.id}`, { estado: e }); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  const visibles = (citas ?? []).filter((c) => !filtro || c.profesional_id === filtro);
  const esHoy = dia === diaLocal();

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Agenda</h1>
      <div className="fila">
        <button className="boton secundario pequeno" aria-label="Día anterior" onClick={() => setDia(sumarDias(dia, -1))}><IVolver tam={18} /></button>
        <div style={{ textAlign: "center" }}>
          <strong style={{ textTransform: "capitalize" }}>{esHoy ? "Hoy" : nombreDia(dia)}</strong>
          {!esHoy && <button className="boton texto pequeno" onClick={() => setDia(diaLocal())}>Ir a hoy</button>}
        </div>
        <button className="boton secundario pequeno" aria-label="Día siguiente" onClick={() => setDia(sumarDias(dia, 1))}>
          <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><IVolver tam={18} /></span>
        </button>
      </div>
      {profesionales.length > 1 && (
        <div className="chips" role="group" aria-label="Profesional">
          <button className={`chip${filtro === null ? " activo" : ""}`} onClick={() => setFiltro(null)}>Todos</button>
          {profesionales.map((p) => (
            <button key={p.id} className={`chip${filtro === p.id ? " activo" : ""}`} onClick={() => setFiltro(p.id)}>{p.nombre}</button>
          ))}
        </div>
      )}
      <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Agendar cita</button>
      {!citas ? <Cargando /> : visibles.length === 0 ? (
        <div className="vacio"><p>No hay citas {esHoy ? "hoy" : "este día"}.</p></div>
      ) : visibles.map((c) => {
        const abierta = !c.venta_id && (c.estado === "agendada" || c.estado === "confirmada");
        const wa = enlaceWa(c.celular, `Hola ${c.nombre}, te recordamos tu cita en ${info.negocio.nombre} el ${nombreDia(dia)} a las ${horaCorta(c.inicio)}${c.servicio ? ` (${c.servicio})` : ""}. ¿Nos confirmas?`);
        return (
          <div key={c.id} className="tarjeta" style={{ gap: 8, borderLeft: `6px solid ${c.color ?? "var(--border)"}` }}>
            <div className="fila">
              <strong>{horaCorta(c.inicio)}–{horaCorta(c.fin)} · {c.nombre}</strong>
              <span className={`insignia ${c.venta_id ? "ok" : ESTADOS[c.estado][1]}`}>{c.venta_id ? "Cobrada" : ESTADOS[c.estado][0]}</span>
            </div>
            <span className="muted" style={{ fontSize: 14 }}>
              {c.servicio ?? "Sin servicio"}{c.servicio_precio != null ? ` · ${dinero(c.servicio_precio)}` : ""}{c.profesional ? ` · con ${c.profesional}` : ""}
            </span>
            {c.nota && <span className="muted" style={{ fontSize: 13 }}>Nota: {c.nota}</span>}
            {abierta && (
              <div className="acciones-fila">
                <button className="boton pequeno" onClick={() => setCobrar(c)}>Cobrar</button>
                {c.estado === "agendada" && <button className="boton pequeno secundario" onClick={() => estado(c, "confirmada")}>Confirmó</button>}
                {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">Recordar</a>}
                <button className="boton texto pequeno" onClick={() => estado(c, "no_vino")}>No vino</button>
                <button className="boton texto pequeno" onClick={() => estado(c, "cancelada")}>Cancelar</button>
              </div>
            )}
          </div>
        );
      })}
      {nueva && <NuevaCita dia={dia} profesionales={profesionales} alCerrar={() => setNueva(false)}
        alGuardar={() => { setNueva(false); avisar("Cita agendada"); cargar(); }} />}
      {cobrar && <CobrarCita info={info} cita={cobrar} alCerrar={() => setCobrar(null)}
        alCobrar={(n) => { setCobrar(null); avisar(`Venta N.º ${n} registrada`); cargar(); }} />}
    </div>
  );
}

function NuevaCita({ dia, profesionales, alCerrar, alGuardar }: {
  dia: string; profesionales: ReturnType<typeof useProfesionales>; alCerrar: () => void; alGuardar: () => void;
}) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [servicio, setServicio] = useState<Producto | null>(null);
  const [profesional, setProfesional] = useState(profesionales.length === 1 ? profesionales[0]!.id : "");
  const [fecha, setFecha] = useState(dia);
  const [hora, setHora] = useState("09:00");
  const [duracion, setDuracion] = useState("");
  const [nota, setNota] = useState("");
  const [elegir, setElegir] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("POST", "/citas", {
        cliente_id: cliente?.id, nombre: nombre || undefined, celular: celular || undefined, servicio_id: servicio?.id,
        profesional_id: profesional || undefined, inicio: aIso(fecha, hora),
        duracion_min: duracion ? Number(duracion) : undefined, nota: nota || undefined,
      });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo="Agendar cita" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <DatosCliente id="ci" cliente={cliente} setCliente={setCliente} nombre={nombre} setNombre={setNombre} celular={celular} setCelular={setCelular} />
        <button type="button" className="item-opcion" onClick={() => setElegir(true)}>
          <span className="textos"><strong>{servicio?.nombre ?? "Elegir servicio"}</strong>
            <span>{servicio ? `${dinero(servicio.precio)}${servicio.duracion_min ? ` · ${servicio.duracion_min} min` : ""}` : "Opcional"}</span></span>
        </button>
        {profesionales.length > 0 && (
          <div className="campo"><label htmlFor="ci-prof">Lo atiende</label>
            <select id="ci-prof" className="entrada" value={profesional} onChange={(e) => setProfesional(e.target.value)}>
              <option value="">Cualquiera</option>
              {profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></div>
        )}
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="ci-dia">Día</label>
            <input id="ci-dia" className="entrada" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="campo"><label htmlFor="ci-hora">Hora</label>
            <input id="ci-hora" className="entrada" type="time" step={300} value={hora} onChange={(e) => setHora(e.target.value)} /></div>
        </div>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="ci-dur">Duración (min)</label>
            <input id="ci-dur" className="entrada" inputMode="numeric" placeholder={String(servicio?.duracion_min ?? 30)} value={duracion} onChange={(e) => setDuracion(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="campo"><label htmlFor="ci-nota">Nota</label>
            <input id="ci-nota" className="entrada" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!cliente && nombre.trim().length < 2}>Agendar</button>
      </form>
      {elegir && <SelectorProducto titulo="Elegir servicio" alCerrar={() => setElegir(false)} alElegir={(p) => { setServicio(p); setElegir(false); }} />}
    </Dialogo>
  );
}

interface Linea { id: string; nombre: string; precio: number; cantidad: number }

function CobrarCita({ info, cita, alCerrar, alCobrar }: { info: InfoNegocio; cita: Cita; alCerrar: () => void; alCobrar: (n: number) => void }) {
  const [lineas, setLineas] = useState<Linea[]>(cita.servicio_id && cita.servicio_precio != null
    ? [{ id: cita.servicio_id, nombre: cita.servicio!, precio: cita.servicio_precio, cantidad: 1 }] : []);
  const [elegir, setElegir] = useState(false);
  const [pagar, setPagar] = useState(false);
  const total = redondear(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));

  if (pagar) {
    return (
      <DialogoCobro info={info} titulo={`Cobrar cita de ${cita.nombre}`} total={total} alCerrar={() => setPagar(false)}
        cobrar={async (d) => {
          const r = await api<{ venta: { numero: number } }>("POST", `/citas/${cita.id}/cobrar`, {
            items: lineas.map((l) => ({ producto_id: l.id, cantidad: l.cantidad })), pagos: d.pagos, comprobante: d.comprobante,
          });
          alCobrar(r.venta.numero);
        }} />
    );
  }
  return (
    <Dialogo titulo={`Cita de ${cita.nombre}`} alCerrar={alCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lineas.map((l, i) => (
          <div key={l.id} className="linea-carrito">
            <div className="info"><strong>{l.cantidad > 1 ? `${l.cantidad} × ` : ""}{l.nombre}</strong><span>{dinero(l.precio * l.cantidad)}</span></div>
            <button className="boton texto" aria-label={`Quitar ${l.nombre}`} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
          </div>
        ))}
        <button className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar servicio o producto</button>
        <p className="monto-grande">{dinero(total)}</p>
        <button className="boton bloque" disabled={!lineas.length} onClick={() => setPagar(true)}>Continuar al cobro</button>
      </div>
      {elegir && <SelectorProducto alCerrar={() => setElegir(false)} alElegir={(p) => {
        setElegir(false);
        if (p.precio === null) return;
        setLineas((ls) => ls.some((l) => l.id === p.id) ? ls.map((l) => (l.id === p.id ? { ...l, cantidad: l.cantidad + 1 } : l))
          : [...ls, { id: p.id, nombre: p.nombre, precio: p.precio!, cantidad: 1 }]);
      }} />}
    </Dialogo>
  );
}
