import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar, tieneModulo } from "../tipos";
import { dinero, fecha, parsearNumero } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";
import type { Profesional } from "../componentes/servicios";

interface Resumen { id: string; nombre: string; pendiente: number; pagado_mes: number; vendido_mes: number }
interface Detalle { id: number; descripcion: string; base: number; pct: number; monto: number; estado: string; creado_en: string; venta_numero: number; profesional: string }
const COLORES = ["#1847c2", "#c2185b", "#2e7d32", "#ef6c00", "#6a1b9a", "#00838f", "#5d4037"];

/** Quien atiende (estilistas, técnicos, entrenadores) y sus comisiones. */
export function Profesionales({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [lista, setLista] = useState<Profesional[] | null>(null);
  const [resumen, setResumen] = useState<Resumen[]>([]);
  const [detalle, setDetalle] = useState<{ nombre: string; filas: Detalle[] } | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const gestiona = puedeGestionar(info.rol);
  const conComisiones = tieneModulo(info, "M12") && gestiona;

  const cargar = useCallback(() => {
    api<{ profesionales: Profesional[] }>("GET", "/profesionales").then((r) => setLista(r.profesionales)).catch(() => setLista([]));
    if (conComisiones) api<{ resumen: Resumen[] }>("GET", "/comisiones").then((r) => setResumen(r.resumen)).catch(() => {});
  }, [conComisiones]);
  useEffect(cargar, [cargar]);

  const [confirmar, setConfirmar] = useState<{ p: Profesional; monto: number } | null>(null);
  async function pagar(p: Profesional) {
    setConfirmar(null);
    try {
      const r = await api<{ pagado: number }>("POST", `/profesionales/${p.id}/pagar`, {});
      avisar(`Pagaste ${dinero(r.pagado)} a ${p.nombre}`);
      cargar();
    } catch (err) { avisar(mensajeDe(err)); }
  }
  async function verDetalle(p: Profesional) {
    const r = await api<{ detalle: Detalle[] }>("GET", `/comisiones?profesional=${p.id}`);
    setDetalle({ nombre: p.nombre, filas: r.detalle });
  }
  async function activo(p: Profesional, a: boolean) {
    try { await api("PATCH", `/profesionales/${p.id}`, { activo: a }); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  if (!lista) return <Cargando />;
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>{conComisiones ? "Profesionales y comisiones" : "Profesionales"}</h1>
      {gestiona && <button className="boton bloque" onClick={() => setNuevo(true)}><IMas tam={20} /> Agregar profesional</button>}
      {lista.length === 0 && <div className="vacio"><p>Agrega a quienes atienden para repartir la agenda{conComisiones ? " y calcular sus comisiones" : ""}.</p></div>}
      {lista.map((p) => {
        const r = resumen.find((x) => x.id === p.id);
        return (
          <div key={p.id} className="tarjeta" style={{ gap: 8, borderLeft: `6px solid ${p.color}`, opacity: p.activo ? 1 : 0.6 }}>
            <div className="fila">
              <strong>{p.nombre}</strong>
              {conComisiones && <span className="muted" style={{ fontSize: 14 }}>{p.comision_pct} % de comisión</span>}
            </div>
            {conComisiones && r && (
              <>
                <span className="muted" style={{ fontSize: 14 }}>Este mes: vendió {dinero(r.vendido_mes)} · pagado {dinero(r.pagado_mes)}</span>
                <div className="fila"><span>Por pagar</span><strong>{dinero(r.pendiente)}</strong></div>
              </>
            )}
            {gestiona && (
              <div className="acciones-fila">
                {conComisiones && r && Number(r.pendiente) > 0 && <button className="boton pequeno" onClick={() => setConfirmar({ p, monto: Number(r.pendiente) })}>Pagar comisiones</button>}
                {conComisiones && <button className="boton pequeno secundario" onClick={() => verDetalle(p)}>Ver detalle</button>}
                <button className="boton texto pequeno" onClick={() => activo(p, !p.activo)}>{p.activo ? "Desactivar" : "Activar"}</button>
              </div>
            )}
          </div>
        );
      })}
      {nuevo && <NuevoProfesional conComision={conComisiones} color={COLORES[lista.length % COLORES.length]!}
        alCerrar={() => setNuevo(false)} alGuardar={() => { setNuevo(false); avisar("Profesional agregado"); cargar(); }} />}
      {confirmar && (
        <Dialogo titulo="Pagar comisiones" alCerrar={() => setConfirmar(null)}>
          <p>¿Pagar <strong>{dinero(confirmar.monto)}</strong> a {confirmar.p.nombre}? Si la caja está abierta, sale del efectivo.</p>
          <button className="boton bloque" onClick={() => pagar(confirmar.p)}>Pagar {dinero(confirmar.monto)}</button>
        </Dialogo>
      )}
      {detalle && (
        <Dialogo titulo={`Comisiones de ${detalle.nombre}`} alCerrar={() => setDetalle(null)}>
          {detalle.filas.length === 0 ? <p className="muted">Todavía no tiene comisiones.</p> : detalle.filas.map((d) => (
            <div key={d.id} className="comprobante-fila">
              <div className="textos"><strong>{d.descripcion}</strong><span>Venta N.º {d.venta_numero} · {fecha(d.creado_en)} · {d.pct} % de {dinero(d.base)}</span></div>
              <div style={{ textAlign: "right" }}><strong className={d.estado === "anulada" ? "anulada" : ""}>{dinero(d.monto)}</strong><br />
                <span className={`insignia ${d.estado === "pagada" ? "ok" : d.estado === "anulada" ? "gris" : "no"}`}>{d.estado === "pendiente" ? "Por pagar" : d.estado === "pagada" ? "Pagada" : "Anulada"}</span></div>
            </div>
          ))}
        </Dialogo>
      )}
    </div>
  );
}

function NuevoProfesional({ conComision, color, alCerrar, alGuardar }: { conComision: boolean; color: string; alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [comision, setComision] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/profesionales", { nombre, celular: celular || undefined, comision_pct: parsearNumero(comision) ?? 0, color });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Agregar profesional" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="pr-n">Nombre</label>
          <input id="pr-n" className="entrada" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="pr-c">Celular (opcional)</label>
          <input id="pr-c" className="entrada" type="tel" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
        {conComision && (
          <div className="campo"><label htmlFor="pr-com">Comisión % sobre lo que atiende</label>
            <input id="pr-com" className="entrada" inputMode="decimal" placeholder="0" value={comision} onChange={(e) => setComision(e.target.value)} /></div>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={nombre.trim().length < 2}>Guardar</button>
      </form>
    </Dialogo>
  );
}
