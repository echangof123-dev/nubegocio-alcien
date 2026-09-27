import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio, Producto } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, fecha, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { ElegirCliente } from "./Cobrar";

interface CotizacionLista {
  id: string; numero: number; estado: "abierta" | "aceptada" | "anulada"; total: number; valida_hasta: string;
  creado_en: string; token_publico: string; cliente: string | null; celular: string | null; vencida: boolean;
}

const enlace = (c: { token_publico: string }) => `${location.origin}/api/q/${c.token_publico}`;
function whatsapp(c: CotizacionLista, negocio: string) {
  const texto = `Hola${c.cliente ? ` ${c.cliente}` : ""}, te comparto la cotización N.º ${c.numero} de ${negocio}: ${enlace(c)}`;
  const numero = (c.celular ?? "").replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593");
  return `https://wa.me/${/^\d{10,15}$/.test(numero) ? numero : ""}?text=${encodeURIComponent(texto)}`;
}

export function Cotizaciones({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [lista, setLista] = useState<CotizacionLista[] | null>(null);
  const [nueva, setNueva] = useState(false);
  const [vender, setVender] = useState<CotizacionLista | null>(null);

  const cargar = useCallback(() => {
    api<{ cotizaciones: CotizacionLista[] }>("GET", "/cotizaciones").then((r) => setLista(r.cotizaciones)).catch(() => setLista([]));
  }, []);
  useEffect(cargar, [cargar]);

  async function anular(c: CotizacionLista) {
    try { await api("POST", `/cotizaciones/${c.id}/anular`); avisar("Cotización anulada"); cargar(); } catch (e) { avisar(mensajeDe(e)); }
  }

  if (!lista) return <Cargando />;
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Cotizaciones</h1>
      <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Nueva cotización</button>
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {lista.map((c) => (
          <div key={c.id} className="comprobante-fila">
            <div className="textos">
              <strong className={c.estado === "anulada" ? "anulada" : ""}>N.º {c.numero}{c.cliente ? ` · ${c.cliente}` : ""}</strong>
              <span>{fecha(c.creado_en)} · válida hasta {fecha(c.valida_hasta + "T12:00:00")}</span>
              <div className="acciones-fila" style={{ marginTop: 4 }}>
                <a className="boton texto pequeno" href={enlace(c)} target="_blank" rel="noopener">Ver</a>
                {c.estado === "abierta" && <a className="boton texto pequeno" href={whatsapp(c, info.negocio.nombre)} target="_blank" rel="noopener">WhatsApp</a>}
                {c.estado === "abierta" && <button className="boton texto pequeno" onClick={() => setVender(c)}>Vender</button>}
                {c.estado === "abierta" && puedeGestionar(info.rol) && <button className="boton texto pequeno" onClick={() => anular(c)}>Anular</button>}
              </div>
            </div>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <strong>{dinero(c.total)}</strong>
              {c.estado === "aceptada" ? <span className="insignia ok">Vendida</span>
                : c.estado === "anulada" ? <span className="insignia gris">Anulada</span>
                : c.vencida ? <span className="insignia mal">Vencida</span> : <span className="insignia no">Abierta</span>}
            </span>
          </div>
        ))}
        {lista.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Arma una proforma, envíala por WhatsApp y, cuando el cliente acepte, conviértela en venta con un toque.</p>}
      </div>
      {nueva && <NuevaCotizacion alCerrar={() => setNueva(false)} alGuardar={(n) => { setNueva(false); avisar(`Cotización N.º ${n} lista para enviar`); cargar(); }} />}
      {vender && <VenderCotizacion info={info} cotizacion={vender} alCerrar={() => setVender(null)}
        alGuardar={(numero) => { setVender(null); avisar(`Venta N.º ${numero} registrada`); cargar(); }} />}
    </div>
  );
}

interface Linea { producto: Producto; cantidad: string; precio: string; descuento: string }

function NuevaCotizacion({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (numero: number) => void }) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [dias, setDias] = useState("15");
  const [nota, setNota] = useState("");
  const [elegir, setElegir] = useState(false);
  const [elegirCliente, setElegirCliente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = redondear(lineas.reduce((s, l) =>
    s + (parsearNumero(l.cantidad) ?? 0) * (parsearNumero(l.precio) ?? 0) - (parsearNumero(l.descuento) ?? 0), 0));
  const cambiar = (i: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ cotizacion: { numero: number } }>("POST", "/cotizaciones", {
        cliente_id: cliente?.id, dias_validez: Number(dias) || 15, nota: nota || undefined,
        items: lineas.map((l) => ({
          producto_id: l.producto.id, cantidad: parsearNumero(l.cantidad),
          precio: parsearNumero(l.precio) ?? undefined, descuento: parsearNumero(l.descuento) ?? undefined,
        })),
      });
      alGuardar(r.cotizacion.numero);
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo="Nueva cotización" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cliente ? (
          <div className="item-opcion activo">
            <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.celular ?? "Sin celular"}</span></span>
            <button type="button" className="boton texto" onClick={() => setCliente(null)}>Quitar</button>
          </div>
        ) : (
          <button type="button" className="boton secundario" onClick={() => setElegirCliente(true)}>Elegir cliente (opcional)</button>
        )}
        {lineas.map((l, i) => (
          <div key={l.producto.id} className="tarjeta" style={{ boxShadow: "none", border: "1px solid var(--border)", padding: 12, gap: 8 }}>
            <div className="fila">
              <strong>{l.producto.nombre}</strong>
              <button type="button" className="icono-boton" aria-label={`Quitar ${l.producto.nombre}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
            </div>
            <div className="rejilla-2">
              <CampoMonto id={`q-cant-${i}`} etiqueta="Cantidad" valor={l.cantidad} alCambiar={(v) => cambiar(i, "cantidad", v)} />
              <CampoMonto id={`q-precio-${i}`} etiqueta="Precio" valor={l.precio} alCambiar={(v) => cambiar(i, "precio", v)} />
            </div>
            <CampoMonto id={`q-desc-${i}`} etiqueta="Descuento (opcional)" valor={l.descuento} alCambiar={(v) => cambiar(i, "descuento", v)} />
          </div>
        ))}
        <button type="button" className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar producto</button>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="q-dias">Válida por (días)</label>
            <input id="q-dias" className="entrada" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="campo"><label htmlFor="q-nota">Nota (opcional)</label>
            <input id="q-nota" className="entrada" maxLength={500} placeholder="Tiempo de entrega, forma de pago…" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!lineas.length}>Guardar cotización de {dinero(total)}</button>
      </form>
      {elegir && (
        <SelectorProducto alCerrar={() => setElegir(false)} alElegir={(p) => {
          setElegir(false);
          if (!lineas.some((l) => l.producto.id === p.id)) {
            setLineas((ls) => [...ls, { producto: p, cantidad: "1", precio: p.precio !== null ? String(p.precio).replace(".", ",") : "", descuento: "" }]);
          }
        }} />
      )}
      {elegirCliente && <ElegirCliente alCerrar={() => setElegirCliente(false)} alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />}
    </Dialogo>
  );
}

function VenderCotizacion({ info, cotizacion, alCerrar, alGuardar }: {
  info: InfoNegocio; cotizacion: CotizacionLista; alCerrar: () => void; alGuardar: (numero: number) => void;
}) {
  const [metodo, setMetodo] = useState(info.negocio.metodos_pago[0] ?? "efectivo");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await api<{ venta: { numero: number } }>("POST", `/cotizaciones/${cotizacion.id}/vender`, {
        pagos: [{ metodo, monto: cotizacion.total }],
      });
      alGuardar(r.venta.numero);
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(false); }
  }
  const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna" };
  return (
    <Dialogo titulo={`Vender cotización N.º ${cotizacion.numero}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="monto-grande">{dinero(cotizacion.total)}</p>
        <div className="opciones">
          {info.negocio.metodos_pago.map((m) => (
            <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{NOMBRES[m] ?? m}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Se registra la venta con los precios cotizados y baja el stock. La caja debe estar abierta.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado}>{ocupado ? "Registrando…" : `Cobrar ${dinero(cotizacion.total)}`}</button>
      </form>
    </Dialogo>
  );
}
