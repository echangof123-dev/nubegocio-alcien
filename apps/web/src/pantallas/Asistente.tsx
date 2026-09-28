import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { dinero } from "../formato";

interface Respuesta {
  texto: string;
  filas?: { etiqueta: string; valor: string }[];
  accion?: { tipo: "venta" | "venta_libre" | "gasto" | "ir"; texto: string; [k: string]: unknown };
  sugerencias?: string[];
}
interface Mensaje { de: "yo" | "asistente"; texto: string; respuesta?: Respuesta; hecho?: boolean }

const INICIO: Respuesta = {
  texto: "¡Hola! Pregúntame por tus ventas, ganancias, gastos, deudas o stock. También puedo anotar ventas y gastos por ti.",
  sugerencias: ["¿Cuánto vendí hoy?", "¿Cuánto gané este mes?", "¿Qué se está acabando?", "¿Quién me debe?", "Vendí 2 colas en efectivo", "Gasté 5 en taxi"],
};

/** Asistente virtual: preguntas del negocio en lenguaje normal; las ventas y gastos se confirman antes de guardar. */
export function Asistente({ info, avisar, navegar }: { info: InfoNegocio; avisar: (t: string) => void; navegar: (r: string) => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ de: "asistente", texto: INICIO.texto, respuesta: INICIO }]);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensajes]);

  async function enviar(t: string) {
    const limpio = t.trim();
    if (!limpio || ocupado) return;
    setTexto("");
    setMensajes((m) => [...m, { de: "yo", texto: limpio }]);
    setOcupado(true);
    try {
      const r = await api<{ respuesta: Respuesta }>("POST", "/asistente", { mensaje: limpio });
      setMensajes((m) => [...m, { de: "asistente", texto: r.respuesta.texto, respuesta: r.respuesta }]);
    } catch (e) {
      setMensajes((m) => [...m, { de: "asistente", texto: mensajeDe(e) }]);
    }
    setOcupado(false);
  }

  async function confirmar(i: number, a: NonNullable<Respuesta["accion"]>) {
    if (a.tipo === "ir") { navegar(String(a.ruta)); return; }
    try {
      let texto = "";
      if (a.tipo === "venta") {
        const r = await api<{ venta: { numero: number } }>("POST", "/ventas", { items: a.items, pagos: [{ metodo: a.metodo, monto: a.total }] });
        texto = `Listo: venta N.º ${r.venta.numero} por ${dinero(Number(a.total))}.`;
      } else if (a.tipo === "venta_libre") {
        const r = await api<{ venta: { numero: number } }>("POST", "/ventas/libre", { monto: a.monto, pagos: [{ metodo: a.metodo, monto: a.monto }] });
        texto = `Listo: venta N.º ${r.venta.numero} por ${dinero(Number(a.monto))}.`;
      } else if (a.tipo === "gasto") {
        await api("POST", "/gastos", { monto: a.monto, categoria: a.categoria, descripcion: a.descripcion ?? undefined, metodo: a.metodo });
        texto = `Listo: gasto de ${dinero(Number(a.monto))} en ${String(a.categoria).toLowerCase()}.`;
      }
      setMensajes((m) => [...m.map((x, j) => (j === i ? { ...x, hecho: true } : x)), { de: "asistente", texto }]);
      avisar(texto);
    } catch (e) {
      setMensajes((m) => [...m, { de: "asistente", texto: mensajeDe(e) }]);
    }
  }

  return (
    <div className="contenido chat" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Asistente</h1>
      <div className="chat-mensajes" aria-live="polite">
        {mensajes.map((m, i) => (
          <div key={i} className={`burbuja ${m.de}`}>
            <p>{m.texto}</p>
            {m.respuesta?.filas && (
              <div className="chat-filas">{m.respuesta.filas.map((f, k) => <div key={k} className="fila"><span>{f.etiqueta}</span><strong>{f.valor}</strong></div>)}</div>
            )}
            {m.respuesta?.accion && !m.hecho && (
              <div className="acciones-fila">
                <button className="boton pequeno" onClick={() => confirmar(i, m.respuesta!.accion!)}>{m.respuesta.accion.texto}</button>
                {m.respuesta.accion.tipo !== "ir" && <button className="boton texto pequeno" onClick={() => setMensajes((x) => x.map((y, j) => (j === i ? { ...y, hecho: true } : y)))}>No</button>}
              </div>
            )}
            {m.respuesta?.sugerencias && i === mensajes.length - 1 && (
              <div className="chips-envolver">{m.respuesta.sugerencias.map((s) => <button key={s} className="chip" onClick={() => enviar(s)}>{s}</button>)}</div>
            )}
          </div>
        ))}
        {ocupado && <div className="burbuja asistente"><p className="muted">…</p></div>}
        <div ref={fin} />
      </div>
      <form className="chat-entrada" onSubmit={(e: FormEvent) => { e.preventDefault(); void enviar(texto); }}>
        <label htmlFor="asis-texto" className="oculto">Escribe tu pregunta</label>
        <input id="asis-texto" className="entrada" placeholder={`Pregunta sobre ${info.negocio.nombre}…`} autoComplete="off" maxLength={300}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button className="boton" disabled={!texto.trim() || ocupado}>Enviar</button>
      </form>
    </div>
  );
}
