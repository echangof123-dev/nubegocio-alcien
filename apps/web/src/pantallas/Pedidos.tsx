import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio, Producto } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { DialogoCobro } from "../componentes/DialogoCobro";
import { ElegirCliente } from "./Cobrar";

type Estado = "recibido" | "preparando" | "listo" | "en_camino" | "entregado" | "cancelado";
interface Pedido {
  id: string; numero: number; tipo: "retiro" | "domicilio"; canal: string; nombre: string; celular: string | null;
  direccion: string | null; referencia: string | null; costo_envio: number; hora_entrega: string | null; estado: Estado;
  repartidor: string | null; total: number; nota: string | null; cobrado: boolean; creado_en: string;
  items: { nombre: string; cantidad: number; nota: string | null }[];
}

const ESTADOS: Record<Estado, [string, string]> = {
  recibido: ["Recibido", "gris"], preparando: ["Preparando", "no"], listo: ["Listo", "ok"],
  en_camino: ["En camino", "no"], entregado: ["Entregado", "ok"], cancelado: ["Cancelado", "gris"],
};
const SIGUIENTE: Partial<Record<Estado, (p: Pedido) => Estado>> = {
  recibido: () => "preparando", preparando: () => "listo",
  listo: (p) => (p.tipo === "domicilio" ? "en_camino" : "entregado"), en_camino: () => "entregado",
};
const MENSAJE: Partial<Record<Estado, string>> = {
  preparando: "estamos preparando tu pedido", listo: "tu pedido está listo para retirar",
  en_camino: "tu pedido ya va en camino", entregado: "gracias por tu compra",
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

function whatsapp(p: Pedido, negocio: string) {
  const numero = (p.celular ?? "").replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593");
  const texto = `Hola ${p.nombre}, ${MENSAJE[p.estado] ?? "recibimos tu pedido"} (pedido N.º ${p.numero} de ${negocio}).`;
  return /^\d{10,15}$/.test(numero) ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

export function Pedidos({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [cobrar, setCobrar] = useState<Pedido | null>(null);

  const cargar = useCallback(() => {
    api<{ pedidos: Pedido[] }>("GET", "/pedidos").then((r) => setPedidos(r.pedidos)).catch(() => setPedidos([]));
  }, []);
  useEffect(() => {
    cargar();
    const t = window.setInterval(cargar, 20_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  async function estado(p: Pedido, e: Estado) {
    let repartidor: string | undefined;
    if (e === "en_camino") repartidor = window.prompt("¿Quién lo lleva? (opcional)") ?? undefined;
    try { await api("POST", `/pedidos/${p.id}/estado`, { estado: e, repartidor }); cargar(); } catch (err) { avisar(mensajeDe(err)); }
  }

  if (!pedidos) return <Cargando />;
  const activos = pedidos.filter((p) => p.estado !== "entregado" && p.estado !== "cancelado");
  const cerrados = pedidos.filter((p) => !activos.includes(p));

  const tarjeta = (p: Pedido) => {
    const sig = SIGUIENTE[p.estado]?.(p);
    const wa = whatsapp(p, info.negocio.nombre);
    return (
      <div key={p.id} className="tarjeta" style={{ gap: 8 }}>
        <div className="fila">
          <strong>N.º {p.numero} · {p.nombre}</strong>
          <span className={`insignia ${ESTADOS[p.estado][1]}`}>{ESTADOS[p.estado][0]}</span>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {p.tipo === "domicilio" ? `A domicilio: ${p.direccion}${p.referencia ? ` (${p.referencia})` : ""}` : "Retira en el local"}
          {p.hora_entrega ? ` · para las ${hora(p.hora_entrega)}` : ` · pedido a las ${hora(p.creado_en)}`}
          {p.repartidor ? ` · lo lleva ${p.repartidor}` : ""}
        </span>
        <span style={{ fontSize: 14 }}>{p.items.map((i) => `${fmtCantidad(i.cantidad)} × ${i.nombre}${i.nota ? ` (${i.nota})` : ""}`).join(" · ")}</span>
        {p.nota && <span className="muted" style={{ fontSize: 13 }}>Nota: {p.nota}</span>}
        <div className="fila">
          <strong>{dinero(p.total)}{p.costo_envio > 0 ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> (envío {dinero(p.costo_envio)})</span> : null}</strong>
          {p.cobrado ? <span className="insignia ok">Cobrado</span> : <span className="insignia no">Por cobrar</span>}
        </div>
        {p.estado !== "entregado" && p.estado !== "cancelado" && (
          <div className="acciones-fila">
            {sig && <button className="boton pequeno" onClick={() => estado(p, sig)}>{ESTADOS[sig][0]}</button>}
            {!p.cobrado && <button className="boton pequeno secundario" onClick={() => setCobrar(p)}>Cobrar</button>}
            {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">Avisar</a>}
            {!p.cobrado && <button className="boton texto pequeno" onClick={() => estado(p, "cancelado")}>Cancelar</button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Pedidos</h1>
      <button className="boton bloque" onClick={() => setNuevo(true)}><IMas tam={20} /> Nuevo pedido</button>
      {activos.length === 0 && <div className="vacio"><p>No hay pedidos en curso.</p></div>}
      {activos.map(tarjeta)}
      {cerrados.length > 0 && <><span className="etiqueta">Terminados hoy</span>{cerrados.map(tarjeta)}</>}
      {nuevo && <NuevoPedido alCerrar={() => setNuevo(false)} alGuardar={(n) => { setNuevo(false); avisar(`Pedido N.º ${n} recibido`); cargar(); }} />}
      {cobrar && (
        <DialogoCobro info={info} titulo={`Cobrar pedido N.º ${cobrar.numero}`} total={cobrar.total} conFiado={false}
          alCerrar={() => setCobrar(null)}
          cobrar={async (d) => {
            const r = await api<{ venta: { numero: number } }>("POST", `/pedidos/${cobrar.id}/cobrar`, { pagos: d.pagos, comprobante: d.comprobante });
            setCobrar(null);
            avisar(`Venta N.º ${r.venta.numero} registrada`);
            cargar();
          }} />
      )}
    </div>
  );
}

interface Linea { producto: Producto; cantidad: string; nota: string }

function NuevoPedido({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (numero: number) => void }) {
  const [tipo, setTipo] = useState<"retiro" | "domicilio">("retiro");
  const [canal, setCanal] = useState("whatsapp");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [direccion, setDireccion] = useState("");
  const [referencia, setReferencia] = useState("");
  const [envio, setEnvio] = useState("");
  const [horaEntrega, setHoraEntrega] = useState("");
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [elegir, setElegir] = useState(false);
  const [elegirCliente, setElegirCliente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = redondear(lineas.reduce((s, l) => s + (parsearNumero(l.cantidad) ?? 0) * (l.producto.precio ?? 0), 0));
  const total = redondear(subtotal + (tipo === "domicilio" ? parsearNumero(envio) ?? 0 : 0));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let hora: string | undefined;
    if (horaEntrega) {
      const d = new Date();
      const [hh, mm] = horaEntrega.split(":").map(Number);
      d.setHours(hh!, mm!, 0, 0);
      hora = d.toISOString();
    }
    try {
      const r = await api<{ pedido: { numero: number } }>("POST", "/pedidos", {
        tipo, canal, cliente_id: cliente?.id, nombre: nombre || cliente?.nombre, celular: celular || undefined,
        direccion: tipo === "domicilio" ? direccion || undefined : undefined, referencia: referencia || undefined,
        costo_envio: tipo === "domicilio" ? parsearNumero(envio) ?? 0 : 0, hora_entrega: hora, nota: nota || undefined,
        items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: parsearNumero(l.cantidad), nota: l.nota || undefined })),
      });
      alGuardar(r.pedido.numero);
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo="Nuevo pedido" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="opciones">
          <button type="button" className={`opcion${tipo === "retiro" ? " activa" : ""}`} onClick={() => setTipo("retiro")}>Retira en el local</button>
          <button type="button" className={`opcion${tipo === "domicilio" ? " activa" : ""}`} onClick={() => setTipo("domicilio")}>A domicilio</button>
        </div>
        <div className="campo"><label htmlFor="pe-canal">¿Por dónde llegó?</label>
          <select id="pe-canal" className="entrada" value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option value="whatsapp">WhatsApp</option><option value="telefono">Llamada</option><option value="local">En el local</option>
          </select></div>
        {cliente ? (
          <div className="item-opcion activo">
            <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.celular ?? ""}</span></span>
            <button type="button" className="boton texto" onClick={() => setCliente(null)}>Quitar</button>
          </div>
        ) : (
          <>
            <div className="rejilla-2">
              <div className="campo"><label htmlFor="pe-nombre">Nombre</label>
                <input id="pe-nombre" className="entrada" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
              <div className="campo"><label htmlFor="pe-cel">Celular</label>
                <input id="pe-cel" className="entrada" type="tel" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
            </div>
            <button type="button" className="boton texto" style={{ alignSelf: "flex-start" }} onClick={() => setElegirCliente(true)}>Elegir un cliente guardado</button>
          </>
        )}
        {tipo === "domicilio" && (
          <>
            <div className="campo"><label htmlFor="pe-dir">Dirección</label>
              <input id="pe-dir" className="entrada" maxLength={300} value={direccion} placeholder={cliente?.direccion ?? ""} onChange={(e) => setDireccion(e.target.value)} /></div>
            <div className="rejilla-2">
              <div className="campo"><label htmlFor="pe-ref">Referencia</label>
                <input id="pe-ref" className="entrada" maxLength={200} value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
              <CampoMonto id="pe-envio" etiqueta="Costo del envío" valor={envio} alCambiar={setEnvio} />
            </div>
          </>
        )}
        {lineas.map((l, i) => (
          <div key={l.producto.id} className="rejilla-2" style={{ alignItems: "end" }}>
            <CampoMonto id={`pe-c-${i}`} etiqueta={`${l.producto.nombre} (${dinero(l.producto.precio)})`} valor={l.cantidad}
              alCambiar={(v) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: v } : x)))} />
            <div style={{ display: "flex", gap: 6 }}>
              <input aria-label={`Nota de ${l.producto.nombre}`} className="entrada" placeholder="Nota" maxLength={120} value={l.nota}
                onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)))} />
              <button type="button" className="icono-boton" aria-label={`Quitar ${l.producto.nombre}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
            </div>
          </div>
        ))}
        <button type="button" className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar producto</button>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="pe-hora">Hora de entrega (opcional)</label>
            <input id="pe-hora" className="entrada" type="time" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)} /></div>
          <div className="campo"><label htmlFor="pe-nota">Nota (opcional)</label>
            <input id="pe-nota" className="entrada" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!lineas.length}>Guardar pedido de {dinero(total)}</button>
      </form>
      {elegir && <SelectorProducto alCerrar={() => setElegir(false)} alElegir={(p) => {
        setElegir(false);
        if (!lineas.some((l) => l.producto.id === p.id)) setLineas((ls) => [...ls, { producto: p, cantidad: "1", nota: "" }]);
      }} />}
      {elegirCliente && <ElegirCliente alCerrar={() => setElegirCliente(false)} alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />}
    </Dialogo>
  );
}
