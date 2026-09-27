import { useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import { Aviso } from "../componentes/basicos";
import { IBuscar, IChispa, ICheckCirculo, ITienda, IVolver } from "../componentes/iconos";

interface Tipo { codigo: string; nombre: string; familia: string; familia_nombre?: string }

export function Registro({ alCrear, alVolver }: { alCrear: (negocioId: string) => void; alVolver?: () => void }) {
  const [paso, setPaso] = useState<"tipo" | "describir" | "nombre">("tipo");
  const [texto, setTexto] = useState("");
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [elegido, setElegido] = useState<Tipo | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Sugerencias mientras escribe (con una pausa corta para no consultar en cada letra)
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) { setTipos([]); return; }
    const t = setTimeout(() => {
      api<{ tipos: Tipo[] }>("GET", "/tipos-negocio?q=" + encodeURIComponent(q))
        .then((r) => setTipos(r.tipos))
        .catch(() => setTipos([]));
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);

  async function describir(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const r = await api<{ tipo: Tipo }>("POST", "/tipos-negocio/sugerir", { descripcion });
      setElegido(r.tipo);
      setPaso("nombre");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!elegido) return;
    setError(null);
    setOcupado(true);
    try {
      const r = await api<{ id: string }>("POST", "/negocios", { tipo: elegido.codigo, nombre });
      alCrear(r.id);
    } catch (err) {
      setError(mensajeDe(err));
      setOcupado(false);
    }
  }

  const avance = paso === "nombre" ? 90 : 60;

  return (
    <main className="pagina-simple">
      <div className="fila" style={{ justifyContent: "flex-start" }}>
        {(paso !== "tipo" || alVolver) && (
          <button className="icono-boton" aria-label="Volver" onClick={() => {
            setError(null);
            if (paso === "tipo") alVolver?.(); else setPaso("tipo");
          }}><IVolver /></button>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="etiqueta">Paso {paso === "nombre" ? 3 : 2} de 3</span>
          <div className="progreso"><div style={{ width: `${avance}%` }} /></div>
        </div>
      </div>

      {paso === "tipo" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1>¿Qué negocio tienes?</h1>
            <p className="muted">Escríbelo como lo dirías. Dejamos todo listo para ti.</p>
          </div>
          <div className="campo">
            <label htmlFor="tipo">Tipo de negocio</label>
            <div className="con-icono">
              <IBuscar tam={20} />
              <input id="tipo" className="entrada" autoComplete="off" placeholder="Tienda, cevichería, ferretería…"
                value={texto} onChange={(e) => setTexto(e.target.value)} />
            </div>
          </div>
          <div className="lista-opciones" role="list">
            {tipos.map((t) => (
              <button key={t.codigo} role="listitem" className={`item-opcion${elegido?.codigo === t.codigo ? " activo" : ""}`}
                onClick={() => { setElegido(t); setPaso("nombre"); }}>
                <span className="icono-tipo"><ITienda tam={20} /></span>
                <span className="textos"><strong>{t.nombre}</strong><span>{t.familia_nombre}</span></span>
              </button>
            ))}
          </div>
          {texto.trim().length >= 3 && (
            <Aviso tipo="info">
              ¿No lo encuentras?{" "}
              <button className="boton texto" style={{ padding: 0, minHeight: 0, display: "inline" }}
                onClick={() => { setDescripcion(texto); setPaso("describir"); }}>
                Descríbelo con tus palabras
              </button>{" "}
              y lo armamos contigo.
            </Aviso>
          )}
        </>
      )}

      {paso === "describir" && (
        <form onSubmit={describir} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1>Cuéntanos de tu negocio</h1>
            <p className="muted">Qué vendes o qué servicio das. Con eso preparamos tus categorías y productos.</p>
          </div>
          <div className="campo">
            <label htmlFor="descripcion">Tu negocio</label>
            <textarea id="descripcion" className="entrada" rows={3} style={{ paddingTop: 12 }} maxLength={200}
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={ocupado || descripcion.trim().length < 3}>
            <IChispa tam={20} /> {ocupado ? "Preparando…" : "Preparar mi negocio"}
          </button>
        </form>
      )}

      {paso === "nombre" && elegido && (
        <form onSubmit={crear} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1>¿Cómo se llama tu negocio?</h1>
            <p className="muted">Así aparecerá en tus comprobantes.</p>
          </div>
          <div className="aviso info">
            <ICheckCirculo />
            <div><strong>{elegido.nombre}</strong><br /><span className="muted">Te cargamos categorías y productos de ejemplo. Los cambias cuando quieras.</span></div>
          </div>
          <div className="campo">
            <label htmlFor="nombre">Nombre del negocio</label>
            <input id="nombre" className="entrada" maxLength={120} placeholder="Tienda Doña Rosa"
              value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={ocupado || nombre.trim().length < 2}>
            {ocupado ? "Creando…" : "Crear mi negocio"}
          </button>
        </form>
      )}
    </main>
  );
}
