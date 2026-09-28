import { AccionesRecibo } from "../componentes/recibo";
import { useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, EstadoSri as TEstadoSri, InfoNegocio, LineaCarrito } from "../tipos";
import { tieneModulo } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Dialogo } from "../componentes/basicos";
import { IBasura, ICheckCirculo, IMas, IMenos, IVolver } from "../componentes/iconos";
import { totalCarrito } from "./Vender";
import { EstadoSri, enlaceRide, enlaceWhatsApp, useSeguimiento } from "../componentes/comprobante";

/** Límite del SRI para facturar a consumidor final. */
const LIMITE_CONSUMIDOR_FINAL = 50;

type Props = {
  info: InfoNegocio;
  carrito: LineaCarrito[];
  setCarrito: (f: (c: LineaCarrito[]) => LineaCarrito[]) => void;
  navegar: (ruta: string) => void;
};

const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado" };

interface Hecha {
  venta_id: string; numero: number; total: number; vuelto: number; token: string; metodo: string; cliente?: Cliente | null;
  factura?: { id: string; numero: string } | null;
  conGarantia: LineaCarrito[];
}
interface ListaPrecio { id: string; nombre: string; activa: boolean }

export function Cobrar({ info, carrito, setCarrito, navegar }: Props) {
  const metodos = [...info.negocio.metodos_pago, ...(tieneModulo(info, "M14") ? ["fiado"] : [])];
  const [metodo, setMetodo] = useState(metodos[0] ?? "efectivo");
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [elegirCliente, setElegirCliente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [hecha, setHecha] = useState<Hecha | null>(null);
  const [sri, setSri] = useState<TEstadoSri | null>(null);
  const [comprobante, setComprobante] = useState<"nota" | "factura">("nota");
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [lista, setLista] = useState<string | null>(null);
  const [preciosLista, setPreciosLista] = useState<Map<string, number | null>>(new Map());
  const [series, setSeries] = useState(false);

  useEffect(() => {
    if (!tieneModulo(info, "M17")) return;
    api<{ listas: ListaPrecio[] }>("GET", "/listas").then((r) => setListas(r.listas.filter((l) => l.activa))).catch(() => {});
  }, [info]);
  // El cliente con lista de precios asignada la aplica sola
  useEffect(() => { if (cliente?.lista_precio_id) setLista(cliente.lista_precio_id); }, [cliente]);
  useEffect(() => {
    if (!lista || !carrito.length) { setPreciosLista(new Map()); return; }
    api<{ precios: { producto_id: string; precio: number | null }[] }>("POST", `/listas/${lista}/cotizar`, {
      items: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
    }).then((r) => setPreciosLista(new Map(r.precios.map((x) => [x.producto_id, x.precio])))).catch(() => {});
  }, [lista, carrito]);
  const precioDe = (l: LineaCarrito) => (lista ? preciosLista.get(l.producto.id) ?? l.producto.precio : l.producto.precio) ?? 0;

  useEffect(() => {
    if (!tieneModulo(info, "M19")) return;
    api<TEstadoSri>("GET", "/sri/config").then(setSri).catch(() => {});
  }, [info]);

  const total = lista ? redondear(carrito.reduce((s, l) => s + redondear(l.cantidad * precioDe(l)), 0)) : totalCarrito(carrito);
  const recibidoN = parsearNumero(recibido);
  const vuelto = metodo === "efectivo" && recibidoN !== null ? redondear(recibidoN - total) : null;
  const billetes = [...new Set([Math.ceil(total), 5, 10, 20].filter((b) => b >= total))].sort((a, b) => a - b).slice(0, 4);

  function cambiar(id: string, delta: number) {
    setCarrito((c) => c
      .map((l) => (l.producto.id === id ? { ...l, cantidad: Math.round((l.cantidad + delta) * 1000) / 1000 } : l))
      .filter((l) => l.cantidad > 0));
  }

  async function cobrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (metodo === "fiado" && !cliente) { setElegirCliente(true); return; }
    if (comprobante === "factura" && cliente && !cliente.identificacion) { setElegirCliente(true); return; }
    if (comprobante === "factura" && !cliente && total > LIMITE_CONSUMIDOR_FINAL) {
      setError(`Las facturas de más de $${LIMITE_CONSUMIDOR_FINAL} necesitan la cédula o RUC del cliente.`);
      return;
    }
    if (metodo === "efectivo" && recibidoN !== null && recibidoN < total) { setError("El efectivo recibido no alcanza."); return; }
    setOcupado(true);
    try {
      const pago: Record<string, unknown> = { metodo, monto: total };
      if (metodo === "efectivo") pago.recibido = recibidoN ?? total;
      if (referencia.trim() && metodo !== "efectivo" && metodo !== "fiado") pago.referencia = referencia.trim();
      const r = await api<{ venta: { venta_id: string; numero: number; total: number; vuelto: number; token: string }; factura: { id: string; numero: string } | null }>("POST", "/ventas", {
        items: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
        pagos: [pago],
        cliente_id: cliente?.id,
        comprobante,
        lista_id: lista ?? undefined,
      });
      setHecha({ ...r.venta, metodo, cliente, factura: r.factura,
        conGarantia: tieneModulo(info, "M23") ? carrito.filter((l) => (l.producto.garantia_meses ?? 0) > 0) : [] });
      setCarrito(() => []);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  if (hecha) {
    return (
      <main className="pagina-simple" style={{ justifyContent: "center", textAlign: "center", alignItems: "center" }}>
        <span style={{ color: "var(--success)" }}><ICheckCirculo tam={64} /></span>
        <h1>¡Venta registrada!</h1>
        <p className="muted">Venta N.º {hecha.numero} · {NOMBRES[hecha.metodo]}{hecha.cliente ? ` · ${hecha.cliente.nombre}` : ""}</p>
        <p className="monto-grande">{dinero(hecha.total)}</p>
        {hecha.metodo === "efectivo" && hecha.vuelto > 0 && (
          <div className="vuelto" style={{ width: "100%" }}><span>Vuelto</span><strong>{dinero(hecha.vuelto)}</strong></div>
        )}
        {hecha.metodo === "fiado" && <Aviso tipo="info">Quedó anotado en los fiados de {hecha.cliente?.nombre}.</Aviso>}
        {hecha.factura && <FacturaHecha id={hecha.factura.id} negocio={info.negocio.nombre} celular={hecha.cliente?.celular} />}
        <AccionesRecibo token={hecha.token} negocio={info.negocio.nombre} total={Number(hecha.total)} celular={hecha.cliente?.celular} />
        {hecha.conGarantia.length > 0 && (
          <button className="boton secundario bloque" onClick={() => setSeries(true)}>Anotar series (garantía)</button>
        )}
        {series && <AnotarSeries ventaId={hecha.venta_id} lineas={hecha.conGarantia} alCerrar={() => setSeries(false)} />}
        <button className="boton bloque" onClick={() => navegar("/")}>Nueva venta</button>
      </main>
    );
  }

  if (carrito.length === 0) {
    return (
      <main className="pagina-simple">
        <div className="vacio"><p>No hay productos en la venta.</p><button className="boton" onClick={() => navegar("/")}>Ir a vender</button></div>
      </main>
    );
  }

  return (
    <main className="pagina-simple">
      <div className="fila" style={{ justifyContent: "flex-start" }}>
        <button className="icono-boton" aria-label="Volver a vender" onClick={() => navegar("/")}><IVolver /></button>
        <h2>Cobrar</h2>
      </div>

      <div className="total-cobro">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>Total a cobrar</span>
          <span className="monto-grande">{dinero(total)}</span>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>{carrito.length === 1 ? "1 producto" : `${carrito.length} productos`}</span>
      </div>

      <div className="tarjeta" style={{ boxShadow: "none", border: "1px solid var(--border)", padding: 12 }}>
        {carrito.map((l) => (
          <div key={l.producto.id} className="linea-carrito">
            <div className="info">
              <strong>{l.producto.nombre}</strong>
              <span>{fmtCantidad(l.cantidad)} × {dinero(precioDe(l))} = {dinero(redondear(l.cantidad * precioDe(l)))}</span>
            </div>
            <div className="cantidad">
              <button type="button" aria-label={`Quitar uno de ${l.producto.nombre}`} onClick={() => cambiar(l.producto.id, l.cantidad <= 1 ? -l.cantidad : -1)}>
                {l.cantidad <= 1 ? <IBasura tam={18} /> : <IMenos tam={18} />}
              </button>
              <span aria-live="polite">{fmtCantidad(l.cantidad)}</span>
              <button type="button" aria-label={`Agregar uno de ${l.producto.nombre}`} onClick={() => cambiar(l.producto.id, 1)}><IMas tam={18} /></button>
            </div>
          </div>
        ))}
      </div>

      {listas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="etiqueta">Precios</span>
          <div className="chips" role="group" aria-label="Lista de precios">
            <button type="button" className={`chip${lista === null ? " activo" : ""}`} aria-pressed={lista === null} onClick={() => setLista(null)}>Normal</button>
            {listas.map((l) => (
              <button type="button" key={l.id} className={`chip${lista === l.id ? " activo" : ""}`} aria-pressed={lista === l.id} onClick={() => setLista(l.id)}>{l.nombre}</button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={cobrar} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="etiqueta" id="como-paga">¿Cómo te paga?</span>
          <div className="opciones" role="group" aria-labelledby="como-paga">
            {metodos.map((m) => (
              <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} aria-pressed={metodo === m}
                onClick={() => { setMetodo(m); setError(null); if (m === "fiado" && !cliente) setElegirCliente(true); }}>{NOMBRES[m] ?? m}</button>
            ))}
          </div>
        </div>

        {metodo === "efectivo" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="etiqueta">Recibido</span>
            <div className="opciones" style={{ gridTemplateColumns: `repeat(${billetes.length}, minmax(0, 1fr))` }}>
              {billetes.map((b) => (
                <button type="button" key={b} className={`opcion${recibidoN === b ? " activa" : ""}`} onClick={() => setRecibido(String(b))}>$ {b}</button>
              ))}
            </div>
            <CampoMonto id="recibido" etiqueta="Otro monto" valor={recibido} alCambiar={setRecibido} />
            {vuelto !== null && vuelto >= 0 && (
              <div className="vuelto" aria-live="polite"><span style={{ fontWeight: 600 }}>Vuelto</span><strong>{dinero(vuelto)}</strong></div>
            )}
          </div>
        )}

        {(metodo === "transferencia" || metodo === "tarjeta" || metodo === "deuna") && (
          <div className="campo">
            <label htmlFor="referencia">Referencia (opcional)</label>
            <input id="referencia" className="entrada" maxLength={80} placeholder="Banco o número de comprobante" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
        )}

        {sri?.listo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="etiqueta" id="comprobante">Comprobante</span>
            <div className="opciones" role="group" aria-labelledby="comprobante">
              <button type="button" className={`opcion${comprobante === "nota" ? " activa" : ""}`} aria-pressed={comprobante === "nota"}
                onClick={() => setComprobante("nota")}>Nota de venta</button>
              <button type="button" className={`opcion${comprobante === "factura" ? " activa" : ""}`} aria-pressed={comprobante === "factura"}
                onClick={() => { setComprobante("factura"); setError(null); }}>Factura</button>
            </div>
            {comprobante === "factura" && metodo !== "fiado" && (
              cliente ? (
                <div className="item-opcion activo">
                  <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.identificacion ?? "Falta su cédula o RUC"}</span></span>
                  <button type="button" className="boton texto" onClick={() => setCliente(null)}>Consumidor final</button>
                </div>
              ) : (
                <div className="item-opcion">
                  <span className="textos">
                    <strong>Consumidor final</strong>
                    <span>{total > LIMITE_CONSUMIDOR_FINAL ? `Más de $${LIMITE_CONSUMIDOR_FINAL}: pide cédula o RUC` : "Sin datos del cliente"}</span>
                  </span>
                  <button type="button" className="boton texto" onClick={() => setElegirCliente(true)}>Con datos</button>
                </div>
              )
            )}
            {sri.config?.ambiente === 1 && comprobante === "factura" && (
              <p className="muted" style={{ fontSize: 13 }}>Ambiente de pruebas: la factura no tiene validez tributaria.</p>
            )}
          </div>
        )}

        {metodo === "fiado" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="etiqueta">¿A quién le fías?</span>
            {cliente ? (
              <div className="item-opcion activo">
                <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.saldo > 0 ? `Ya debe ${dinero(cliente.saldo)}` : "Sin deudas"}</span></span>
                <button type="button" className="boton texto" onClick={() => setElegirCliente(true)}>Cambiar</button>
              </div>
            ) : (
              <button type="button" className="boton secundario" onClick={() => setElegirCliente(true)}>Elegir cliente</button>
            )}
          </div>
        )}

        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" style={{ minHeight: 56, fontSize: 17 }} disabled={ocupado}>
          {ocupado ? (comprobante === "factura" ? "Firmando la factura…" : "Registrando…")
            : metodo === "fiado" ? `Guardar fiado de ${dinero(total)}` : `Cobrar ${dinero(total)}`}
        </button>
      </form>

      {elegirCliente && (
        <ElegirCliente paraFactura={comprobante === "factura"} inicial={cliente}
          alCerrar={() => setElegirCliente(false)} alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />
      )}
    </main>
  );
}

function AnotarSeries({ ventaId, lineas, alCerrar }: { ventaId: string; lineas: LineaCarrito[]; alCerrar: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [hechas, setHechas] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    for (const l of lineas) {
      for (const serie of (valores[l.producto.id] ?? "").split(/[\s,;]+/).filter(Boolean)) {
        try {
          const r = await api<{ serie: { garantia_hasta: string | null } }>("POST", `/ventas/${ventaId}/series`, { producto_id: l.producto.id, serie });
          setHechas((h) => ({ ...h, [serie]: r.serie.garantia_hasta ?? "" }));
        } catch (err) { setError(`${serie}: ${mensajeDe(err)}`); return; }
      }
    }
    alCerrar();
  }
  return (
    <Dialogo titulo="Series vendidas" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
        {lineas.map((l) => (
          <div key={l.producto.id} className="campo">
            <label htmlFor={`s-${l.producto.id}`}>{l.producto.nombre} ({l.producto.garantia_meses} meses de garantía)</label>
            <input id={`s-${l.producto.id}`} className="entrada" placeholder={l.cantidad > 1 ? "Una o varias, separadas por coma" : "Número de serie o IMEI"}
              value={valores[l.producto.id] ?? ""} onChange={(e) => setValores({ ...valores, [l.producto.id]: e.target.value })} />
          </div>
        ))}
        {Object.keys(hechas).length > 0 && <Aviso tipo="exito">Anotadas: {Object.keys(hechas).join(", ")}</Aviso>}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque">Guardar series</button>
      </form>
    </Dialogo>
  );
}

function FacturaHecha({ id, negocio, celular }: { id: string; negocio: string; celular?: string | null }) {
  const c = useSeguimiento(id);
  if (!c) return <p className="muted">Factura firmada. Enviando al SRI…</p>;
  const problema = c.estado === "devuelto" || c.estado === "no_autorizado";
  return (
    <div className="tarjeta" style={{ width: "100%", boxShadow: "none", border: "1px solid var(--border)", textAlign: "left" }}>
      <div className="fila">
        <strong>Factura {c.numero}</strong>
        <EstadoSri estado={c.estado} />
      </div>
      {(c.estado === "firmado" || c.estado === "recibido") && (
        <p className="muted" style={{ fontSize: 14 }}>
          {c.mensajes[0]?.mensaje ?? "El SRI la está revisando."} Si tarda, se reintenta sola; también puedes verla en Facturación.
        </p>
      )}
      {problema && <Aviso tipo="error">{c.mensajes[0]?.mensaje ?? "El SRI no la aceptó."} Revísala en Facturación.</Aviso>}
      {c.estado === "autorizado" && (
        <div className="acciones-fila">
          <a className="boton secundario pequeno" href={enlaceRide(c)} target="_blank" rel="noopener">Ver factura</a>
          <a className="boton secundario pequeno" href={enlaceWhatsApp(c, negocio, celular)} target="_blank" rel="noopener">Enviar por WhatsApp</a>
        </div>
      )}
    </div>
  );
}

export function ElegirCliente({ alCerrar, alElegir, paraFactura = false, inicial = null }: {
  alCerrar: () => void; alElegir: (c: Cliente) => void; paraFactura?: boolean; inicial?: Cliente | null;
}) {
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  // Para facturar, un cliente sin cédula se completa antes de elegirlo
  const [editando, setEditando] = useState<Cliente | "nuevo" | null>(paraFactura && inicial && !inicial.identificacion ? inicial : null);
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [celular, setCelular] = useState(inicial?.celular ?? "");
  const [identificacion, setIdentificacion] = useState("");
  const [correo, setCorreo] = useState(inicial?.correo ?? "");
  const [direccion, setDireccion] = useState(inicial?.direccion ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ clientes: Cliente[] }>("GET", "/clientes?q=" + encodeURIComponent(q)).then((r) => setClientes(r.clientes)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function elegir(c: Cliente) {
    if (paraFactura && !c.identificacion) {
      setEditando(c);
      setNombre(c.nombre); setCelular(c.celular ?? ""); setCorreo(c.correo ?? ""); setDireccion(c.direccion ?? "");
      setIdentificacion("");
      return;
    }
    alElegir(c);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const datos = {
      nombre, celular: celular || undefined, identificacion: identificacion || undefined,
      correo: correo || undefined, direccion: direccion || undefined,
    };
    try {
      const r = editando && editando !== "nuevo"
        ? await api<{ cliente: Cliente }>("PATCH", `/clientes/${editando.id}`, datos)
        : await api<{ cliente: Cliente }>("POST", "/clientes", datos);
      alElegir({ ...r.cliente, saldo: editando && editando !== "nuevo" ? editando.saldo : 0 });
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  const pideId = paraFactura;
  return (
    <Dialogo titulo={editando === "nuevo" ? "Nuevo cliente" : editando ? `Datos de ${editando.nombre}` : "Elegir cliente"} alCerrar={alCerrar}>
      {editando ? (
        <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {editando !== "nuevo" && pideId && <Aviso tipo="info">Para facturarle falta su cédula o RUC.</Aviso>}
          <div className="campo">
            <label htmlFor="cli-nombre">{pideId ? "Nombre o razón social" : "Nombre"}</label>
            <input id="cli-nombre" className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="cli-id">Cédula o RUC{pideId ? "" : " (para facturarle)"}</label>
            <input id="cli-id" className="entrada" inputMode="numeric" maxLength={20} value={identificacion} onChange={(e) => setIdentificacion(e.target.value.trim())} />
          </div>
          <div className="campo">
            <label htmlFor="cli-cel">Celular (para enviarle la factura o recordarle por WhatsApp)</label>
            <input id="cli-cel" className="entrada" type="tel" inputMode="tel" value={celular} onChange={(e) => setCelular(e.target.value)} />
          </div>
          {pideId && (
            <>
              <div className="campo">
                <label htmlFor="cli-correo">Correo (opcional)</label>
                <input id="cli-correo" className="entrada" type="email" inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="cli-dir">Dirección (opcional)</label>
                <input id="cli-dir" className="entrada" maxLength={300} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
              </div>
            </>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={nombre.trim().length < 2 || (pideId && identificacion.length < 5)}>Guardar cliente</button>
        </form>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="cli-buscar">Buscar</label>
            <input id="cli-buscar" className="entrada" placeholder={paraFactura ? "Nombre, cédula o RUC" : "Nombre o celular"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="lista-opciones">
            {clientes.map((c) => (
              <button key={c.id} className="item-opcion" onClick={() => elegir(c)}>
                <span className="textos">
                  <strong>{c.nombre}</strong>
                  <span>{paraFactura ? (c.identificacion ?? "Sin cédula ni RUC") : c.saldo > 0 ? `Debe ${dinero(c.saldo)}` : c.celular ?? "Sin deudas"}</span>
                </span>
              </button>
            ))}
            {clientes.length === 0 && <p className="muted">No hay clientes con ese nombre.</p>}
          </div>
          <button className="boton secundario" onClick={() => {
            setEditando("nuevo");
            if (/^\d{10}(\d{3})?$/.test(q)) { setIdentificacion(q); setNombre(""); } else setNombre(q);
          }}>Nuevo cliente</button>
        </>
      )}
    </Dialogo>
  );
}
