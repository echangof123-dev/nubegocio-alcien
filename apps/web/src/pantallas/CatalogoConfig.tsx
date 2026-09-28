import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando } from "../componentes/basicos";

interface Config { slug: string; activo: boolean; whatsapp: string | null; mensaje: string | null; mostrar_agotados: boolean; acepta_pedidos: boolean; costo_envio: number | null }

/** Catálogo en línea: una página para compartir, con pedidos que entran a Pedidos. */
export function CatalogoConfig({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ config: Config | null; ocultos: string[]; sugerido: string } | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [d, setD] = useState({ slug: "", whatsapp: "", mensaje: "", costo_envio: "", acepta_pedidos: true, mostrar_agotados: false, activo: true });
  const [error, setError] = useState<string | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<{ config: Config | null; ocultos: string[]; sugerido: string }>("GET", "/catalogo/config").then((r) => {
      setDatos(r);
      const c = r.config;
      setD({
        slug: c?.slug ?? r.sugerido, whatsapp: c?.whatsapp ?? "", mensaje: c?.mensaje ?? "",
        costo_envio: c?.costo_envio != null ? String(c.costo_envio).replace(".", ",") : "",
        acepta_pedidos: c?.acepta_pedidos ?? true, mostrar_agotados: c?.mostrar_agotados ?? false, activo: c?.activo ?? true,
      });
    }).catch((e) => setError(mensajeDe(e)));
    api<{ productos: Producto[] }>("GET", "/productos").then((r) => setProductos(r.productos.filter((p) => p.precio !== null))).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("POST", "/catalogo/config", { ...d, whatsapp: d.whatsapp || undefined, mensaje: d.mensaje || undefined, costo_envio: parsearNumero(d.costo_envio) ?? undefined });
      avisar("Catálogo guardado");
      cargar();
    } catch (err) { setError(mensajeDe(err)); }
  }

  async function ocultar(p: Producto, oculto: boolean) {
    try { await api("POST", "/catalogo/ocultos", { producto_id: p.id, oculto }); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  if (!datos) return error ? <div className="contenido"><Aviso tipo="error">{error}</Aviso></div> : <Cargando />;
  const enlace = datos.config ? `${location.origin}/t/${datos.config.slug}` : null;

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Catálogo en línea</h1>
      {enlace && (
        <div className="tarjeta">
          <span className="muted" style={{ fontSize: 13 }}>Tu catálogo</span>
          <a href={enlace} target="_blank" rel="noopener" style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{enlace}</a>
          <div className="acciones-fila">
            <a className="boton pequeno" href={`https://wa.me/?text=${encodeURIComponent(`Mira nuestro catálogo y haz tu pedido: ${enlace}`)}`} target="_blank" rel="noopener">Compartir por WhatsApp</a>
            <button className="boton pequeno secundario" onClick={() => { navigator.clipboard?.writeText(enlace).then(() => avisar("Enlace copiado")).catch(() => {}); }}>Copiar enlace</button>
          </div>
        </div>
      )}
      {gestiona && (
        <form className="tarjeta" onSubmit={guardar}>
          <div className="campo"><label htmlFor="cat-slug">Dirección</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="muted" style={{ fontSize: 14, whiteSpace: "nowrap" }}>/t/</span>
              <input id="cat-slug" className="entrada" maxLength={40} value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
            </div></div>
          <div className="campo"><label htmlFor="cat-wa">WhatsApp donde recibes los pedidos</label>
            <input id="cat-wa" className="entrada" type="tel" placeholder="09…" value={d.whatsapp} onChange={(e) => setD({ ...d, whatsapp: e.target.value })} /></div>
          <div className="campo"><label htmlFor="cat-msg">Mensaje de bienvenida (opcional)</label>
            <input id="cat-msg" className="entrada" maxLength={300} placeholder="Envíos a toda la ciudad" value={d.mensaje} onChange={(e) => setD({ ...d, mensaje: e.target.value })} /></div>
          <CampoMonto id="cat-envio" etiqueta="Costo de envío a domicilio (opcional)" valor={d.costo_envio} alCambiar={(v) => setD({ ...d, costo_envio: v })} />
          <label className="casilla"><input type="checkbox" checked={d.acepta_pedidos} onChange={(e) => setD({ ...d, acepta_pedidos: e.target.checked })} /> Recibir pedidos desde el catálogo</label>
          <label className="casilla"><input type="checkbox" checked={d.mostrar_agotados} onChange={(e) => setD({ ...d, mostrar_agotados: e.target.checked })} /> Mostrar productos agotados</label>
          <label className="casilla"><input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} /> Catálogo publicado</label>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton">{datos.config ? "Guardar cambios" : "Publicar catálogo"}</button>
        </form>
      )}
      {datos.config && (
        <div className="tarjeta" style={{ padding: "12px 16px" }}>
          <h3>Qué se muestra</h3>
          {productos.map((p) => {
            const oculto = datos.ocultos.includes(p.id);
            return (
              <label key={p.id} className="casilla" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)" }}>
                <span className={oculto ? "anulada" : ""}>{p.nombre} · {dinero(p.precio)}</span>
                <input type="checkbox" disabled={!gestiona} checked={!oculto} onChange={(e) => ocultar(p, !e.target.checked)} aria-label={`Mostrar ${p.nombre}`} />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
