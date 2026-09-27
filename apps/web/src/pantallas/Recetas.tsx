import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBasura, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";

interface InsumoReceta { insumo_id: string; nombre: string; unidad: string; cantidad: number; costo: number | null; costo_linea: number }

/** Recetas: qué insumos gasta cada plato y cuánto cuesta hacerlo. */
export function Recetas({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [platos, setPlatos] = useState<Producto[] | null>(null);
  const [insumos, setInsumos] = useState<Producto[]>([]);
  const [editar, setEditar] = useState<Producto | null>(null);
  const [nuevoInsumo, setNuevoInsumo] = useState(false);
  const puede = info.rol !== "cajero";

  const cargar = useCallback(() => {
    Promise.all([
      api<{ productos: Producto[] }>("GET", "/productos"),
      api<{ productos: Producto[] }>("GET", "/productos?tipo=insumo"),
    ]).then(([v, i]) => { setPlatos(v.productos); setInsumos(i.productos); }).catch(() => setPlatos([]));
  }, []);
  useEffect(cargar, [cargar]);

  if (!platos) return <Cargando />;
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Recetas</h1>
      <p className="muted">Al vender un plato con receta, baja el stock de sus insumos y la utilidad usa su costo real.</p>
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        {platos.map((p) => (
          <button key={p.id} className="fila" disabled={!puede} onClick={() => setEditar(p)}
            style={{ background: "none", border: "none", borderBottom: "1px solid var(--border)", width: "100%", textAlign: "left", padding: "12px 0" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong>{p.nombre}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{p.precio !== null ? `Se vende a ${dinero(p.precio)}` : "Sin precio"}</span>
            </span>
            {p.tiene_receta ? <span className="insignia ok">Con receta</span> : <span className="insignia gris">Sin receta</span>}
          </button>
        ))}
        {platos.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>Primero crea lo que vendes en {info.negocio.palabra_items}.</p>}
      </div>

      <div className="tarjeta" style={{ padding: "12px 16px" }}>
        <div className="fila">
          <h3>Insumos</h3>
          {puede && <button className="boton pequeno secundario" onClick={() => setNuevoInsumo(true)}><IMas tam={18} /> Insumo</button>}
        </div>
        {insumos.map((i) => (
          <div key={i.id} className="fila" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong>{i.nombre}</strong>
              <span className="muted" style={{ fontSize: 13 }}>Stock {fmtCantidad(i.stock)} {i.unidad.toLowerCase()}</span>
            </span>
            <span>{i.costo !== null ? `${dinero(i.costo)} / ${i.unidad.toLowerCase()}` : "Sin costo"}</span>
          </div>
        ))}
        {insumos.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Arroz, pollo, aceite… lo que compras para preparar. Sube su stock con Compras.</p>}
      </div>
      {editar && <EditarReceta plato={editar} alCerrar={() => setEditar(null)} alGuardar={(c) => { setEditar(null); avisar(`Receta guardada: cuesta ${dinero(c)} hacerlo`); cargar(); }} />}
      {nuevoInsumo && <NuevoInsumo alCerrar={() => setNuevoInsumo(false)} alGuardar={() => { setNuevoInsumo(false); avisar("Insumo creado"); cargar(); }} />}
    </div>
  );
}

function EditarReceta({ plato, alCerrar, alGuardar }: { plato: Producto; alCerrar: () => void; alGuardar: (costo: number) => void }) {
  const [lineas, setLineas] = useState<{ insumo: { id: string; nombre: string; unidad: string; costo: number | null }; cantidad: string }[] | null>(null);
  const [elegir, setElegir] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ insumos: InsumoReceta[] }>("GET", `/recetas/${plato.id}`).then((r) => setLineas(r.insumos.map((i) => ({
      insumo: { id: i.insumo_id, nombre: i.nombre, unidad: i.unidad, costo: i.costo }, cantidad: String(i.cantidad).replace(".", ","),
    })))).catch((e) => setError(mensajeDe(e)));
  }, [plato.id]);

  const costo = (lineas ?? []).reduce((s, l) => s + (parsearNumero(l.cantidad) ?? 0) * (l.insumo.costo ?? 0), 0);
  const margen = plato.precio ? Math.round((1 - costo / plato.precio) * 100) : null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ costo: number }>("POST", `/recetas/${plato.id}`, {
        insumos: (lineas ?? []).map((l) => ({ insumo_id: l.insumo.id, cantidad: parsearNumero(l.cantidad) })),
      });
      alGuardar(r.costo);
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo={`Receta: ${plato.nombre}`} alCerrar={alCerrar}>
      {!lineas ? <Cargando /> : (
        <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="muted">¿Cuánto de cada insumo lleva una unidad?</p>
          {lineas.map((l, i) => (
            <div key={l.insumo.id} className="rejilla-2" style={{ alignItems: "end" }}>
              <CampoMonto id={`r-${i}`} etiqueta={`${l.insumo.nombre} (${l.insumo.unidad.toLowerCase()})`} valor={l.cantidad}
                alCambiar={(v) => setLineas((ls) => ls!.map((x, j) => (j === i ? { ...x, cantidad: v } : x)))} />
              <div className="fila">
                <span className="muted">{dinero((parsearNumero(l.cantidad) ?? 0) * (l.insumo.costo ?? 0))}</span>
                <button type="button" className="icono-boton" aria-label={`Quitar ${l.insumo.nombre}`} onClick={() => setLineas((ls) => ls!.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
              </div>
            </div>
          ))}
          <button type="button" className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar insumo</button>
          <div className="vuelto">
            <span style={{ fontWeight: 600 }}>Cuesta hacerlo{margen !== null ? ` · ganas ${margen} %` : ""}</span>
            <strong>{dinero(costo)}</strong>
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque">Guardar receta</button>
        </form>
      )}
      {elegir && <SelectorProducto titulo="Elegir insumo" filtro="insumo" alCerrar={() => setElegir(false)} alElegir={(p) => {
        setElegir(false);
        if (!(lineas ?? []).some((l) => l.insumo.id === p.id)) {
          setLineas((ls) => [...(ls ?? []), { insumo: { id: p.id, nombre: p.nombre, unidad: p.unidad, costo: p.costo }, cantidad: "" }]);
        }
      }} />}
    </Dialogo>
  );
}

function NuevoInsumo({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("Kilo");
  const [costo, setCosto] = useState("");
  const [stock, setStock] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/productos", { nombre, unidad, tipo: "insumo", costo: parsearNumero(costo) ?? undefined, stock_inicial: parsearNumero(stock) ?? undefined });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Nuevo insumo" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="ni-n">Nombre</label>
          <input id="ni-n" className="entrada" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ni-u">Unidad</label>
          <select id="ni-u" className="entrada" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            {["Kilo", "Libra", "Litro", "Unidad", "Gramo", "Mililitro", "Onza"].map((u) => <option key={u}>{u}</option>)}
          </select></div>
        <div className="rejilla-2">
          <CampoMonto id="ni-c" etiqueta={`Costo por ${unidad.toLowerCase()}`} valor={costo} alCambiar={setCosto} />
          <CampoMonto id="ni-s" etiqueta="Tienes ahora" valor={stock} alCambiar={setStock} />
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={nombre.trim().length < 2}>Crear insumo</button>
      </form>
    </Dialogo>
  );
}
