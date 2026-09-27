import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";

interface Mesa {
  id: string; nombre: string; zona: string | null; cuenta_id: string | null; cuenta_numero: number | null;
  personas: number | null; abierta_en: string | null; por_cobrar: number; listos: number;
}
interface CuentaSuelta { cuenta_id: string; cuenta_numero: number; nombre: string; abierta_en: string; por_cobrar: number }

const minutos = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const tiempo = (iso: string) => { const m = minutos(iso); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export function Mesas({ info, navegar, avisar }: { info: InfoNegocio; navegar: (r: string) => void; avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ mesas: Mesa[]; cuentas: CuentaSuelta[] } | null>(null);
  const [agregar, setAgregar] = useState(false);
  const [suelta, setSuelta] = useState(false);

  const cargar = useCallback(() => {
    api<{ mesas: Mesa[]; cuentas: CuentaSuelta[] }>("GET", "/mesas").then(setDatos).catch(() => setDatos({ mesas: [], cuentas: [] }));
  }, []);
  useEffect(() => {
    cargar();
    const t = window.setInterval(cargar, 20_000);   // lo que hacen los demás meseros
    return () => window.clearInterval(t);
  }, [cargar]);

  async function abrir(m: Mesa) {
    if (m.cuenta_id) { navegar(`/cuenta/${m.cuenta_id}`); return; }
    try {
      const r = await api<{ id: string }>("POST", "/cuentas", { mesa_id: m.id });
      navegar(`/cuenta/${r.id}`);
    } catch (e) { avisar(mensajeDe(e)); }
  }

  if (!datos) return <Cargando />;
  const zonas = [...new Set(datos.mesas.map((m) => m.zona ?? ""))];
  const ocupadas = datos.mesas.filter((m) => m.cuenta_id).length;

  return (
    <div className="contenido">
      <div className="fila">
        <h1>Mesas</h1>
        <span className="muted">{ocupadas} de {datos.mesas.length} ocupadas</span>
      </div>
      {datos.mesas.length === 0 && (
        <Aviso tipo="info">{puedeGestionar(info.rol) ? "Agrega tus mesas para empezar a tomar comandas." : "El dueño todavía no agrega las mesas."}</Aviso>
      )}
      {zonas.map((z) => (
        <div key={z} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {z && <span className="etiqueta">{z}</span>}
          <div className="rejilla-mesas">
            {datos.mesas.filter((m) => (m.zona ?? "") === z).map((m) => (
              <button key={m.id} className={`mesa${m.cuenta_id ? " ocupada" : ""}`} onClick={() => abrir(m)}
                aria-label={`Mesa ${m.nombre}${m.cuenta_id ? `, ocupada, ${dinero(m.por_cobrar)}` : ", libre"}`}>
                <strong>{m.nombre}</strong>
                {m.cuenta_id ? (
                  <>
                    <span>{dinero(m.por_cobrar)}</span>
                    <span className="mesa-tiempo">{tiempo(m.abierta_en!)}{m.personas ? ` · ${m.personas} p.` : ""}</span>
                    {m.listos > 0 && <span className="insignia ok">{m.listos} listo{m.listos > 1 ? "s" : ""}</span>}
                  </>
                ) : <span className="mesa-tiempo">Libre</span>}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="tarjeta" style={{ padding: "12px 16px" }}>
        <div className="fila">
          <h3>Para llevar y barra</h3>
          <button className="boton pequeno secundario" onClick={() => setSuelta(true)}><IMas tam={18} /> Cuenta</button>
        </div>
        {datos.cuentas.map((c) => (
          <button key={c.cuenta_id} className="fila" style={{ background: "none", border: "none", padding: "10px 0", width: "100%", textAlign: "left", borderTop: "1px solid var(--border)" }}
            onClick={() => navegar(`/cuenta/${c.cuenta_id}`)}>
            <span style={{ display: "flex", flexDirection: "column" }}><strong>{c.nombre}</strong><span className="muted" style={{ fontSize: 13 }}>{tiempo(c.abierta_en)}</span></span>
            <strong>{dinero(c.por_cobrar)}</strong>
          </button>
        ))}
        {datos.cuentas.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Cuentas sin mesa: pedidos en la barra o para llevar.</p>}
      </div>

      {puedeGestionar(info.rol) && <button className="boton texto" onClick={() => setAgregar(true)}>Agregar mesas</button>}
      {agregar && <AgregarMesas alCerrar={() => setAgregar(false)} alGuardar={() => { setAgregar(false); avisar("Mesas agregadas"); cargar(); }} />}
      {suelta && <CuentaSinMesa alCerrar={() => setSuelta(false)} alCrear={(id) => navegar(`/cuenta/${id}`)} />}
    </div>
  );
}

function AgregarMesas({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [cantidad, setCantidad] = useState("10");
  const [zona, setZona] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", "/mesas", { cantidad: Number(cantidad), zona: zona || undefined }); alGuardar(); }
    catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Agregar mesas" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="am-n">¿Cuántas?</label>
          <input id="am-n" className="entrada" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="campo"><label htmlFor="am-z">Zona (opcional)</label>
          <input id="am-z" className="entrada" placeholder="Salón, Terraza…" maxLength={40} value={zona} onChange={(e) => setZona(e.target.value)} /></div>
        <p className="muted" style={{ fontSize: 13 }}>Se numeran solas a continuación de las que ya tienes.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!Number(cantidad)}>Agregar {cantidad || 0} mesas</button>
      </form>
    </Dialogo>
  );
}

function CuentaSinMesa({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (id: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { const r = await api<{ id: string }>("POST", "/cuentas", { nombre }); alCrear(r.id); } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Cuenta sin mesa" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="cs-n">¿A nombre de quién?</label>
          <input id="cs-n" className="entrada" placeholder="Juan, Barra 2, Para llevar…" maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!nombre.trim()}>Abrir cuenta</button>
      </form>
    </Dialogo>
  );
}
