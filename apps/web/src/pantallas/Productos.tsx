import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Categoria, InfoNegocio, Producto } from "../tipos";
import { puedeGestionar } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IMas } from "../componentes/iconos";

export function Productos({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [texto, setTexto] = useState("");
  const [editar, setEditar] = useState<Producto | "nuevo" | null>(null);
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);

  const cargar = useCallback(() => {
    Promise.all([
      api<{ productos: Producto[] }>("GET", "/productos"),
      api<{ categorias: Categoria[] }>("GET", "/categorias"),
    ]).then(([p, c]) => { setProductos(p.productos); setCategorias(c.categorias); }).catch(() => setProductos([]));
  }, []);
  useEffect(cargar, [cargar]);

  const visibles = useMemo(() => (productos ?? []).filter((p) =>
    (!soloSinPrecio || p.precio === null) && p.nombre.toLowerCase().includes(texto.trim().toLowerCase())), [productos, texto, soloSinPrecio]);

  if (!productos) return <Cargando />;
  const gestiona = puedeGestionar(info.rol) || info.rol === "bodeguero";
  const sinPrecio = productos.filter((p) => p.precio === null).length;

  return (
    <div className="contenido">
      <div className="fila">
        <h1>{info.negocio.palabra_items}</h1>
        {gestiona && <button className="boton pequeno" onClick={() => setEditar("nuevo")}><IMas tam={18} /> Nuevo</button>}
      </div>
      <div className="con-icono">
        <IBuscar tam={20} />
        <label htmlFor="buscar-prod" className="oculto">Buscar</label>
        <input id="buscar-prod" className="entrada" placeholder="Buscar" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {sinPrecio > 0 && (
        <div className="chips">
          <button className={`chip${!soloSinPrecio ? " activo" : ""}`} onClick={() => setSoloSinPrecio(false)}>Todos ({productos.length})</button>
          <button className={`chip${soloSinPrecio ? " activo" : ""}`} onClick={() => setSoloSinPrecio(true)}>Sin precio ({sinPrecio})</button>
        </div>
      )}
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        <div className="tabla-simple">
          {visibles.map((p) => (
            <button key={p.id} className="fila" style={{ background: "none", border: "none", borderBottom: "1px solid var(--border)", width: "100%", textAlign: "left", padding: "12px 0" }}
              onClick={() => gestiona && setEditar(p)} disabled={!gestiona}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <strong style={{ fontSize: 15 }}>{p.nombre}</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {p.categoria ?? "Sin categoría"} · {p.unidad}{p.maneja_stock ? ` · stock ${fmtCantidad(p.stock)}` : ""}
                </span>
              </span>
              {p.precio === null ? <span className="insignia no">Sin precio</span> : <strong>{dinero(p.precio)}</strong>}
            </button>
          ))}
          {visibles.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>No hay productos que coincidan.</p>}
        </div>
      </div>
      {editar && (
        <EditarProducto producto={editar === "nuevo" ? null : editar} categorias={categorias} rol={info.rol} unidadDefecto={info.negocio.unidad_defecto}
          alCerrar={() => setEditar(null)} alGuardar={() => { setEditar(null); avisar("Guardado"); cargar(); }} />
      )}
    </div>
  );
}

function EditarProducto({ producto, categorias, rol, unidadDefecto, alCerrar, alGuardar }: {
  producto: Producto | null; categorias: Categoria[]; rol: InfoNegocio["rol"]; unidadDefecto: string; alCerrar: () => void; alGuardar: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [precio, setPrecio] = useState(producto?.precio != null ? String(producto.precio).replace(".", ",") : "");
  const [costo, setCosto] = useState(producto?.costo != null ? String(producto.costo).replace(".", ",") : "");
  const [unidad, setUnidad] = useState(producto?.unidad ?? unidadDefecto);
  const [categoria, setCategoria] = useState(producto?.categoria_id ?? categorias[0]?.id ?? "");
  const [codigo, setCodigo] = useState(producto?.codigo_barras ?? "");
  const [stock, setStock] = useState(producto ? String(producto.stock).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ponePrecio = rol !== "bodeguero";

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    try {
      const datos: Record<string, unknown> = {
        nombre, unidad, categoria_id: categoria || null, codigo_barras: codigo || null, costo: parsearNumero(costo),
      };
      if (ponePrecio) datos.precio = parsearNumero(precio);
      if (producto) {
        await api("PATCH", `/productos/${producto.id}`, datos);
        const s = parsearNumero(stock);
        if (producto.maneja_stock && s !== null && s !== producto.stock) await api("POST", `/productos/${producto.id}/stock`, { stock: s, motivo: "Conteo" });
      } else {
        await api("POST", "/productos", { ...datos, stock_inicial: parsearNumero(stock) ?? undefined });
      }
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err));
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo={producto ? "Editar producto" : "Nuevo producto"} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo">
          <label htmlFor="p-nombre">Nombre</label>
          <input id="p-nombre" className="entrada" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="opciones">
          {ponePrecio && <CampoMonto id="p-precio" etiqueta="Precio de venta" valor={precio} alCambiar={setPrecio} />}
          <CampoMonto id="p-costo" etiqueta="Costo (opcional)" valor={costo} alCambiar={setCosto} />
        </div>
        <div className="opciones">
          <div className="campo">
            <label htmlFor="p-unidad">Unidad</label>
            <select id="p-unidad" className="entrada" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
              {[...new Set([unidad, "Unidad", "Libra", "Kilo", "Litro", "Galón", "Quintal", "Saco", "Caja", "Metro", "Servicio", "Plato"])].map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="p-cat">Categoría</label>
            <select id="p-cat" className="entrada" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="opciones">
          <CampoMonto id="p-stock" etiqueta={producto ? "Stock contado" : "Stock inicial"} valor={stock} alCambiar={setStock} />
          <div className="campo">
            <label htmlFor="p-codigo">Código de barras</label>
            <input id="p-codigo" className="entrada" inputMode="numeric" maxLength={32} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || nombre.trim().length < 1}>{ocupado ? "Guardando…" : "Guardar"}</button>
      </form>
    </Dialogo>
  );
}
