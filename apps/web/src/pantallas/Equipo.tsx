import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Rol } from "../tipos";
import { puedeGestionar } from "../tipos";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";

interface Miembro { id: string; nombre: string | null; celular: string; rol: Rol; activo: boolean }

const ROLES: Record<Rol, [string, string]> = {
  dueno: ["Dueño", "Todo"],
  administrador: ["Administrador", "Todo menos agregar administradores"],
  cajero: ["Cajero", "Vende, cobra y abre la caja. No cambia precios ni anula"],
  bodeguero: ["Bodeguero", "Productos, stock y compras. No vende"],
};

export function Equipo({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [equipo, setEquipo] = useState<Miembro[] | null>(null);
  const [invitar, setInvitar] = useState(false);
  const [editar, setEditar] = useState<Miembro | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<{ equipo: Miembro[] }>("GET", "/negocio/equipo").then((r) => setEquipo(r.equipo)).catch(() => setEquipo([]));
  }, []);
  useEffect(cargar, [cargar]);

  async function cambiar(m: Miembro) {
    try { await api("PATCH", `/negocio/equipo/${m.id}`, { activo: !m.activo }); avisar(m.activo ? "Acceso quitado" : "Acceso devuelto"); cargar(); }
    catch (e) { avisar(mensajeDe(e)); }
  }

  if (!equipo) return <Cargando />;
  return (
    <div className="contenido" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <h1>Equipo</h1>
      {gestiona && <button className="boton bloque" onClick={() => setInvitar(true)}><IMas tam={20} /> Agregar persona</button>}
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {equipo.map((m) => (
          <div key={m.id} className="comprobante-fila">
            <div className="textos">
              <strong className={m.activo ? "" : "anulada"}>{m.nombre ?? m.celular}</strong>
              <span>{m.nombre ? `${m.celular} · ` : ""}{ROLES[m.rol][0]}</span>
            </div>
            {gestiona && m.rol !== "dueno" && (info.rol === "dueno" || m.rol !== "administrador") && (
              <button className="boton texto pequeno" onClick={() => setEditar(m)}>Cambiar</button>
            )}
          </div>
        ))}
      </div>
      {editar && (
        <Dialogo titulo={editar.nombre ?? editar.celular} alCerrar={() => setEditar(null)}>
          <div className="lista-opciones">
            {(info.rol === "dueno" ? ["cajero", "bodeguero", "administrador"] as Rol[] : ["cajero", "bodeguero"] as Rol[]).map((r) => (
              <button type="button" key={r} className={`item-opcion${editar.rol === r ? " activo" : ""}`} aria-pressed={editar.rol === r}
                onClick={async () => {
                  try { await api("PATCH", `/negocio/equipo/${editar.id}`, { rol: r }); avisar(`Ahora es ${ROLES[r][0].toLowerCase()}`); setEditar(null); cargar(); }
                  catch (e) { avisar(mensajeDe(e)); }
                }}>
                <span className="textos"><strong>{ROLES[r][0]}</strong><span>{ROLES[r][1]}</span></span>
              </button>
            ))}
          </div>
          <button className={`boton bloque ${editar.activo ? "peligro" : "secundario"}`} onClick={() => { cambiar(editar); setEditar(null); }}>
            {editar.activo ? "Quitar acceso" : "Devolver acceso"}
          </button>
        </Dialogo>
      )}
      {invitar && <Invitar esDueño={info.rol === "dueno"} alCerrar={() => setInvitar(false)} alGuardar={() => { setInvitar(false); avisar("Listo: ya puede entrar con su celular"); cargar(); }} />}
    </div>
  );
}

function Invitar({ esDueño, alCerrar, alGuardar }: { esDueño: boolean; alCerrar: () => void; alGuardar: () => void }) {
  const [celular, setCelular] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<Rol>("cajero");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", "/negocio/equipo", { celular, nombre: nombre || undefined, rol }); alGuardar(); } catch (err) { setError(mensajeDe(err)); }
  }
  const roles: Rol[] = esDueño ? ["cajero", "bodeguero", "administrador"] : ["cajero", "bodeguero"];
  return (
    <Dialogo titulo="Agregar persona" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="e-nombre">Nombre</label>
          <input id="e-nombre" className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="e-cel">Celular</label>
          <input id="e-cel" className="entrada" type="tel" inputMode="tel" placeholder="09…" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
        <div className="lista-opciones">
          {roles.map((r) => (
            <button type="button" key={r} className={`item-opcion${rol === r ? " activo" : ""}`} aria-pressed={rol === r} onClick={() => setRol(r)}>
              <span className="textos"><strong>{ROLES[r][0]}</strong><span>{ROLES[r][1]}</span></span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Entra con su propio celular y el código que le llega.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={celular.replace(/\D/g, "").length < 9}>Agregar</button>
      </form>
    </Dialogo>
  );
}
