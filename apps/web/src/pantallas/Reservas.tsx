import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IMas, IVolver } from "../componentes/iconos";
import { DialogoCobro } from "../componentes/DialogoCobro";
import { aIso, DatosCliente, diaLocal, enlaceWa, horaCorta, sumarDias } from "../componentes/servicios";

type Unidad = "noche" | "dia" | "hora";
interface Recurso { id: string; nombre: string; tipo: string | null; unidad: Unidad; precio: number; capacidad: number | null; activo: boolean }
type Estado = "reservada" | "confirmada" | "en_curso" | "finalizada" | "cancelada";
interface Reserva {
  id: string; numero: number; recurso_id: string; recurso: string; unidad: Unidad; nombre: string; celular: string | null;
  desde: string; hasta: string; unidades: number; precio: number; total: number; estado: Estado; personas: number | null;
  nota: string | null; venta_id: string | null;
}
const ESTADOS: Record<Estado, [string, string]> = {
  reservada: ["Reservada", "gris"], confirmada: ["Confirmada", "no"], en_curso: ["En curso", "ok"], finalizada: ["Finalizada", "gris"], cancelada: ["Cancelada", "gris"],
};
const UNIDADES: Record<Unidad, string> = { noche: "por noche", dia: "por día", hora: "por hora" };
const DIAS = 7;
const corto = (dia: string) => new Date(dia + "T12:00:00").toLocaleDateString("es-EC", { weekday: "short", day: "numeric" });
const diaDe = (iso: string) => diaLocal(new Date(iso));

/** Reservas por fecha: ocupación de la semana, reservar, cobrar y registrar entrada/salida. */
export function Reservas({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [desde, setDesde] = useState(diaLocal());
  const [recursos, setRecursos] = useState<Recurso[] | null>(null);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [nuevoRecurso, setNuevoRecurso] = useState(false);
  const [nueva, setNueva] = useState<{ recurso?: string; dia?: string } | null>(null);
  const [cobrar, setCobrar] = useState<Reserva | null>(null);

  const cargar = useCallback(() => {
    api<{ recursos: Recurso[] }>("GET", "/recursos").then((r) => setRecursos(r.recursos.filter((x) => x.activo))).catch(() => setRecursos([]));
    api<{ reservas: Reserva[] }>("GET", `/reservas?desde=${desde}&dias=${DIAS}`).then((r) => setReservas(r.reservas)).catch(() => {});
  }, [desde]);
  useEffect(cargar, [cargar]);

  async function estado(r: Reserva, e: Estado) {
    try { await api("POST", `/reservas/${r.id}/estado`, { estado: e }); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  if (!recursos) return <Cargando />;
  const dias = Array.from({ length: DIAS }, (_, i) => sumarDias(desde, i));
  const vivas = reservas.filter((r) => r.estado !== "cancelada");
  const ocupada = (rec: string, dia: string) => vivas.find((r) => r.recurso_id === rec && diaDe(r.desde) <= dia && (diaDe(r.hasta) > dia || (r.unidad !== "noche" && diaDe(r.hasta) === dia)));

  return (
    <div className="contenido" style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
      <h1>Reservas</h1>
      {recursos.length === 0 ? (
        <div className="vacio">
          <p>Agrega lo que alquilas o reservas: habitaciones, canchas, salones, equipos…</p>
          {puedeGestionar(info.rol) && <button className="boton" onClick={() => setNuevoRecurso(true)}><IMas tam={20} /> Agregar</button>}
        </div>
      ) : (
        <>
          <button className="boton bloque" onClick={() => setNueva({})}><IMas tam={20} /> Nueva reserva</button>
          <div className="fila">
            <button className="boton secundario pequeno" aria-label="Semana anterior" onClick={() => setDesde(sumarDias(desde, -DIAS))}><IVolver tam={18} /></button>
            <button className="boton texto pequeno" onClick={() => setDesde(diaLocal())}>Desde hoy</button>
            <button className="boton secundario pequeno" aria-label="Semana siguiente" onClick={() => setDesde(sumarDias(desde, DIAS))}>
              <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><IVolver tam={18} /></span>
            </button>
          </div>
          <div className="tarjeta" style={{ padding: 8, overflowX: "auto" }}>
            <table className="ocupacion">
              <thead><tr><th />{dias.map((d) => <th key={d}>{corto(d)}</th>)}</tr></thead>
              <tbody>
                {recursos.map((rc) => (
                  <tr key={rc.id}>
                    <th scope="row">{rc.nombre}</th>
                    {dias.map((d) => {
                      const r = ocupada(rc.id, d);
                      return (
                        <td key={d}>
                          <button className={`celda${r ? " ocupada" : ""}`} aria-label={r ? `${rc.nombre} ${corto(d)}: ${r.nombre}` : `Reservar ${rc.nombre} el ${corto(d)}`}
                            onClick={() => (r ? document.getElementById(`rv-${r.id}`)?.scrollIntoView({ behavior: "smooth" }) : setNueva({ recurso: rc.id, dia: d }))}>
                            {r ? r.nombre.split(" ")[0] : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {puedeGestionar(info.rol) && <button className="boton texto" style={{ alignSelf: "flex-start" }} onClick={() => setNuevoRecurso(true)}><IMas tam={18} /> Agregar habitación, cancha o salón</button>}
          {vivas.map((r) => {
            const wa = enlaceWa(r.celular, `Hola ${r.nombre}, confirmamos tu reserva N.º ${r.numero} de ${r.recurso} en ${info.negocio.nombre} desde ${new Date(r.desde).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" })}. Total ${dinero(r.total)}.`);
            return (
              <div key={r.id} id={`rv-${r.id}`} className="tarjeta" style={{ gap: 8 }}>
                <div className="fila"><strong>N.º {r.numero} · {r.recurso}</strong><span className={`insignia ${ESTADOS[r.estado][1]}`}>{ESTADOS[r.estado][0]}</span></div>
                <span>{r.nombre}{r.personas ? ` · ${r.personas} personas` : ""}</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {corto(diaDe(r.desde))} {horaCorta(r.desde)} → {corto(diaDe(r.hasta))} {horaCorta(r.hasta)} · {Number(r.unidades)} {({ noche: ["noche", "noches"], dia: ["día", "días"], hora: ["hora", "horas"] } as const)[r.unidad][Number(r.unidades) === 1 ? 0 : 1]}
                </span>
                <div className="fila"><strong>{dinero(r.total)}</strong>{r.venta_id ? <span className="insignia ok">Cobrada</span> : <span className="insignia no">Por cobrar</span>}</div>
                {r.estado !== "finalizada" && (
                  <div className="acciones-fila">
                    {!r.venta_id && <button className="boton pequeno" onClick={() => setCobrar(r)}>Cobrar</button>}
                    {r.estado === "reservada" && <button className="boton pequeno secundario" onClick={() => estado(r, "confirmada")}>Confirmar</button>}
                    {(r.estado === "reservada" || r.estado === "confirmada") && <button className="boton pequeno secundario" onClick={() => estado(r, "en_curso")}>Llegó</button>}
                    {r.estado === "en_curso" && <button className="boton pequeno secundario" onClick={() => estado(r, "finalizada")}>Salió</button>}
                    {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">WhatsApp</a>}
                    {!r.venta_id && <button className="boton texto pequeno" onClick={() => estado(r, "cancelada")}>Cancelar</button>}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {nuevoRecurso && <NuevoRecurso alCerrar={() => setNuevoRecurso(false)} alGuardar={() => { setNuevoRecurso(false); cargar(); }} />}
      {nueva && <NuevaReserva recursos={recursos} inicial={nueva} alCerrar={() => setNueva(null)}
        alGuardar={(n) => { setNueva(null); avisar(`Reserva N.º ${n} guardada`); cargar(); }} />}
      {cobrar && (
        <DialogoCobro info={info} titulo={`Cobrar reserva N.º ${cobrar.numero}`} total={Number(cobrar.total)} conFiado={false} alCerrar={() => setCobrar(null)}
          cobrar={async (d) => {
            const r = await api<{ venta: { numero: number } }>("POST", `/reservas/${cobrar.id}/cobrar`, { pagos: d.pagos, comprobante: d.comprobante });
            setCobrar(null);
            avisar(`Venta N.º ${r.venta.numero} registrada`);
            cargar();
          }} />
      )}
    </div>
  );
}

function NuevoRecurso({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("Habitación");
  const [unidad, setUnidad] = useState<Unidad>("noche");
  const [precio, setPrecio] = useState("");
  const [capacidad, setCapacidad] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/recursos", { nombre, tipo, unidad, precio: parsearNumero(precio), capacidad: capacidad ? Number(capacidad) : undefined });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Agregar para reservar" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="rc-n">Nombre</label>
            <input id="rc-n" className="entrada" maxLength={80} placeholder="Habitación 1" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rc-t">Tipo</label>
            <select id="rc-t" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {["Habitación", "Cancha", "Salón", "Cabaña", "Equipo", "Vehículo", "Otro"].map((t) => <option key={t}>{t}</option>)}
            </select></div>
        </div>
        <div className="opciones" role="group" aria-label="Se cobra">
          {(["noche", "dia", "hora"] as Unidad[]).map((u) => (
            <button type="button" key={u} className={`opcion${unidad === u ? " activa" : ""}`} onClick={() => setUnidad(u)}>{UNIDADES[u]}</button>
          ))}
        </div>
        <div className="rejilla-2">
          <CampoMonto id="rc-p" etiqueta={`Precio ${UNIDADES[unidad]}`} valor={precio} alCambiar={setPrecio} />
          <div className="campo"><label htmlFor="rc-c">Capacidad (personas)</label>
            <input id="rc-c" className="entrada" inputMode="numeric" value={capacidad} onChange={(e) => setCapacidad(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!nombre.trim() || parsearNumero(precio) === null}>Guardar</button>
      </form>
    </Dialogo>
  );
}

function NuevaReserva({ recursos, inicial, alCerrar, alGuardar }: {
  recursos: Recurso[]; inicial: { recurso?: string; dia?: string }; alCerrar: () => void; alGuardar: (n: number) => void;
}) {
  const [recurso, setRecurso] = useState(inicial.recurso ?? recursos[0]?.id ?? "");
  const rc = recursos.find((r) => r.id === recurso);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const dia = inicial.dia ?? diaLocal();
  const [desdeDia, setDesdeDia] = useState(dia);
  const [desdeHora, setDesdeHora] = useState(rc?.unidad === "hora" ? "18:00" : "14:00");
  const [hastaDia, setHastaDia] = useState(rc?.unidad === "hora" ? dia : sumarDias(dia, 1));
  const [hastaHora, setHastaHora] = useState(rc?.unidad === "hora" ? "19:00" : "12:00");
  const [personas, setPersonas] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ reserva: { numero: number } }>("POST", "/reservas", {
        recurso_id: recurso, cliente_id: cliente?.id, nombre: nombre || undefined, celular: celular || undefined,
        desde: aIso(desdeDia, desdeHora), hasta: aIso(hastaDia, hastaHora),
        personas: personas ? Number(personas) : undefined, nota: nota || undefined,
      });
      alGuardar(r.reserva.numero);
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo="Nueva reserva" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="rv-rec">Qué se reserva</label>
          <select id="rv-rec" className="entrada" value={recurso} onChange={(e) => setRecurso(e.target.value)}>
            {recursos.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {dinero(r.precio)} {UNIDADES[r.unidad]}</option>)}
          </select></div>
        <DatosCliente id="rv" cliente={cliente} setCliente={setCliente} nombre={nombre} setNombre={setNombre} celular={celular} setCelular={setCelular} />
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="rv-dd">{rc?.unidad === "noche" ? "Llega" : "Desde"}</label>
            <input id="rv-dd" className="entrada" type="date" value={desdeDia} onChange={(e) => setDesdeDia(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rv-dh">Hora</label>
            <input id="rv-dh" className="entrada" type="time" value={desdeHora} onChange={(e) => setDesdeHora(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rv-hd">{rc?.unidad === "noche" ? "Sale" : "Hasta"}</label>
            <input id="rv-hd" className="entrada" type="date" value={hastaDia} onChange={(e) => setHastaDia(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rv-hh">Hora</label>
            <input id="rv-hh" className="entrada" type="time" value={hastaHora} onChange={(e) => setHastaHora(e.target.value)} /></div>
        </div>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="rv-per">Personas</label>
            <input id="rv-per" className="entrada" inputMode="numeric" value={personas} onChange={(e) => setPersonas(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="campo"><label htmlFor="rv-nota">Nota</label>
            <input id="rv-nota" className="entrada" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!recurso || (!cliente && nombre.trim().length < 2)}>Reservar</button>
      </form>
    </Dialogo>
  );
}
