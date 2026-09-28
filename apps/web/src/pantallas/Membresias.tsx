import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, fecha, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IMas } from "../componentes/iconos";
import { DialogoCobro } from "../componentes/DialogoCobro";
import { ElegirCliente } from "./Cobrar";
import { enlaceWa, horaCorta } from "../componentes/servicios";

interface Plan { id: string; nombre: string; precio: number; duracion_dias: number; sesiones: number | null; activo: boolean; vigentes: number }
type Situacion = "vigente" | "por_vencer" | "vencida" | "sin_sesiones";
interface Socio {
  cliente_id: string; nombre: string; celular: string | null; plan: string; desde: string; hasta: string;
  sesiones_restantes: number | null; situacion: Situacion; ultima_visita: string | null;
}
const SITUACION: Record<Situacion, [string, string]> = {
  vigente: ["Al día", "ok"], por_vencer: ["Por vencer", "no"], vencida: ["Vencida", "mal"], sin_sesiones: ["Sin clases", "mal"],
};
const f = (d: string) => fecha(d + "T12:00:00");

/** Membresías: vender o renovar planes, marcar la entrada y ver quién está por vencer. */
export function Membresias({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [vista, setVista] = useState<"socios" | "hoy" | "planes">("socios");
  const [q, setQ] = useState("");
  const [socios, setSocios] = useState<Socio[] | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [hoy, setHoy] = useState<{ id: number; creado_en: string; nombre: string }[]>([]);
  const [vender, setVender] = useState<{ cliente?: Cliente | null } | null>(null);
  const [nuevoPlan, setNuevoPlan] = useState(false);

  const cargar = useCallback(() => {
    api<{ socios: Socio[] }>("GET", `/socios?q=${encodeURIComponent(q)}`).then((r) => setSocios(r.socios)).catch(() => setSocios([]));
    api<{ planes: Plan[] }>("GET", "/planes-membresia").then((r) => setPlanes(r.planes)).catch(() => {});
    api<{ asistencias: typeof hoy }>("GET", "/asistencias").then((r) => setHoy(r.asistencias)).catch(() => {});
  }, [q]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  async function entrada(s: Socio) {
    try {
      const r = await api<{ asistencia: { hasta: string; sesiones_restantes: number | null } }>("POST", "/asistencias", { cliente_id: s.cliente_id });
      avisar(`Entrada de ${s.nombre}${r.asistencia.sesiones_restantes != null ? ` · le quedan ${r.asistencia.sesiones_restantes} clases` : ""}`);
      cargar();
    } catch (err) { avisar(mensajeDe(err)); }
  }

  const activos = planes.filter((p) => p.activo);
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Membresías</h1>
      <div className="chips" role="tablist">
        {([["socios", "Socios"], ["hoy", `Hoy (${hoy.length})`], ["planes", "Planes"]] as const).map(([v, t]) => (
          <button key={v} role="tab" aria-selected={vista === v} className={`chip${vista === v ? " activo" : ""}`} onClick={() => setVista(v)}>{t}</button>
        ))}
      </div>

      {vista === "socios" && (
        <>
          {activos.length === 0 ? (
            <Aviso tipo="info" titulo="Primero crea tus planes">Por ejemplo: Mensual, Quincenal, 12 clases.
              {puedeGestionar(info.rol) && <> <button className="boton texto" onClick={() => setVista("planes")}>Crear planes</button></>}</Aviso>
          ) : <button className="boton bloque" onClick={() => setVender({})}><IMas tam={20} /> Vender membresía</button>}
          <div className="con-icono">
            <IBuscar tam={20} />
            <label htmlFor="buscar-socio" className="oculto">Buscar socio</label>
            <input id="buscar-socio" className="entrada" placeholder="Nombre o celular" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!socios ? <Cargando /> : socios.length === 0 ? <div className="vacio"><p>{q ? "No hay socios con ese nombre." : "Aún no hay socios."}</p></div>
            : socios.map((s) => {
              const al = s.situacion === "vigente" || s.situacion === "por_vencer";
              const wa = !al || s.situacion === "por_vencer"
                ? enlaceWa(s.celular, `Hola ${s.nombre}, tu plan ${s.plan} en ${info.negocio.nombre} ${s.situacion === "por_vencer" ? `vence el ${f(s.hasta)}` : "ya venció"}. ¡Te esperamos para renovarlo!`) : null;
              return (
                <div key={s.cliente_id} className="tarjeta" style={{ gap: 6 }}>
                  <div className="fila"><strong>{s.nombre}</strong><span className={`insignia ${SITUACION[s.situacion][1]}`}>{SITUACION[s.situacion][0]}</span></div>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {s.plan} · hasta {f(s.hasta)}{s.sesiones_restantes != null ? ` · ${s.sesiones_restantes} clases` : ""}
                    {s.ultima_visita ? ` · vino ${fecha(s.ultima_visita)}` : ""}
                  </span>
                  <div className="acciones-fila">
                    {al && s.situacion !== "sin_sesiones" && <button className="boton pequeno" onClick={() => entrada(s)}>Marcar entrada</button>}
                    <button className="boton pequeno secundario" onClick={() => setVender({ cliente: { id: s.cliente_id, nombre: s.nombre, celular: s.celular, limite_credito: null, saldo: 0 } })}>Renovar</button>
                    {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">Recordar</a>}
                  </div>
                </div>
              );
            })}
        </>
      )}

      {vista === "hoy" && (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          {hoy.length === 0 ? <p className="muted" style={{ padding: "12px 0" }}>Nadie ha entrado hoy.</p>
            : hoy.map((a) => <div key={a.id} className="fila" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}><span>{a.nombre}</span><span className="muted">{horaCorta(a.creado_en)}</span></div>)}
        </div>
      )}

      {vista === "planes" && (
        <>
          {puedeGestionar(info.rol) && <button className="boton bloque" onClick={() => setNuevoPlan(true)}><IMas tam={20} /> Nuevo plan</button>}
          {planes.map((p) => (
            <div key={p.id} className="tarjeta" style={{ gap: 4 }}>
              <div className="fila"><strong>{p.nombre}</strong><strong>{dinero(p.precio)}</strong></div>
              <span className="muted" style={{ fontSize: 14 }}>{p.duracion_dias} días{p.sesiones ? ` · ${p.sesiones} clases` : " · ilimitado"} · {p.vigentes} socios al día</span>
            </div>
          ))}
        </>
      )}

      {nuevoPlan && <NuevoPlan alCerrar={() => setNuevoPlan(false)} alGuardar={() => { setNuevoPlan(false); avisar("Plan creado"); setVista("socios"); cargar(); }} />}
      {vender && <VenderMembresia info={info} planes={activos} cliente={vender.cliente ?? null} alCerrar={() => setVender(null)}
        alVender={(t) => { setVender(null); avisar(t); cargar(); }} />}
    </div>
  );
}

function NuevoPlan({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState("Mensual");
  const [precio, setPrecio] = useState("");
  const [dias, setDias] = useState("30");
  const [sesiones, setSesiones] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/planes-membresia", { nombre, precio: parsearNumero(precio), duracion_dias: Number(dias), sesiones: sesiones ? Number(sesiones) : undefined });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Nuevo plan" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="pl-n">Nombre del plan</label>
            <input id="pl-n" className="entrada" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <CampoMonto id="pl-p" etiqueta="Precio" valor={precio} alCambiar={setPrecio} />
        </div>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="pl-d">Dura (días)</label>
            <input id="pl-d" className="entrada" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="campo"><label htmlFor="pl-s">Clases incluidas (vacío = ilimitado)</label>
            <input id="pl-s" className="entrada" inputMode="numeric" value={sesiones} onChange={(e) => setSesiones(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!nombre.trim() || parsearNumero(precio) === null || !Number(dias)}>Crear plan</button>
      </form>
    </Dialogo>
  );
}

function VenderMembresia({ info, planes, cliente: inicial, alCerrar, alVender }: {
  info: InfoNegocio; planes: Plan[]; cliente: Cliente | null; alCerrar: () => void; alVender: (t: string) => void;
}) {
  const [cliente, setCliente] = useState<Cliente | null>(inicial);
  const [plan, setPlan] = useState<Plan | null>(planes.length === 1 ? planes[0]! : null);
  const [elegir, setElegir] = useState(!inicial);
  const [pagar, setPagar] = useState(false);

  if (pagar && cliente && plan) {
    return (
      <DialogoCobro info={info} titulo={`${plan.nombre} · ${cliente.nombre}`} total={Number(plan.precio)} cliente={cliente} alCerrar={() => setPagar(false)}
        cobrar={async (d) => {
          const r = await api<{ venta: { numero: number; hasta: string } }>("POST", "/membresias", {
            cliente_id: cliente.id, plan_id: plan.id, pagos: d.pagos, comprobante: d.comprobante });
          alVender(`${cliente.nombre} al día hasta el ${f(r.venta.hasta)}`);
        }} />
    );
  }
  return (
    <Dialogo titulo="Vender membresía" alCerrar={alCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className={`item-opcion${cliente ? " activo" : ""}`} onClick={() => setElegir(true)}>
          <span className="textos"><strong>{cliente?.nombre ?? "Elegir socio"}</strong><span>{cliente ? "Toca para cambiar" : "Busca o crea el cliente"}</span></span>
        </button>
        {planes.map((p) => (
          <button key={p.id} className={`item-opcion${plan?.id === p.id ? " activo" : ""}`} onClick={() => setPlan(p)}>
            <span className="textos"><strong>{p.nombre}</strong><span>{p.duracion_dias} días{p.sesiones ? ` · ${p.sesiones} clases` : ""}</span></span>
            <strong>{dinero(p.precio)}</strong>
          </button>
        ))}
        <button className="boton bloque" disabled={!cliente || !plan} onClick={() => setPagar(true)}>Continuar al cobro</button>
      </div>
      {elegir && <ElegirCliente alCerrar={() => setElegir(false)} alElegir={(c) => { setCliente(c); setElegir(false); }} />}
    </Dialogo>
  );
}
