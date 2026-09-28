import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";

interface PrecioLista { producto_id: string; nombre: string; precio_normal: number | null; desde_cantidad: number; precio: number }
interface Lista { id: string; nombre: string; descuento_pct: number; activa: boolean; clientes: number; precios: PrecioLista[] }

/** Listas de precios: mayorista, distribuidor, por volumen… */
export function Listas({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [listas, setListas] = useState<Lista[] | null>(null);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<{ listas: Lista[] }>("GET", "/listas").then((r) => setListas(r.listas)).catch(() => setListas([]));
  }, []);
  useEffect(cargar, [cargar]);

  if (!listas) return <Cargando />;
  const actual = listas.find((l) => l.id === abierta);

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Listas de precios</h1>
      <p className="muted">Al cobrar eliges la lista, o se aplica sola si el cliente la tiene asignada.</p>
      {gestiona && <button className="boton bloque" onClick={() => setNueva(true)}><IMas tam={20} /> Nueva lista</button>}
      {listas.map((l) => (
        <div key={l.id} className="tarjeta">
          <div className="fila">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h3>{l.nombre}</h3>
              <span className="muted" style={{ fontSize: 13 }}>
                {l.descuento_pct > 0 ? `${l.descuento_pct} % menos en todo lo demás` : "Precio normal en lo demás"} · {l.precios.length} precios especiales · {l.clientes} clientes
              </span>
            </div>
            <button className="boton texto pequeno" onClick={() => setAbierta(abierta === l.id ? null : l.id)}>{abierta === l.id ? "Cerrar" : "Ver precios"}</button>
          </div>
          {abierta === l.id && actual && <PreciosLista lista={actual} gestiona={gestiona} alCambiar={cargar} avisar={avisar} />}
        </div>
      ))}
      {listas.length === 0 && <div className="vacio"><p>Crea listas como “Mayorista” o “Distribuidor” con sus propios precios.</p></div>}
      {nueva && <NuevaLista alCerrar={() => setNueva(false)} alGuardar={() => { setNueva(false); avisar("Lista creada"); cargar(); }} />}
    </div>
  );
}

function PreciosLista({ lista, gestiona, alCambiar, avisar }: { lista: Lista; gestiona: boolean; alCambiar: () => void; avisar: (t: string) => void }) {
  const [elegir, setElegir] = useState(false);
  const [producto, setProducto] = useState<{ id: string; nombre: string; precio: number | null } | null>(null);
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState("1");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", `/listas/${lista.id}/precios`, { producto_id: producto!.id, precio: parsearNumero(precio), desde_cantidad: parsearNumero(desde) ?? 1 });
      setProducto(null); setPrecio(""); setDesde("1");
      avisar("Precio guardado");
      alCambiar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  async function quitar(p: PrecioLista) {
    try { await api("POST", `/listas/${lista.id}/precios`, { producto_id: p.producto_id, desde_cantidad: p.desde_cantidad, precio: null }); alCambiar(); }
    catch (err) { avisar(mensajeDe(err)); }
  }

  return (
    <>
      {lista.precios.map((p) => (
        <div key={`${p.producto_id}-${p.desde_cantidad}`} className="fila" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong>{p.nombre}</strong>
            <span className="muted" style={{ fontSize: 13 }}>{p.desde_cantidad > 1 ? `Desde ${fmtCantidad(p.desde_cantidad)} unidades · ` : ""}normal {dinero(p.precio_normal)}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>{dinero(p.precio)}</strong>
            {gestiona && <button className="boton texto pequeno" onClick={() => quitar(p)}>Quitar</button>}
          </span>
        </div>
      ))}
      {gestiona && (producto ? (
        <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <strong>{producto.nombre} <span className="muted" style={{ fontWeight: 400 }}>(normal {dinero(producto.precio)})</span></strong>
          <div className="rejilla-2">
            <CampoMonto id="lp-precio" etiqueta="Precio en esta lista" valor={precio} alCambiar={setPrecio} />
            <CampoMonto id="lp-desde" etiqueta="Desde cuántas unidades" valor={desde} alCambiar={setDesde} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="boton pequeno" disabled={parsearNumero(precio) === null}>Guardar precio</button>
            <button type="button" className="boton pequeno secundario" onClick={() => setProducto(null)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button className="boton secundario pequeno" onClick={() => setElegir(true)}><IMas tam={18} /> Precio especial</button>
      ))}
      {elegir && <SelectorProducto alCerrar={() => setElegir(false)} alElegir={(p) => { setElegir(false); setProducto(p); }} />}
    </>
  );
}

function NuevaLista({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState("Mayorista");
  const [descuento, setDescuento] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", "/listas", { nombre, descuento_pct: parsearNumero(descuento) ?? 0 }); alGuardar(); } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Nueva lista de precios" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="nl-n">Nombre</label>
          <input id="nl-n" className="entrada" maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <CampoMonto id="nl-d" etiqueta="Descuento general en % (opcional)" valor={descuento} alCambiar={setDescuento} />
        <p className="muted" style={{ fontSize: 13 }}>Después puedes poner precios especiales por producto y por volumen.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={nombre.trim().length < 2}>Crear lista</button>
      </form>
    </Dialogo>
  );
}
