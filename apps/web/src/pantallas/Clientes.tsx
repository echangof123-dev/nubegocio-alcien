import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio } from "../tipos";
import { tieneModulo } from "../tipos";
import { cantidad as fmtCantidad, dinero, fecha, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IMas } from "../componentes/iconos";
import { ElegirCliente } from "./Cobrar";
import { enlaceWa } from "../componentes/servicios";
import { imprimirRecibo, whatsappRecibo } from "../componentes/recibo";

interface ClienteLista extends Cliente {
  notas: string | null; fecha_pago: string | null; comprado: number; ultima_compra: string | null; direccion?: string | null;
}
interface Compra { id: string; numero: number; creado_en: string; total: number; estado: string; token: string; productos: string; metodos: string }

const f = (d: string) => fecha(d + "T12:00:00");
const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

export function mensajeCobro(c: { nombre: string; saldo: number; fecha_pago?: string | null }, negocio: string) {
  return `Hola ${c.nombre}, te saludamos de ${negocio}. Tienes un saldo pendiente de ${dinero(c.saldo)}` +
    `${c.fecha_pago ? `, acordado para el ${f(c.fecha_pago)}` : ""}. ¡Gracias!`;
}

/** Clientes: quién te compra, cuánto, qué prefiere y quién te debe. */
export function Clientes({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [vista, setVista] = useState<"todos" | "deben">("todos");
  const [clientes, setClientes] = useState<ClienteLista[] | null>(null);
  const [abierto, setAbierto] = useState<ClienteLista | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(() => {
    api<{ clientes: ClienteLista[] }>("GET", `/clientes?q=${encodeURIComponent(q)}${vista === "deben" ? "&con_deuda=1" : ""}`)
      .then((r) => setClientes(r.clientes)).catch(() => setClientes([]));
  }, [q, vista]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  const deuda = (clientes ?? []).reduce((s, c) => s + Math.max(0, Number(c.saldo)), 0);
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Clientes</h1>
      <button className="boton bloque" onClick={() => setNuevo(true)}><IMas tam={20} /> Nuevo cliente</button>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={vista === "todos"} className={`chip${vista === "todos" ? " activo" : ""}`} onClick={() => setVista("todos")}>Todos</button>
        {tieneModulo(info, "M14") && <button role="tab" aria-selected={vista === "deben"} className={`chip${vista === "deben" ? " activo" : ""}`} onClick={() => setVista("deben")}>Me deben</button>}
      </div>
      <div className="con-icono">
        <IBuscar tam={20} />
        <label htmlFor="buscar-cliente" className="oculto">Buscar cliente</label>
        <input id="buscar-cliente" className="entrada" placeholder="Nombre, celular o cédula" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {vista === "deben" && clientes && <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Te deben</span><span className="monto-grande">{dinero(deuda)}</span></div>}
      {!clientes ? <Cargando /> : clientes.length === 0 ? <div className="vacio"><p>{q ? "No hay clientes con esa búsqueda." : vista === "deben" ? "Nadie te debe. 🎉" : "Aún no tienes clientes."}</p></div> : (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          {clientes.map((c) => {
            const vencido = Number(c.saldo) > 0 && c.fecha_pago && c.fecha_pago < hoy();
            return (
              <button key={c.id} className="movimiento boton-fila" onClick={() => setAbierto(c)}>
                <div className="textos">
                  <strong>{c.nombre}</strong>
                  <span>{c.celular ?? c.identificacion ?? "Sin celular"}{Number(c.comprado) > 0 ? ` · compró ${dinero(c.comprado)}` : ""}</span>
                </div>
                {Number(c.saldo) > 0 && (
                  <div style={{ textAlign: "right" }}>
                    <strong className="negativo">{dinero(c.saldo)}</strong>
                    {c.fecha_pago && <div className={`insignia ${vencido ? "mal" : "no"}`}>{vencido ? "Vencido" : `Paga ${f(c.fecha_pago)}`}</div>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
      {nuevo && <ElegirCliente alCerrar={() => setNuevo(false)} alElegir={() => { setNuevo(false); avisar("Cliente guardado"); cargar(); }} />}
      {abierto && <DetalleCliente info={info} cliente={abierto} avisar={avisar} alCerrar={() => { setAbierto(null); cargar(); }} />}
    </div>
  );
}

function DetalleCliente({ info, cliente, avisar, alCerrar }: { info: InfoNegocio; cliente: ClienteLista; avisar: (t: string) => void; alCerrar: () => void }) {
  const [c, setC] = useState(cliente);
  const [compras, setCompras] = useState<{ compras: Compra[]; favoritos: { nombre: string; cantidad: number; total: number }[] } | null>(null);
  const [editar, setEditar] = useState(false);
  const [abono, setAbono] = useState(false);
  useEffect(() => {
    api<typeof compras>("GET", `/clientes/${c.id}/compras`).then(setCompras).catch(() => setCompras({ compras: [], favoritos: [] }));
  }, [c.id]);
  const wa = Number(c.saldo) > 0 ? enlaceWa(c.celular, mensajeCobro(c, info.negocio.nombre)) : enlaceWa(c.celular, `Hola ${c.nombre}, `);

  if (editar) return <EditarCliente cliente={c} alCerrar={() => setEditar(false)} alGuardar={(nuevo) => { setC({ ...c, ...nuevo }); setEditar(false); avisar("Datos guardados"); }} />;
  if (abono) return <Abono cliente={c} metodos={info.negocio.metodos_pago} alCerrar={() => setAbono(false)} alGuardar={(saldo) => { setC({ ...c, saldo }); setAbono(false); avisar(`Abono registrado. Saldo: ${dinero(saldo)}`); }} />;

  return (
    <Dialogo titulo={c.nombre} alCerrar={alCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="muted" style={{ fontSize: 14 }}>
          {[c.celular, c.identificacion, c.correo, c.direccion].filter(Boolean).join(" · ") || "Sin datos de contacto"}
        </span>
        {c.notas && <Aviso tipo="info">{c.notas}</Aviso>}
        <div className="rejilla-2">
          <div className="tarjeta" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12 }}>Ha comprado</span><strong>{dinero(c.comprado)}</strong></div>
          <div className="tarjeta" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12 }}>Te debe</span>
            <strong className={Number(c.saldo) > 0 ? "negativo" : ""}>{dinero(Math.max(0, Number(c.saldo)))}</strong>
            {c.fecha_pago && Number(c.saldo) > 0 && <span className="muted" style={{ fontSize: 12 }}>Paga el {f(c.fecha_pago)}</span>}
          </div>
        </div>
        <div className="acciones-fila">
          {Number(c.saldo) > 0 && <button className="boton pequeno" onClick={() => setAbono(true)}>Registrar abono</button>}
          {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">{Number(c.saldo) > 0 ? "Recordar pago" : "WhatsApp"}</a>}
          <button className="boton pequeno secundario" onClick={() => setEditar(true)}>Editar datos</button>
        </div>
        {!compras ? <Cargando /> : (
          <>
            {compras.favoritos.length > 0 && (
              <>
                <span className="etiqueta">Lo que más compra</span>
                <span style={{ fontSize: 14 }}>{compras.favoritos.map((x) => `${x.nombre} (${fmtCantidad(Number(x.cantidad))})`).join(" · ")}</span>
              </>
            )}
            <span className="etiqueta">Compras</span>
            {compras.compras.length === 0 && <p className="muted" style={{ margin: 0 }}>Todavía no le has vendido.</p>}
            {compras.compras.map((v) => (
              <div key={v.id} className="movimiento" style={{ opacity: v.estado === "anulada" ? 0.55 : 1 }}>
                <div className="textos">
                  <strong className={v.estado === "anulada" ? "anulada" : ""}>N.º {v.numero} · {fecha(v.creado_en)}</strong>
                  <span>{v.productos}</span>
                  <span className="acciones-mini">
                    <a href={whatsappRecibo(v.token, info.negocio.nombre, Number(v.total), c.celular)} target="_blank" rel="noopener">Enviar recibo</a>
                    <button type="button" onClick={() => imprimirRecibo(v.token)}>Imprimir</button>
                  </span>
                </div>
                <strong>{dinero(v.total)}</strong>
              </div>
            ))}
          </>
        )}
      </div>
    </Dialogo>
  );
}

function EditarCliente({ cliente, alCerrar, alGuardar }: { cliente: ClienteLista; alCerrar: () => void; alGuardar: (c: Partial<ClienteLista>) => void }) {
  const [d, setD] = useState({
    nombre: cliente.nombre, celular: cliente.celular ?? "", identificacion: cliente.identificacion ?? "", correo: cliente.correo ?? "",
    direccion: cliente.direccion ?? "", notas: cliente.notas ?? "", fecha_pago: cliente.fecha_pago ?? "",
    limite_credito: cliente.limite_credito != null ? String(cliente.limite_credito).replace(".", ",") : "",
  });
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ cliente: ClienteLista }>("PATCH", `/clientes/${cliente.id}`, {
        nombre: d.nombre, celular: d.celular || undefined, identificacion: d.identificacion || undefined, correo: d.correo || undefined,
        direccion: d.direccion || undefined, notas: d.notas || null, fecha_pago: d.fecha_pago || null,
        limite_credito: d.limite_credito ? parsearNumero(d.limite_credito) : null,
      });
      alGuardar(r.cliente);
    } catch (err) { setError(mensajeDe(err)); }
  }
  type Campo = "nombre" | "celular" | "identificacion" | "correo" | "direccion" | "fecha_pago";
  const campo = (k: Campo, etiqueta: string, extra: Record<string, unknown> = {}) => (
    <div className="campo"><label htmlFor={`ec-${k}`}>{etiqueta}</label>
      <input id={`ec-${k}`} className="entrada" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <Dialogo titulo={`Datos de ${cliente.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {campo("nombre", "Nombre", { maxLength: 120 })}
        <div className="rejilla-2">
          {campo("celular", "Celular", { type: "tel" })}
          {campo("identificacion", "Cédula o RUC", { inputMode: "numeric", maxLength: 13 })}
        </div>
        {campo("correo", "Correo", { type: "email" })}
        {campo("direccion", "Dirección", { maxLength: 300 })}
        <div className="campo"><label htmlFor="ec-notas">Notas y preferencias</label>
          <textarea id="ec-notas" className="entrada" rows={2} maxLength={500} placeholder="Ej.: prefiere que le entreguen en la tarde" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></div>
        <div className="rejilla-2">
          {campo("fecha_pago", "Fecha acordada de pago", { type: "date" })}
          <CampoMonto id="ec-limite" etiqueta="Límite de fiado" valor={d.limite_credito} alCambiar={(v) => setD({ ...d, limite_credito: v })} />
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={d.nombre.trim().length < 2}>Guardar</button>
      </form>
    </Dialogo>
  );
}

function Abono({ cliente, metodos, alCerrar, alGuardar }: { cliente: ClienteLista; metodos: string[]; alCerrar: () => void; alGuardar: (saldo: number) => void }) {
  const [monto, setMonto] = useState(String(cliente.saldo).replace(".", ","));
  const [metodo, setMetodo] = useState(metodos[0] ?? "efectivo");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ saldo: number }>("POST", `/clientes/${cliente.id}/abonos`, { monto: parsearNumero(monto), metodo });
      alGuardar(Number(r.saldo));
    } catch (err) { setError(mensajeDe(err)); }
  }
  const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna" };
  return (
    <Dialogo titulo={`Abono de ${cliente.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Debe {dinero(cliente.saldo)}</p>
        <CampoMonto id="ab-monto" etiqueta="Monto del abono" valor={monto} alCambiar={setMonto} grande />
        <div className="opciones">
          {metodos.map((m) => <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{NOMBRES[m] ?? m}</button>)}
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!(parsearNumero(monto) ?? 0)}>Registrar abono</button>
      </form>
    </Dialogo>
  );
}
