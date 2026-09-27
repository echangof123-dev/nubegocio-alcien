import { useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, InfoNegocio, LineaCarrito } from "../tipos";
import { tieneModulo } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Dialogo } from "../componentes/basicos";
import { IBasura, ICheckCirculo, IMas, IMenos, IVolver } from "../componentes/iconos";
import { totalCarrito } from "./Vender";

type Props = {
  info: InfoNegocio;
  carrito: LineaCarrito[];
  setCarrito: (f: (c: LineaCarrito[]) => LineaCarrito[]) => void;
  navegar: (ruta: string) => void;
};

const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado" };

interface Hecha { numero: number; total: number; vuelto: number; metodo: string; cliente?: string }

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

  const total = totalCarrito(carrito);
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
    if (metodo === "efectivo" && recibidoN !== null && recibidoN < total) { setError("El efectivo recibido no alcanza."); return; }
    setOcupado(true);
    try {
      const pago: Record<string, unknown> = { metodo, monto: total };
      if (metodo === "efectivo") pago.recibido = recibidoN ?? total;
      if (referencia.trim() && metodo !== "efectivo" && metodo !== "fiado") pago.referencia = referencia.trim();
      const r = await api<{ venta: { numero: number; total: number; vuelto: number } }>("POST", "/ventas", {
        items: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
        pagos: [pago],
        cliente_id: cliente?.id,
      });
      setHecha({ ...r.venta, metodo, cliente: cliente?.nombre });
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
        <p className="muted">Venta N.º {hecha.numero} · {NOMBRES[hecha.metodo]}{hecha.cliente ? ` · ${hecha.cliente}` : ""}</p>
        <p className="monto-grande">{dinero(hecha.total)}</p>
        {hecha.metodo === "efectivo" && hecha.vuelto > 0 && (
          <div className="vuelto" style={{ width: "100%" }}><span>Vuelto</span><strong>{dinero(hecha.vuelto)}</strong></div>
        )}
        {hecha.metodo === "fiado" && <Aviso tipo="info">Quedó anotado en los fiados de {hecha.cliente}.</Aviso>}
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
              <span>{fmtCantidad(l.cantidad)} × {dinero(l.producto.precio)} = {dinero(redondear(l.cantidad * (l.producto.precio ?? 0)))}</span>
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
          {ocupado ? "Registrando…" : metodo === "fiado" ? `Guardar fiado de ${dinero(total)}` : `Cobrar ${dinero(total)}`}
        </button>
      </form>

      {elegirCliente && (
        <ElegirCliente alCerrar={() => setElegirCliente(false)} alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />
      )}
    </main>
  );
}

export function ElegirCliente({ alCerrar, alElegir }: { alCerrar: () => void; alElegir: (c: Cliente) => void }) {
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ clientes: Cliente[] }>("GET", "/clientes?q=" + encodeURIComponent(q)).then((r) => setClientes(r.clientes)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function crear(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ cliente: Cliente }>("POST", "/clientes", { nombre, celular: celular || undefined });
      alElegir(r.cliente);
    } catch (err) {
      setError(mensajeDe(err));
    }
  }

  return (
    <Dialogo titulo={nuevo ? "Nuevo cliente" : "Elegir cliente"} alCerrar={alCerrar}>
      {nuevo ? (
        <form onSubmit={crear} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="campo">
            <label htmlFor="cli-nombre">Nombre</label>
            <input id="cli-nombre" className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="cli-cel">Celular (para recordarle por WhatsApp)</label>
            <input id="cli-cel" className="entrada" type="tel" inputMode="tel" value={celular} onChange={(e) => setCelular(e.target.value)} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={nombre.trim().length < 2}>Guardar cliente</button>
        </form>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="cli-buscar">Buscar</label>
            <input id="cli-buscar" className="entrada" placeholder="Nombre o celular" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="lista-opciones">
            {clientes.map((c) => (
              <button key={c.id} className="item-opcion" onClick={() => alElegir(c)}>
                <span className="textos"><strong>{c.nombre}</strong><span>{c.saldo > 0 ? `Debe ${dinero(c.saldo)}` : c.celular ?? "Sin deudas"}</span></span>
              </button>
            ))}
            {clientes.length === 0 && <p className="muted">No hay clientes con ese nombre.</p>}
          </div>
          <button className="boton secundario" onClick={() => { setNuevo(true); setNombre(q); }}>Nuevo cliente</button>
        </>
      )}
    </Dialogo>
  );
}
