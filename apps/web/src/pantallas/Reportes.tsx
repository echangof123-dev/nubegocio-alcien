import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, hora } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { ISalir } from "../componentes/iconos";

interface VentaLista { id: string; numero: number; estado: string; total: number; creado_en: string; cliente: string | null; metodos: string | null }
interface Resumen { ventas: number; total: number; ticket_promedio: number; fiado_por_cobrar: number }

export function Reportes({ info, avisar, alSalir, alCambiarNegocio }: {
  info: InfoNegocio; avisar: (t: string) => void; alSalir: () => void; alCambiarNegocio?: () => void;
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [ventas, setVentas] = useState<VentaLista[]>([]);
  const [anular, setAnular] = useState<VentaLista | null>(null);

  const cargar = useCallback(() => {
    Promise.all([
      api<{ resumen: Resumen }>("GET", "/resumen/hoy"),
      api<{ ventas: VentaLista[] }>("GET", "/ventas"),
    ]).then(([r, v]) => { setResumen(r.resumen); setVentas(v.ventas); }).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  if (!resumen) return <Cargando />;
  const n = info.negocio;
  const diasPrueba = Math.max(0, Math.ceil((new Date(n.vence_en).getTime() - Date.now()) / 86_400_000));

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Hoy</h1>
      <div className="opciones" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Vendiste</span><span className="monto-grande">{dinero(resumen.total)}</span></div>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Ventas</span><span className="monto-grande">{resumen.ventas}</span></div>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Venta promedio</span><span className="monto-grande">{dinero(resumen.ticket_promedio)}</span></div>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Te deben</span><span className="monto-grande">{dinero(resumen.fiado_por_cobrar)}</span></div>
      </div>

      <div className="tarjeta" style={{ padding: "12px 16px" }}>
        <h3>Ventas de hoy</h3>
        <div className="tabla-simple">
          {ventas.map((v) => (
            <div key={v.id} className="fila">
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className={v.estado === "anulada" ? "anulada" : ""}><strong>N.º {v.numero}</strong> · {hora(v.creado_en)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{v.estado === "anulada" ? "Anulada" : `${v.metodos ?? ""}${v.cliente ? ` · ${v.cliente}` : ""}`}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong className={v.estado === "anulada" ? "anulada" : ""}>{dinero(v.total)}</strong>
                {v.estado !== "anulada" && puedeGestionar(info.rol) && (
                  <button className="boton texto pequeno" onClick={() => setAnular(v)}>Anular</button>
                )}
              </span>
            </div>
          ))}
          {ventas.length === 0 && <p className="muted">Todavía no hay ventas hoy.</p>}
        </div>
      </div>

      <div className="tarjeta">
        <h3>{n.nombre}</h3>
        <p className="muted">{n.tipo} · Plan {n.plan_vigente}{n.suscripcion === "prueba" ? ` · prueba: quedan ${diasPrueba} días` : ""}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {alCambiarNegocio && <button className="boton secundario pequeno" onClick={alCambiarNegocio}>Cambiar de negocio</button>}
          <button className="boton peligro pequeno" onClick={alSalir}><ISalir tam={18} /> Salir</button>
        </div>
      </div>

      {anular && <DialogoAnular venta={anular} alCerrar={() => setAnular(null)} alAnular={() => { setAnular(null); avisar("Venta anulada"); cargar(); }} />}
    </div>
  );
}

function DialogoAnular({ venta, alCerrar, alAnular }: { venta: VentaLista; alCerrar: () => void; alAnular: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function confirmar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", `/ventas/${venta.id}/anular`, { motivo }); alAnular(); } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Anular venta N.º ${venta.numero}`} alCerrar={alCerrar}>
      <form onSubmit={confirmar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">Se devuelven los productos al inventario y la venta deja de contar en la caja.</p>
        <div className="campo">
          <label htmlFor="motivo">Motivo</label>
          <input id="motivo" className="entrada" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton peligro bloque" disabled={motivo.trim().length < 3}>Anular venta de {dinero(venta.total)}</button>
      </form>
    </Dialogo>
  );
}
