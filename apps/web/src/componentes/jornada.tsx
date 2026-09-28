/** Jornada: cada empleado marca su entrada y su salida; el dueño ve horas y ventas de cada uno. */
import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "../api";
import { dinero } from "../formato";
import { diaLocal, horaCorta, sumarDias } from "./servicios";

export function MiJornada({ avisar }: { avisar: (t: string) => void }) {
  const [abierta, setAbierta] = useState<{ entrada: string } | null | undefined>(undefined);
  const cargar = useCallback(() => {
    api<{ abierta: { entrada: string } | null }>("GET", "/jornada").then((r) => setAbierta(r.abierta)).catch(() => setAbierta(null));
  }, []);
  useEffect(cargar, [cargar]);
  async function marcar() {
    try {
      const r = await api<{ jornada: { estado: string; horas?: number } }>("POST", "/jornada", {});
      avisar(r.jornada.estado === "entrada" ? "Entrada marcada" : `Salida marcada · ${String(r.jornada.horas).replace(".", ",")} horas`);
      cargar();
    } catch (e) { avisar(mensajeDe(e)); }
  }
  if (abierta === undefined) return null;
  return (
    <div className="tarjeta fila" style={{ gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <strong>Mi jornada</strong>
        <span className="muted" style={{ fontSize: 13 }}>{abierta ? `Entraste a las ${horaCorta(abierta.entrada)}` : "No has marcado entrada hoy"}</span>
      </div>
      <button className={`boton pequeno ${abierta ? "peligro" : ""}`} onClick={marcar}>{abierta ? "Marcar salida" : "Marcar entrada"}</button>
    </div>
  );
}

interface Fila { id: string; nombre: string; rol: string; horas: number; jornadas: number; trabajando: boolean; ventas: number; vendido: number; anulaciones: number }

export function HorarioEquipo() {
  const [dias, setDias] = useState(7);
  const [datos, setDatos] = useState<{ equipo: Fila[]; jornadas: { id: number; nombre: string; entrada: string; salida: string | null }[] } | null>(null);
  useEffect(() => {
    const hasta = diaLocal();
    api<NonNullable<typeof datos>>("GET", `/jornadas?desde=${sumarDias(hasta, -(dias - 1))}&hasta=${hasta}`).then(setDatos).catch(() => {});
  }, [dias]);
  if (!datos) return null;
  return (
    <div className="tarjeta" style={{ padding: "4px 16px" }}>
      <div className="fila" style={{ paddingTop: 12 }}>
        <h3>Horario y ventas del equipo</h3>
        <select className="entrada" style={{ width: "auto" }} aria-label="Periodo" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={1}>Hoy</option><option value={7}>7 días</option><option value={30}>30 días</option>
        </select>
      </div>
      {datos.equipo.map((f) => (
        <div key={f.id} className="movimiento">
          <div className="textos">
            <strong>{f.nombre}{f.trabajando ? " · trabajando" : ""}</strong>
            <span>{String(f.horas).replace(".", ",")} h en {f.jornadas} {f.jornadas === 1 ? "jornada" : "jornadas"} · {f.ventas} ventas{f.anulaciones ? ` · ${f.anulaciones} anuladas` : ""}</span>
          </div>
          <strong>{dinero(Number(f.vendido))}</strong>
        </div>
      ))}
      {datos.jornadas.length > 0 && (
        <details style={{ padding: "8px 0 12px" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Entradas y salidas</summary>
          {datos.jornadas.map((j) => (
            <div key={j.id} className="fila" style={{ fontSize: 13, padding: "4px 0" }}>
              <span>{j.nombre}</span>
              <span className="muted">{new Date(j.entrada).toLocaleDateString("es-EC", { day: "numeric", month: "short" })} {horaCorta(j.entrada)} – {j.salida ? horaCorta(j.salida) : "…"}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
