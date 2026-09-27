import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { puedeGestionar } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IMas, IVolver } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { DialogoCobro } from "../componentes/DialogoCobro";

interface Item {
  id: number; producto_id: string; nombre: string; cantidad: number; precio: number; total: number;
  nota: string | null; cocina: "pendiente" | "enviado" | "listo" | "entregado"; cobrado: boolean;
}
interface CuentaDatos { id: string; numero: number; mesa: string | null; mesa_id: string | null; nombre: string | null; estado: string; personas: number | null }

const COCINA: Record<Item["cocina"], [string, string]> = {
  pendiente: ["Sin enviar", "gris"], enviado: ["En cocina", "no"], listo: ["Listo", "ok"], entregado: ["Servido", "gris"],
};

export function Cuenta({ id, info, navegar, avisar }: { id: string; info: InfoNegocio; navegar: (r: string) => void; avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ cuenta: CuentaDatos; items: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegir, setElegir] = useState(false);
  const [agregar, setAgregar] = useState<Producto | null>(null);
  const [cobrar, setCobrar] = useState(false);
  const [seleccion, setSeleccion] = useState<number[] | null>(null);    // null = toda la cuenta
  const [mover, setMover] = useState(false);

  const cargar = useCallback(() => {
    api<{ cuenta: CuentaDatos; items: Item[] }>("GET", `/cuentas/${id}`).then(setDatos).catch((e) => setError(mensajeDe(e)));
  }, [id]);
  useEffect(cargar, [cargar]);

  if (error) return <div className="contenido"><Aviso tipo="error">{error}</Aviso></div>;
  if (!datos) return <Cargando />;
  const { cuenta, items } = datos;
  const titulo = cuenta.mesa ? `Mesa ${cuenta.mesa}` : cuenta.nombre ?? `Cuenta ${cuenta.numero}`;
  const porCobrar = items.filter((i) => !i.cobrado);
  const totalPendiente = redondear(porCobrar.reduce((s, i) => s + i.total, 0));
  const sinEnviar = items.filter((i) => i.cocina === "pendiente" && !i.cobrado).length;
  const abierta = cuenta.estado === "abierta";
  const totalSeleccion = seleccion ? redondear(porCobrar.filter((i) => seleccion.includes(i.id)).reduce((s, i) => s + i.total, 0)) : totalPendiente;

  async function accion(ruta: string, aviso: string, volver = false) {
    try { await api("POST", ruta); avisar(aviso); if (volver) navegar("/mesas"); else cargar(); } catch (e) { avisar(mensajeDe(e)); }
  }

  return (
    <div className="contenido" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <div className="fila" style={{ justifyContent: "flex-start" }}>
        <button className="icono-boton" aria-label="Volver a las mesas" onClick={() => navegar("/mesas")}><IVolver /></button>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h1>{titulo}</h1>
          <span className="muted" style={{ fontSize: 13 }}>Cuenta N.º {cuenta.numero}{cuenta.personas ? ` · ${cuenta.personas} personas` : ""}</span>
        </div>
      </div>
      {!abierta && <Aviso tipo="info">Esta cuenta ya está {cuenta.estado}.</Aviso>}

      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {items.map((i) => (
          <div key={i.id} className="comprobante-fila">
            <div className="textos">
              <strong>{fmtCantidad(i.cantidad)} × {i.nombre}</strong>
              {i.nota && <span>«{i.nota}»</span>}
              <span style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {i.cobrado ? <span className="insignia ok">Cobrado</span> : <span className={`insignia ${COCINA[i.cocina][1]}`}>{COCINA[i.cocina][0]}</span>}
                {abierta && !i.cobrado && (i.cocina === "pendiente" || puedeGestionar(info.rol)) && (
                  <button className="boton texto pequeno" onClick={() => accion(`/cuentas/items/${i.id}/quitar`, `${i.nombre} quitado`)}>Quitar</button>
                )}
              </span>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {seleccion && !i.cobrado && (
                <input type="checkbox" aria-label={`Cobrar ${i.nombre}`} style={{ width: 22, height: 22 }} checked={seleccion.includes(i.id)}
                  onChange={(e) => setSeleccion((s) => (e.target.checked ? [...(s ?? []), i.id] : (s ?? []).filter((x) => x !== i.id)))} />
              )}
              <strong className={i.cobrado ? "anulada" : ""}>{dinero(i.total)}</strong>
            </span>
          </div>
        ))}
        {items.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Agrega lo que piden.</p>}
      </div>

      {abierta && (
        <>
          <button className="boton secundario bloque" onClick={() => setElegir(true)}><IMas tam={20} /> Agregar</button>
          {sinEnviar > 0 && (
            <button className="boton bloque" onClick={() => accion(`/cuentas/${id}/cocina`, "Enviado a cocina")}>Enviar a cocina ({sinEnviar})</button>
          )}
          <div className="total-cobro">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>{seleccion ? "Cobrar lo marcado" : "Por cobrar"}</span>
              <span className="monto-grande">{dinero(totalSeleccion)}</span>
            </div>
            <button className="boton texto pequeno" onClick={() => setSeleccion(seleccion ? null : [])}>{seleccion ? "Toda la cuenta" : "Dividir"}</button>
          </div>
          <button className="boton bloque" style={{ minHeight: 56, fontSize: 17 }} disabled={totalSeleccion <= 0} onClick={() => setCobrar(true)}>
            Cobrar {dinero(totalSeleccion)}
          </button>
          <div className="acciones-fila">
            {cuenta.mesa_id && <button className="boton texto pequeno" onClick={() => setMover(true)}>Cambiar de mesa</button>}
            {porCobrar.length === items.length && (
              <button className="boton texto pequeno" onClick={() => accion(`/cuentas/${id}/anular`, "Cuenta anulada", true)}>Anular cuenta</button>
            )}
          </div>
        </>
      )}

      {elegir && <SelectorProducto titulo="¿Qué piden?" alCerrar={() => setElegir(false)} alElegir={(p) => { setElegir(false); setAgregar(p); }} />}
      {agregar && <AgregarItem cuentaId={id} producto={agregar} alCerrar={() => setAgregar(null)} alGuardar={() => { setAgregar(null); cargar(); }} />}
      {cobrar && (
        <DialogoCobro info={info} titulo={`Cobrar ${titulo}`} total={totalSeleccion} alCerrar={() => setCobrar(false)}
          cobrar={async (d) => {
            const r = await api<{ venta: { numero: number; cuenta_cerrada: boolean } }>("POST", `/cuentas/${id}/cobrar`, { ...d, items: seleccion ?? undefined });
            setCobrar(false);
            setSeleccion(null);
            avisar(`Venta N.º ${r.venta.numero} registrada`);
            if (r.venta.cuenta_cerrada) navegar("/mesas"); else cargar();
          }} />
      )}
      {mover && <MoverMesa cuentaId={id} alCerrar={() => setMover(false)} alMover={() => { setMover(false); avisar("Cuenta movida"); cargar(); }} />}
    </div>
  );
}

function AgregarItem({ cuentaId, producto, alCerrar, alGuardar }: { cuentaId: string; producto: Producto; alCerrar: () => void; alGuardar: () => void }) {
  const [cantidad, setCantidad] = useState("1");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", `/cuentas/${cuentaId}/items`, { items: [{ producto_id: producto.id, cantidad: parsearNumero(cantidad), nota: nota || undefined }] });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={producto.nombre} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">{dinero(producto.precio)} cada uno</p>
        <div className="opciones" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {["1", "2", "3", "4"].map((n) => (
            <button type="button" key={n} className={`opcion${cantidad === n ? " activa" : ""}`} onClick={() => setCantidad(n)}>{n}</button>
          ))}
        </div>
        <CampoMonto id="ai-cant" etiqueta="Otra cantidad" valor={cantidad} alCambiar={setCantidad} />
        <div className="campo"><label htmlFor="ai-nota">Nota para cocina (opcional)</label>
          <input id="ai-nota" className="entrada" maxLength={120} placeholder="Sin cebolla, término medio…" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!(parsearNumero(cantidad) ?? 0)}>Agregar {dinero(redondear((parsearNumero(cantidad) ?? 0) * (producto.precio ?? 0)))}</button>
      </form>
    </Dialogo>
  );
}

function MoverMesa({ cuentaId, alCerrar, alMover }: { cuentaId: string; alCerrar: () => void; alMover: () => void }) {
  const [mesas, setMesas] = useState<{ id: string; nombre: string; cuenta_id: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ mesas: typeof mesas }>("GET", "/mesas").then((r) => setMesas(r.mesas.filter((m) => !m.cuenta_id))).catch(() => {}); }, []);
  async function mover(mesa: string) {
    try { await api("POST", `/cuentas/${cuentaId}/mover`, { mesa_id: mesa }); alMover(); } catch (e) { setError(mensajeDe(e)); }
  }
  return (
    <Dialogo titulo="¿A qué mesa?" alCerrar={alCerrar}>
      <div className="rejilla-mesas">
        {mesas.map((m) => <button key={m.id} className="mesa" onClick={() => mover(m.id)}><strong>{m.nombre}</strong><span className="mesa-tiempo">Libre</span></button>)}
      </div>
      {mesas.length === 0 && <p className="muted">No hay mesas libres.</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </Dialogo>
  );
}
