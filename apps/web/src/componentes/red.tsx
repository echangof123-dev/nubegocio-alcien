/** Aviso de "sin internet" y de ventas guardadas en el teléfono que faltan por enviar. */
import { useEffect, useState } from "react";
import { descartarPendiente, hayRed, sincronizarVentas, ventasPendientes, type VentaPendiente } from "../api";
import { dinero } from "../formato";
import { Dialogo } from "./basicos";

export function AvisoRed({ avisar }: { avisar: (t: string) => void }) {
  const [red, setRed] = useState(hayRed() && navigator.onLine !== false);
  const [pendientes, setPendientes] = useState<VentaPendiente[]>(ventasPendientes());
  const [ver, setVer] = useState(false);

  useEffect(() => {
    const alRed = (e: Event) => setRed((e as CustomEvent<boolean>).detail);
    const alPendientes = () => setPendientes(ventasPendientes());
    const intentar = async () => {
      if (!ventasPendientes().length) return;
      const n = await sincronizarVentas();
      if (n > 0) avisar(n === 1 ? "Se envió 1 venta hecha sin internet" : `Se enviaron ${n} ventas hechas sin internet`);
    };
    const enLinea = () => { setRed(true); void intentar(); };
    const sinLinea = () => setRed(false);
    window.addEventListener("alcien:red", alRed);
    window.addEventListener("alcien:pendientes", alPendientes);
    window.addEventListener("online", enLinea);
    window.addEventListener("offline", sinLinea);
    void intentar();
    const t = window.setInterval(intentar, 60_000);
    return () => {
      window.removeEventListener("alcien:red", alRed);
      window.removeEventListener("alcien:pendientes", alPendientes);
      window.removeEventListener("online", enLinea);
      window.removeEventListener("offline", sinLinea);
      window.clearInterval(t);
    };
  }, [avisar]);

  const conError = pendientes.filter((p) => p.error);
  if (red && !pendientes.length) return null;
  return (
    <>
      <button className={`aviso-red${!red ? " sin-red" : ""}`} onClick={() => setVer(true)}>
        {!red ? "Sin internet · puedes seguir vendiendo" : ""}
        {!red && pendientes.length ? " · " : ""}
        {pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? "venta" : "ventas"} por enviar` : ""}
        {conError.length ? ` (${conError.length} con problema)` : ""}
      </button>
      {ver && (
        <Dialogo titulo="Ventas hechas sin internet" alCerrar={() => setVer(false)}>
          {pendientes.length === 0 ? <p className="muted">No hay ventas por enviar.</p> : pendientes.map((p) => (
            <div key={p.clave} className="movimiento">
              <div className="textos">
                <strong>{dinero(p.total)}</strong>
                <span>{new Date(p.creada).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })}</span>
                {p.error && <span style={{ color: "var(--danger)" }}>{p.error}</span>}
              </div>
              {p.error && <button className="boton texto pequeno" onClick={() => { descartarPendiente(p.clave); setPendientes(ventasPendientes()); }}>Descartar</button>}
            </div>
          ))}
          <button className="boton bloque" disabled={!red} onClick={async () => { const n = await sincronizarVentas(); setPendientes(ventasPendientes()); avisar(`${n} enviadas`); }}>
            {red ? "Enviar ahora" : "Esperando señal…"}
          </button>
        </Dialogo>
      )}
    </>
  );
}
