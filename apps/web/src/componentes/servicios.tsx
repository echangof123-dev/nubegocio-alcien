/** Piezas comunes de las pantallas de servicios (agenda, órdenes, reservas, membresías). */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Cliente } from "../tipos";
import { ElegirCliente } from "../pantallas/Cobrar";

export interface Profesional { id: string; nombre: string; celular: string | null; comision_pct: number; color: string; activo: boolean; por_pagar: number }

/** Enlace de WhatsApp a un celular ecuatoriano (09… → 5939…). */
export function enlaceWa(celular: string | null | undefined, texto: string): string | null {
  const n = (celular ?? "").replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593");
  return /^\d{10,15}$/.test(n) ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : null;
}

/** Fecha local AAAA-MM-DD (Ecuador), sin pasar por UTC. */
export function diaLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function sumarDias(dia: string, n: number): string {
  const d = new Date(dia + "T12:00:00");
  d.setDate(d.getDate() + n);
  return diaLocal(d);
}
export const nombreDia = (dia: string) =>
  new Date(dia + "T12:00:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" });
export const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
/** "2030-05-10" + "15:30" → ISO con la zona del teléfono. */
export const aIso = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00`).toISOString();

export function useProfesionales() {
  const [lista, setLista] = useState<Profesional[]>([]);
  useEffect(() => {
    api<{ profesionales: Profesional[] }>("GET", "/profesionales").then((r) => setLista(r.profesionales.filter((p) => p.activo))).catch(() => {});
  }, []);
  return lista;
}

/** Nombre y celular escritos a mano, o un cliente guardado. */
export function DatosCliente({ id, cliente, setCliente, nombre, setNombre, celular, setCelular }: {
  id: string; cliente: Cliente | null; setCliente: (c: Cliente | null) => void;
  nombre: string; setNombre: (v: string) => void; celular: string; setCelular: (v: string) => void;
}) {
  const [elegir, setElegir] = useState(false);
  if (cliente) {
    return (
      <div className="item-opcion activo">
        <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.celular ?? ""}</span></span>
        <button type="button" className="boton texto" onClick={() => setCliente(null)}>Quitar</button>
      </div>
    );
  }
  return (
    <>
      <div className="rejilla-2">
        <div className="campo"><label htmlFor={`${id}-nombre`}>Nombre del cliente</label>
          <input id={`${id}-nombre`} className="entrada" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor={`${id}-cel`}>Celular</label>
          <input id={`${id}-cel`} className="entrada" type="tel" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
      </div>
      <button type="button" className="boton texto" style={{ alignSelf: "flex-start" }} onClick={() => setElegir(true)}>Elegir un cliente guardado</button>
      {elegir && <ElegirCliente alCerrar={() => setElegir(false)} alElegir={(c) => { setCliente(c); setElegir(false); }} />}
    </>
  );
}
