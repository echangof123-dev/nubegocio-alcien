import { useEffect, useState, type FormEvent } from "react";
import { dinero } from "../formato";
import { fotoComprimida } from "../componentes/foto";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { Aviso } from "../componentes/basicos";
import { ISalir } from "../componentes/iconos";
import { guardarImpresora, impresoraGuardada, type Impresora } from "../componentes/recibo";

const METODOS: [string, string][] = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["deuna", "DeUna"]];

/** Ajustes del negocio: datos del recibo, impresora, formas de pago, IVA e inventario. */
export function Ajustes({ info, avisar, alCambiar, alSalir, alCambiarNegocio, alElegirNegocio, navegar }: {
  info: InfoNegocio; avisar: (t: string) => void; alCambiar: () => void; alSalir: () => void; alCambiarNegocio?: () => void;
  alElegirNegocio?: (id: string) => void; navegar: (r: string) => void;
}) {
  const [negocios, setNegocios] = useState<{ negocio_id: string; nombre: string; rol: string; ventas: number | null; total: number | null; mes?: number }[] | null>(null);
  useEffect(() => {
    if (alCambiarNegocio) api<{ negocios: NonNullable<typeof negocios> }>("GET", "/mis-negocios/resumen").then((r) => setNegocios(r.negocios)).catch(() => {});
  }, [alCambiarNegocio]);
  const [logo, setLogo] = useState(info.negocio.logo_version ?? null);
  async function subirLogo(f: File | undefined) {
    if (!f) return;
    try {
      const datos = await fotoComprimida(f, 320);
      const r = await api<{ logo_version: number }>("POST", "/negocio/logo", { tipo: "image/jpeg", datos });
      setLogo(r.logo_version); avisar("Logo guardado"); alCambiar();
    } catch (e) { avisar(mensajeDe(e)); }
  }
  const n = info.negocio;
  const gestiona = puedeGestionar(info.rol);
  const [d, setD] = useState({
    direccion: n.direccion ?? "", telefono: n.telefono ?? "", mensaje_recibo: n.mensaje_recibo ?? "",
    metodos_pago: n.metodos_pago, iva_defecto: String(n.iva_defecto), permite_vender_sin_stock: n.permite_vender_sin_stock,
    exige_caja_abierta: n.exige_caja_abierta,
  });
  const [impresora, setImpresora] = useState<Impresora>(impresoraGuardada());
  const [error, setError] = useState<string | null>(null);
  const diasPrueba = Math.max(0, Math.ceil((new Date(n.vence_en).getTime() - Date.now()) / 86_400_000));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("PATCH", "/negocio/config", { ...d, direccion: d.direccion || null, telefono: d.telefono || null, mensaje_recibo: d.mensaje_recibo || null, iva_defecto: Number(d.iva_defecto) });
      avisar("Ajustes guardados");
      alCambiar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  const alternar = (m: string) => setD({ ...d, metodos_pago: d.metodos_pago.includes(m) ? d.metodos_pago.filter((x) => x !== m) : [...d.metodos_pago, m] });

  return (
    <div className="contenido" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <h1>Ajustes</h1>
      <div className="tarjeta" style={{ gap: 8 }}>
        <h3>Impresora de recibos</h3>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Este teléfono o computadora imprime en:</p>
        <div className="opciones" role="group" aria-label="Tamaño de papel">
          {([["58", "58 mm"], ["80", "80 mm"], ["carta", "Hoja normal"]] as const).map(([k, t]) => (
            <button type="button" key={k} className={`opcion${impresora === k ? " activa" : ""}`} aria-pressed={impresora === k}
              onClick={() => { setImpresora(k); guardarImpresora(k); avisar("Impresora guardada"); }}>{t}</button>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Con una impresora térmica Bluetooth o USB, emparéjala con el teléfono y elígela al imprimir.</p>
      </div>

      {gestiona && (
        <form className="tarjeta" onSubmit={guardar} style={{ gap: 12 }}>
          <h3>Datos del recibo</h3>
          <div className="foto-producto">
            {logo ? <img src={`/api/logo/${n.id}?v=${logo}`} alt="Logo del negocio" style={{ objectFit: "contain", background: "#fff" }} /> : <span className="sin-foto">Sin logo</span>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="boton pequeno secundario" htmlFor="aj-logo" style={{ cursor: "pointer" }}>{logo ? "Cambiar logo" : "Subir logo"}</label>
              <input id="aj-logo" className="oculto" type="file" accept="image/*" onChange={(e) => { void subirLogo(e.target.files?.[0]); e.target.value = ""; }} />
              {logo ? <button type="button" className="boton texto pequeno" onClick={async () => { await api("DELETE", "/negocio/logo").catch(() => {}); setLogo(null); alCambiar(); }}>Quitar logo</button> : null}
              <span className="muted" style={{ fontSize: 12 }}>Sale en el recibo y en tu catálogo en línea.</span>
            </div>
          </div>
          <div className="campo"><label htmlFor="aj-dir">Dirección</label>
            <input id="aj-dir" className="entrada" maxLength={300} value={d.direccion} onChange={(e) => setD({ ...d, direccion: e.target.value })} /></div>
          <div className="campo"><label htmlFor="aj-tel">Teléfono</label>
            <input id="aj-tel" className="entrada" type="tel" maxLength={30} value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} /></div>
          <div className="campo"><label htmlFor="aj-msg">Mensaje al final del recibo</label>
            <input id="aj-msg" className="entrada" maxLength={200} placeholder="¡Gracias por su compra!" value={d.mensaje_recibo} onChange={(e) => setD({ ...d, mensaje_recibo: e.target.value })} /></div>

          <h3>Formas de pago</h3>
          <div className="opciones" role="group" aria-label="Formas de pago">
            {METODOS.map(([k, t]) => (
              <button type="button" key={k} className={`opcion${d.metodos_pago.includes(k) ? " activa" : ""}`} aria-pressed={d.metodos_pago.includes(k)} onClick={() => alternar(k)}>{t}</button>
            ))}
          </div>

          <h3>Impuestos e inventario</h3>
          <div className="campo"><label htmlFor="aj-iva">IVA de tus productos (si no tienen uno propio)</label>
            <select id="aj-iva" className="entrada" value={d.iva_defecto} onChange={(e) => setD({ ...d, iva_defecto: e.target.value })}>
              {["15", "8", "5", "0"].map((x) => <option key={x} value={x}>{x} %</option>)}
            </select></div>
          <label className="casilla"><input type="checkbox" checked={d.permite_vender_sin_stock} onChange={(e) => setD({ ...d, permite_vender_sin_stock: e.target.checked })} /> Permitir vender aunque no haya stock</label>
          <label className="casilla"><input type="checkbox" checked={d.exige_caja_abierta} onChange={(e) => setD({ ...d, exige_caja_abierta: e.target.checked })} /> Pedir abrir la caja antes de vender</label>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={d.metodos_pago.length === 0}>Guardar ajustes</button>
        </form>
      )}

      {negocios && negocios.length > 1 && (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          <h3 style={{ paddingTop: 12 }}>Tus negocios y sucursales</h3>
          {negocios.map((x) => (
            <div key={x.negocio_id} className="movimiento">
              <div className="textos">
                <strong>{x.nombre}{x.negocio_id === n.id ? " (abierto)" : ""}</strong>
                <span>{x.total !== null ? `Hoy ${dinero(x.total)} en ${x.ventas} ventas · este mes ${dinero(x.mes ?? 0)}` : "Eres parte del equipo"}</span>
              </div>
              {x.negocio_id !== n.id && alElegirNegocio && <button className="boton pequeno secundario" onClick={() => alElegirNegocio(x.negocio_id)}>Abrir</button>}
            </div>
          ))}
        </div>
      )}
      <div className="tarjeta" style={{ gap: 8 }}>
        <h3>{n.nombre}</h3>
        <p className="muted" style={{ margin: 0 }}>{n.tipo} · Plan {n.plan_vigente}{n.suscripcion === "prueba" ? ` · prueba: quedan ${diasPrueba} días` : ""}</p>
        <div className="acciones-fila">
          {gestiona && <button className="boton secundario pequeno" onClick={() => navegar("/modulos")}>Módulos</button>}
          {gestiona && <button className="boton secundario pequeno" onClick={() => navegar("/equipo")}>Equipo</button>}
          {alCambiarNegocio && <button className="boton secundario pequeno" onClick={alCambiarNegocio}>Cambiar de negocio</button>}
          <button className="boton secundario pequeno" onClick={() => navegar("/nuevo-negocio")}>Crear otro negocio o sucursal</button>
        </div>
        <button className="boton peligro" onClick={alSalir}><ISalir tam={18} /> Salir</button>
      </div>
    </div>
  );
}
