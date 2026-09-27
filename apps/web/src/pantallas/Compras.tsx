import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { puedeGestionar, tieneModulo } from "../tipos";
import { cantidad as fmtCantidad, dinero, fecha, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";

interface Proveedor { id: string; nombre: string; ruc: string | null; celular: string | null; por_pagar: number; ultima_compra: string | null }
interface CompraLista {
  id: string; numero: number; fecha: string; documento: string | null; metodo: string; total: number;
  pagado: number; saldo: number; estado: "recibida" | "anulada"; proveedor: string | null; productos: number;
}
interface Lote { id: string; producto: string; unidad: string; codigo: string | null; vence: string; cantidad: number; dias: number }

type Pestana = "compras" | "proveedores" | "lotes";
const METODOS: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", credito: "A crédito" };

export function Compras({ info, avisar, inicial = "compras" }: { info: InfoNegocio; avisar: (t: string) => void; inicial?: Pestana }) {
  const [pestana, setPestana] = useState<Pestana>(inicial);
  const conLotes = tieneModulo(info, "M16");
  const conCompras = tieneModulo(info, "M15");
  useEffect(() => setPestana(inicial), [inicial]);

  return (
    <div className="contenido" style={{ maxWidth: 760, width: "100%", margin: "0 auto" }}>
      <h1>{pestana === "lotes" && !conCompras ? "Por vencer" : "Compras"}</h1>
      {conCompras && (
        <div className="chips" role="tablist">
          {(["compras", "proveedores", ...(conLotes ? ["lotes"] : [])] as Pestana[]).map((p) => (
            <button key={p} role="tab" aria-selected={pestana === p} className={`chip${pestana === p ? " activo" : ""}`} onClick={() => setPestana(p)}>
              {p === "compras" ? "Compras" : p === "proveedores" ? "Proveedores" : "Por vencer"}
            </button>
          ))}
        </div>
      )}
      {pestana === "compras" && conCompras && <ListaCompras info={info} avisar={avisar} />}
      {pestana === "proveedores" && conCompras && <ListaProveedores avisar={avisar} />}
      {pestana === "lotes" && <ListaLotes avisar={avisar} />}
    </div>
  );
}

// ---------- Compras ----------

function ListaCompras({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ compras: CompraLista[]; resumen: { por_pagar: number; compras_mes: number } } | null>(null);
  const [nueva, setNueva] = useState(false);
  const [pagar, setPagar] = useState<CompraLista | null>(null);
  const [anular, setAnular] = useState<CompraLista | null>(null);
  const puede = info.rol !== "cajero";

  const cargar = useCallback(() => {
    api<typeof datos & object>("GET", "/compras").then(setDatos).catch(() => setDatos({ compras: [], resumen: { por_pagar: 0, compras_mes: 0 } }));
  }, []);
  useEffect(cargar, [cargar]);
  if (!datos) return <Cargando />;

  return (
    <>
      <div className="opciones">
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Compras del mes</span><span className="monto-grande">{dinero(datos.resumen.compras_mes)}</span></div>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Debes a proveedores</span><span className="monto-grande">{dinero(datos.resumen.por_pagar)}</span></div>
      </div>
      {puede && <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Registrar compra</button>}
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {datos.compras.map((c) => (
          <div key={c.id} className="comprobante-fila">
            <div className="textos">
              <strong className={c.estado === "anulada" ? "anulada" : ""}>Compra N.º {c.numero}{c.proveedor ? ` · ${c.proveedor}` : ""}</strong>
              <span>{fecha(c.fecha + "T12:00:00")} · {METODOS[c.metodo]} · {c.productos} {c.productos === 1 ? "producto" : "productos"}{c.documento ? ` · Fact. ${c.documento}` : ""}</span>
              {puede && c.estado === "recibida" && (
                <div className="acciones-fila" style={{ marginTop: 4 }}>
                  {c.saldo > 0 && <button className="boton texto pequeno" onClick={() => setPagar(c)}>Pagar</button>}
                  {puedeGestionar(info.rol) && <button className="boton texto pequeno" onClick={() => setAnular(c)}>Anular</button>}
                </div>
              )}
            </div>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <strong className={c.estado === "anulada" ? "anulada" : ""}>{dinero(c.total)}</strong>
              {c.estado === "anulada" ? <span className="insignia gris">Anulada</span>
                : c.saldo > 0 ? <span className="insignia no">Debes {dinero(c.saldo)}</span> : <span className="insignia ok">Pagada</span>}
            </span>
          </div>
        ))}
        {datos.compras.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Todavía no registras compras. Al registrar una, sube el stock y se actualiza el costo.</p>}
      </div>
      {nueva && <NuevaCompra info={info} alCerrar={() => setNueva(false)} alGuardar={(n) => { setNueva(false); avisar(`Compra N.º ${n} registrada`); cargar(); }} />}
      {pagar && <PagarCompra compra={pagar} alCerrar={() => setPagar(null)} alGuardar={() => { setPagar(null); avisar("Pago registrado"); cargar(); }} />}
      {anular && <AnularCompra compra={anular} alCerrar={() => setAnular(null)} alGuardar={() => { setAnular(null); avisar("Compra anulada"); cargar(); }} />}
    </>
  );
}

interface LineaCompra { producto: Producto; cantidad: string; costo: string; lote: string; vence: string }

function NuevaCompra({ info, alCerrar, alGuardar }: { info: InfoNegocio; alCerrar: () => void; alGuardar: (numero: number) => void }) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [documento, setDocumento] = useState("");
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [elegir, setElegir] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const conLotes = tieneModulo(info, "M16");

  useEffect(() => { api<{ proveedores: Proveedor[] }>("GET", "/proveedores").then((r) => setProveedores(r.proveedores)).catch(() => {}); }, []);

  const total = redondear(lineas.reduce((s, l) => s + (parsearNumero(l.cantidad) ?? 0) * (parsearNumero(l.costo) ?? 0), 0));
  const cambiar = (i: number, k: keyof LineaCompra, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lineas.length) { setError("Agrega al menos un producto."); return; }
    setOcupado(true);
    try {
      const r = await api<{ compra: { numero: number } }>("POST", "/compras", {
        proveedor_id: proveedor || undefined, metodo, documento: documento || undefined,
        items: lineas.map((l) => ({
          producto_id: l.producto.id, cantidad: parsearNumero(l.cantidad), costo: parsearNumero(l.costo),
          lote: l.lote || undefined, vence: l.vence || undefined,
        })),
      });
      alGuardar(r.compra.numero);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo="Registrar compra" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo">
          <label htmlFor="c-prov">Proveedor</label>
          <select id="c-prov" className="entrada" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
            <option value="">Sin proveedor</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        {lineas.map((l, i) => (
          <div key={l.producto.id} className="tarjeta" style={{ boxShadow: "none", border: "1px solid var(--border)", padding: 12, gap: 8 }}>
            <div className="fila">
              <strong>{l.producto.nombre}</strong>
              <button type="button" className="icono-boton" aria-label={`Quitar ${l.producto.nombre}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
            </div>
            <div className="rejilla-2">
              <CampoMonto id={`c-cant-${i}`} etiqueta={`Cantidad (${l.producto.unidad.toLowerCase()})`} valor={l.cantidad} alCambiar={(v) => cambiar(i, "cantidad", v)} />
              <CampoMonto id={`c-costo-${i}`} etiqueta="Costo por unidad" valor={l.costo} alCambiar={(v) => cambiar(i, "costo", v)} />
            </div>
            {conLotes && (
              <div className="rejilla-2">
                <div className="campo"><label htmlFor={`c-lote-${i}`}>Lote (opcional)</label>
                  <input id={`c-lote-${i}`} className="entrada" maxLength={40} value={l.lote} onChange={(e) => cambiar(i, "lote", e.target.value)} /></div>
                <div className="campo"><label htmlFor={`c-vence-${i}`}>Vence (opcional)</label>
                  <input id={`c-vence-${i}`} className="entrada" type="date" value={l.vence} onChange={(e) => cambiar(i, "vence", e.target.value)} /></div>
              </div>
            )}
          </div>
        ))}
        <button type="button" className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar producto</button>
        <div className="campo">
          <span className="etiqueta">¿Cómo pagas?</span>
          <div className="opciones">
            {Object.entries(METODOS).map(([k, v]) => (
              <button type="button" key={k} className={`opcion${metodo === k ? " activa" : ""}`} aria-pressed={metodo === k} onClick={() => setMetodo(k)}>{v}</button>
            ))}
          </div>
          {metodo === "efectivo" && <span className="muted" style={{ fontSize: 13 }}>Si la caja está abierta, el efectivo sale de la caja.</span>}
        </div>
        <div className="campo">
          <label htmlFor="c-doc">N.º de factura del proveedor (opcional)</label>
          <input id="c-doc" className="entrada" maxLength={40} value={documento} onChange={(e) => setDocumento(e.target.value)} />
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || !lineas.length}>{ocupado ? "Guardando…" : `Guardar compra de ${dinero(total)}`}</button>
      </form>
      {elegir && (
        <SelectorProducto titulo="¿Qué compraste?" filtro="todos" alCerrar={() => setElegir(false)} alElegir={(p) => {
          setElegir(false);
          if (!lineas.some((l) => l.producto.id === p.id)) {
            setLineas((ls) => [...ls, { producto: p, cantidad: "", costo: p.costo !== null ? String(p.costo).replace(".", ",") : "", lote: "", vence: "" }]);
          }
        }} />
      )}
    </Dialogo>
  );
}

function PagarCompra({ compra, alCerrar, alGuardar }: { compra: CompraLista; alCerrar: () => void; alGuardar: () => void }) {
  const [monto, setMonto] = useState(String(compra.saldo).replace(".", ","));
  const [metodo, setMetodo] = useState("transferencia");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", `/compras/${compra.id}/pagos`, { monto: parsearNumero(monto), metodo }); alGuardar(); }
    catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Pagar compra N.º ${compra.numero}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">Debes {dinero(compra.saldo)}{compra.proveedor ? ` a ${compra.proveedor}` : ""}</p>
        <CampoMonto id="pc-monto" etiqueta="¿Cuánto pagas?" valor={monto} alCambiar={setMonto} grande />
        <div className="opciones">
          {["efectivo", "transferencia", "tarjeta"].map((m) => (
            <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{METODOS[m]}</button>
          ))}
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque">Guardar pago</button>
      </form>
    </Dialogo>
  );
}

function AnularCompra({ compra, alCerrar, alGuardar }: { compra: CompraLista; alCerrar: () => void; alGuardar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", `/compras/${compra.id}/anular`, { motivo }); alGuardar(); } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Anular compra N.º ${compra.numero}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">Los productos salen del stock. Si se pagó en efectivo con la caja abierta, el dinero vuelve a la caja.</p>
        <div className="campo"><label htmlFor="ac-motivo">Motivo</label>
          <input id="ac-motivo" className="entrada" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton peligro bloque" disabled={motivo.trim().length < 3}>Anular compra</button>
      </form>
    </Dialogo>
  );
}

// ---------- Proveedores ----------

function ListaProveedores({ avisar }: { avisar: (t: string) => void }) {
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const cargar = useCallback(() => {
    api<{ proveedores: Proveedor[] }>("GET", "/proveedores").then((r) => setProveedores(r.proveedores)).catch(() => setProveedores([]));
  }, []);
  useEffect(cargar, [cargar]);
  if (!proveedores) return <Cargando />;
  return (
    <>
      <button className="boton secundario" onClick={() => setNuevo(true)}><IMas tam={18} /> Nuevo proveedor</button>
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {proveedores.map((p) => (
          <div key={p.id} className="comprobante-fila">
            <div className="textos">
              <strong>{p.nombre}</strong>
              <span>{[p.ruc, p.celular, p.ultima_compra ? `Última compra ${fecha(p.ultima_compra + "T12:00:00")}` : null].filter(Boolean).join(" · ") || "Sin datos"}</span>
            </div>
            {p.por_pagar > 0 ? <span className="insignia no">Debes {dinero(p.por_pagar)}</span> : <span className="insignia ok">Al día</span>}
          </div>
        ))}
        {proveedores.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Agrega a quienes te venden la mercadería.</p>}
      </div>
      {nuevo && <NuevoProveedor alCerrar={() => setNuevo(false)} alGuardar={() => { setNuevo(false); avisar("Proveedor guardado"); cargar(); }} />}
    </>
  );
}

function NuevoProveedor({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [d, setD] = useState({ nombre: "", ruc: "", celular: "", correo: "" });
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/proveedores", { nombre: d.nombre, ruc: d.ruc || undefined, celular: d.celular || undefined, correo: d.correo || undefined });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Nuevo proveedor" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="p-nombre">Nombre</label>
          <input id="p-nombre" className="entrada" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></div>
        <div className="campo"><label htmlFor="p-ruc">RUC o cédula (opcional)</label>
          <input id="p-ruc" className="entrada" inputMode="numeric" maxLength={13} value={d.ruc} onChange={(e) => setD({ ...d, ruc: e.target.value.trim() })} /></div>
        <div className="campo"><label htmlFor="p-cel">Celular (opcional)</label>
          <input id="p-cel" className="entrada" type="tel" value={d.celular} onChange={(e) => setD({ ...d, celular: e.target.value })} /></div>
        <div className="campo"><label htmlFor="p-correo">Correo (opcional)</label>
          <input id="p-correo" className="entrada" type="email" value={d.correo} onChange={(e) => setD({ ...d, correo: e.target.value })} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={d.nombre.trim().length < 2}>Guardar proveedor</button>
      </form>
    </Dialogo>
  );
}

// ---------- Lotes por vencer ----------

function ListaLotes({ avisar }: { avisar: (t: string) => void }) {
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const cargar = useCallback(() => {
    api<{ lotes: Lote[] }>("GET", "/lotes?dias=60").then((r) => setLotes(r.lotes)).catch(() => setLotes([]));
  }, []);
  useEffect(cargar, [cargar]);

  async function cerrar(l: Lote, estado: "agotado" | "retirado") {
    try {
      await api("POST", `/lotes/${l.id}/cerrar`, { estado, descontar: estado === "retirado" });
      avisar(estado === "retirado" ? "Lote retirado y descontado del stock" : "Lote marcado como vendido");
      cargar();
    } catch (e) { avisar(mensajeDe(e)); }
  }

  if (!lotes) return <Cargando />;
  return (
    <div className="tarjeta" style={{ padding: "4px 16px" }}>
      {lotes.map((l) => (
        <div key={l.id} className="comprobante-fila">
          <div className="textos">
            <strong>{l.producto}{l.codigo ? ` · Lote ${l.codigo}` : ""}</strong>
            <span>Vence {fecha(l.vence + "T12:00:00")} · {fmtCantidad(l.cantidad)} {l.unidad.toLowerCase()}</span>
            <div className="acciones-fila" style={{ marginTop: 4 }}>
              <button className="boton texto pequeno" onClick={() => cerrar(l, "agotado")}>Ya se vendió</button>
              <button className="boton texto pequeno" onClick={() => cerrar(l, "retirado")}>Retirar</button>
            </div>
          </div>
          <span className={`insignia ${l.dias < 0 ? "mal" : l.dias <= 15 ? "no" : "gris"}`}>
            {l.dias < 0 ? `Venció hace ${-l.dias} d` : l.dias === 0 ? "Vence hoy" : `En ${l.dias} días`}
          </span>
        </div>
      ))}
      {lotes.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Nada vence en los próximos 60 días. Al registrar compras con fecha de vencimiento, aparecen aquí.</p>}
    </div>
  );
}
