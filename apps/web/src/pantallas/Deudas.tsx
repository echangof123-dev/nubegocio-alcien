import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, fecha, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";
import { ElegirCliente } from "./Cobrar";
import { enlaceWa, diaLocal } from "../componentes/servicios";
import { mensajeCobro } from "./Clientes";

interface Cobrar { id: string; nombre: string; celular: string | null; saldo: number; ultimo_cargo: string | null; fecha_pago: string | null }
interface Pagar { tipo: "compra" | "deuda"; id: string; proveedor: string | null; concepto: string; fecha: string; vence: string | null; monto: number; saldo: number }
interface Proveedor { id: string; nombre: string }
const f = (d: string) => fecha(d + "T12:00:00");

/** Deudas como en Treinta: lo que te deben tus clientes y lo que tú debes a tus proveedores. */
export function Deudas({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [vista, setVista] = useState<"cobrar" | "pagar">("cobrar");
  const [datos, setDatos] = useState<{ por_cobrar: Cobrar[]; total_cobrar: number; por_pagar: Pagar[]; total_pagar: number } | null>(null);
  const [nueva, setNueva] = useState(false);
  const [abono, setAbono] = useState<Cobrar | null>(null);
  const [pago, setPago] = useState<Pagar | null>(null);
  const veDeudasPropias = info.rol !== "cajero";

  const cargar = useCallback(() => {
    api<NonNullable<typeof datos>>("GET", "/deudas").then(setDatos).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  if (!datos) return <Cargando />;
  const hoy = diaLocal();
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Deudas</h1>
      <div className="rejilla-2 balance-resumen" style={{ display: "grid" }}>
        <button className={`tarjeta ${vista === "cobrar" ? "seleccionada" : ""}`} style={{ gap: 2, textAlign: "left" }} onClick={() => setVista("cobrar")}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Me deben</span>
          <strong className="positivo" style={{ fontSize: 22 }}>{dinero(datos.total_cobrar)}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{datos.por_cobrar.length} {datos.por_cobrar.length === 1 ? "cliente" : "clientes"}</span>
        </button>
        {veDeudasPropias && (
          <button className={`tarjeta ${vista === "pagar" ? "seleccionada" : ""}`} style={{ gap: 2, textAlign: "left" }} onClick={() => setVista("pagar")}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Debo</span>
            <strong className="negativo" style={{ fontSize: 22 }}>{dinero(datos.total_pagar)}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{datos.por_pagar.length} {datos.por_pagar.length === 1 ? "pendiente" : "pendientes"}</span>
          </button>
        )}
      </div>
      <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Nueva deuda</button>

      {vista === "cobrar" ? (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          {datos.por_cobrar.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Nadie te debe. 🎉</p>}
          {datos.por_cobrar.map((c) => {
            const vencida = c.fecha_pago && c.fecha_pago < hoy;
            const wa = enlaceWa(c.celular, mensajeCobro(c, info.negocio.nombre));
            return (
              <div key={c.id} className="movimiento">
                <div className="textos">
                  <strong>{c.nombre}</strong>
                  <span>{c.fecha_pago ? (vencida ? `Venció el ${f(c.fecha_pago)}` : `Paga el ${f(c.fecha_pago)}`) : c.ultimo_cargo ? `Desde ${fecha(c.ultimo_cargo)}` : ""}</span>
                  <span className="acciones-mini">
                    <button type="button" onClick={() => setAbono(c)}>Abonar</button>
                    {wa && <a href={wa} target="_blank" rel="noopener">Recordar por WhatsApp</a>}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>{dinero(c.saldo)}</strong>
                  {vencida && <div className="insignia mal">Vencida</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          {datos.por_pagar.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>No le debes a ningún proveedor.</p>}
          {datos.por_pagar.map((d) => {
            const vencida = d.vence && d.vence < hoy;
            return (
              <div key={d.tipo + d.id} className="movimiento">
                <div className="textos">
                  <strong>{d.proveedor ?? "Sin proveedor"}</strong>
                  <span>{d.concepto} · {f(d.fecha)}{d.vence ? ` · ${vencida ? "venció" : "pagar"} el ${f(d.vence)}` : ""}</span>
                  <span className="acciones-mini"><button type="button" onClick={() => setPago(d)}>Pagar</button></span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong className="negativo">{dinero(d.saldo)}</strong>
                  {Number(d.saldo) < Number(d.monto) && <div className="muted" style={{ fontSize: 12 }}>de {dinero(d.monto)}</div>}
                  {vencida && <div className="insignia mal">Vencida</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nueva && <NuevaDeuda puedeProveedor={veDeudasPropias} alCerrar={() => setNueva(false)} alGuardar={(t, v) => { setNueva(false); setVista(v); avisar(t); cargar(); }} />}
      {abono && <Abonar cliente={abono} metodos={info.negocio.metodos_pago} alCerrar={() => setAbono(null)} alGuardar={(saldo) => { setAbono(null); avisar(saldo > 0 ? `Abono guardado. Queda ${dinero(saldo)}` : "¡Deuda saldada!"); cargar(); }} />}
      {pago && <Pagar deuda={pago} alCerrar={() => setPago(null)} alGuardar={(saldo) => { setPago(null); avisar(saldo > 0 ? `Pago guardado. Queda ${dinero(saldo)}` : "¡Deuda pagada!"); cargar(); }} />}
      {!puedeGestionar(info.rol) && info.rol === "cajero" && <p className="muted" style={{ fontSize: 13 }}>Las deudas con proveedores las ve el dueño o un administrador.</p>}
    </div>
  );
}

function NuevaDeuda({ puedeProveedor, alCerrar, alGuardar }: { puedeProveedor: boolean; alCerrar: () => void; alGuardar: (t: string, vista: "cobrar" | "pagar") => void }) {
  const [tipo, setTipo] = useState<"cobrar" | "pagar">("cobrar");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [elegirCliente, setElegirCliente] = useState(false);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [nuevoProveedor, setNuevoProveedor] = useState("");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (puedeProveedor) api<{ proveedores: Proveedor[] }>("GET", "/proveedores").then((r) => setProveedores(r.proveedores)).catch(() => {});
  }, [puedeProveedor]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (tipo === "cobrar") {
        await api("POST", `/clientes/${cliente!.id}/deudas`, { monto: parsearNumero(monto), concepto, fecha_pago: fechaPago || undefined });
        alGuardar(`Anotado: ${cliente!.nombre} te debe ${dinero(parsearNumero(monto))}`, "cobrar");
      } else {
        let id = proveedor;
        if (proveedor === "nuevo") id = (await api<{ proveedor: Proveedor }>("POST", "/proveedores", { nombre: nuevoProveedor })).proveedor.id;
        await api("POST", "/deudas-proveedor", { proveedor_id: id, monto: parsearNumero(monto), concepto, vence: fechaPago || undefined });
        alGuardar(`Anotado: debes ${dinero(parsearNumero(monto))}`, "pagar");
      }
    } catch (err) { setError(mensajeDe(err)); }
  }
  const listo = (parsearNumero(monto) ?? 0) > 0 && concepto.trim() && (tipo === "cobrar" ? !!cliente : proveedor && (proveedor !== "nuevo" || nuevoProveedor.trim().length > 1));
  return (
    <Dialogo titulo="Nueva deuda" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {puedeProveedor && (
          <div className="opciones" role="group" aria-label="Tipo de deuda">
            <button type="button" className={`opcion${tipo === "cobrar" ? " activa" : ""}`} onClick={() => setTipo("cobrar")}>Me deben</button>
            <button type="button" className={`opcion${tipo === "pagar" ? " activa" : ""}`} onClick={() => setTipo("pagar")}>Yo debo</button>
          </div>
        )}
        {tipo === "cobrar" ? (
          <button type="button" className={`item-opcion${cliente ? " activo" : ""}`} onClick={() => setElegirCliente(true)}>
            <span className="textos"><strong>{cliente?.nombre ?? "Elegir cliente"}</strong><span>{cliente ? "Toca para cambiar" : "Busca o crea el cliente"}</span></span>
          </button>
        ) : (
          <>
            <div className="campo"><label htmlFor="nd-prov">Proveedor</label>
              <select id="nd-prov" className="entrada" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                <option value="">Elegir…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                <option value="nuevo">+ Proveedor nuevo</option>
              </select></div>
            {proveedor === "nuevo" && (
              <div className="campo"><label htmlFor="nd-np">Nombre del proveedor</label>
                <input id="nd-np" className="entrada" maxLength={120} value={nuevoProveedor} onChange={(e) => setNuevoProveedor(e.target.value)} /></div>
            )}
          </>
        )}
        <CampoMonto id="nd-monto" etiqueta="Valor de la deuda" valor={monto} alCambiar={setMonto} grande />
        <div className="campo"><label htmlFor="nd-concepto">Concepto</label>
          <input id="nd-concepto" className="entrada" maxLength={200} placeholder={tipo === "cobrar" ? "Ej.: compras del mes pasado" : "Ej.: mercadería de septiembre"} value={concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        <div className="campo"><label htmlFor="nd-fecha">Fecha de pago (opcional)</label>
          <input id="nd-fecha" className="entrada" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!listo}>Anotar deuda</button>
      </form>
      {elegirCliente && <ElegirCliente alCerrar={() => setElegirCliente(false)} alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />}
    </Dialogo>
  );
}

const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna" };

function Abonar({ cliente, metodos, alCerrar, alGuardar }: { cliente: Cobrar; metodos: string[]; alCerrar: () => void; alGuardar: (saldo: number) => void }) {
  const [monto, setMonto] = useState(String(cliente.saldo).replace(".", ","));
  const [metodo, setMetodo] = useState(metodos[0] ?? "efectivo");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { alGuardar(Number((await api<{ saldo: number }>("POST", `/clientes/${cliente.id}/abonos`, { monto: parsearNumero(monto), metodo })).saldo)); }
    catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Abono de ${cliente.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Debe {dinero(cliente.saldo)}</p>
        <CampoMonto id="da-monto" etiqueta="Monto del abono" valor={monto} alCambiar={setMonto} grande />
        <div className="opciones">{metodos.map((m) => <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{NOMBRES[m] ?? m}</button>)}</div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!(parsearNumero(monto) ?? 0)}>Registrar abono</button>
      </form>
    </Dialogo>
  );
}

function Pagar({ deuda, alCerrar, alGuardar }: { deuda: Pagar; alCerrar: () => void; alGuardar: (saldo: number) => void }) {
  const [monto, setMonto] = useState(String(deuda.saldo).replace(".", ","));
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia" | "tarjeta">("efectivo");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const ruta = deuda.tipo === "compra" ? `/compras/${deuda.id}/pagos` : `/deudas-proveedor/${deuda.id}/pagar`;
      alGuardar(Number((await api<{ saldo: number }>("POST", ruta, { monto: parsearNumero(monto), metodo })).saldo));
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Pagar a ${deuda.proveedor ?? "proveedor"}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>{deuda.concepto} · debes {dinero(deuda.saldo)}</p>
        <CampoMonto id="dp-monto" etiqueta="Monto a pagar" valor={monto} alCambiar={setMonto} grande />
        <div className="opciones">{(["efectivo", "transferencia", "tarjeta"] as const).map((m) => <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{NOMBRES[m]}</button>)}</div>
        {metodo === "efectivo" && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Si la caja está abierta, sale del efectivo.</p>}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!(parsearNumero(monto) ?? 0)}>Pagar {dinero(parsearNumero(monto) ?? 0)}</button>
      </form>
    </Dialogo>
  );
}
