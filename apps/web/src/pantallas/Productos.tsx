import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FotoProducto } from "../componentes/foto";
import { EditarCombo } from "../componentes/combo";
import { HistorialProducto } from "./Inventario";
import { api, mensajeDe } from "../api";
import type { Categoria, InfoNegocio, Producto } from "../tipos";
import { puede, puedeGestionar, tieneModulo } from "../tipos";
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
  const gestiona = puedeGestionar(info.rol) || info.rol === "bodeguero" || puede(info, "productos");
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
                  {p.categoria ?? "Sin categoría"} · {p.unidad}{p.hijos ? ` · ${p.hijos} variantes · stock ${fmtCantidad(p.stock_variantes ?? 0)}` : p.maneja_stock ? ` · stock ${fmtCantidad(p.stock)}` : ""}
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
          conVariantes={tieneModulo(info, "M05")} conGarantia={tieneModulo(info, "M23")} conServicio={tieneModulo(info, "M11") || tieneModulo(info, "M12")}
          alCerrar={() => setEditar(null)} alGuardar={() => { setEditar(null); avisar("Guardado"); cargar(); }} />
      )}
    </div>
  );
}

function EditarProducto({ producto, categorias, rol, unidadDefecto, alCerrar, alGuardar, conVariantes, conGarantia, conServicio = false }: {
  producto: Producto | null; categorias: Categoria[]; rol: InfoNegocio["rol"]; unidadDefecto: string; alCerrar: () => void; alGuardar: () => void;
  conVariantes: boolean; conGarantia: boolean; conServicio?: boolean;
}) {
  const [duracion, setDuracion] = useState(producto?.duracion_min ? String(producto.duracion_min) : "");
  const [comision, setComision] = useState(producto?.comision_pct != null ? String(producto.comision_pct).replace(".", ",") : "");
  const [garantia, setGarantia] = useState(producto?.garantia_meses ? String(producto.garantia_meses) : "");
  const [foto, setFoto] = useState(producto?.foto_version ?? null);
  const [historial, setHistorial] = useState(false);
  const [combo, setCombo] = useState(false);
  const cambioFoto = useRef(false);
  const [variantes, setVariantes] = useState(false);
  const esModelo = (producto?.hijos ?? 0) > 0;
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
      if (conGarantia && producto) datos.garantia_meses = garantia ? Number(garantia) : null;
      if (conServicio && producto) {
        datos.duracion_min = duracion ? Number(duracion) : null;
        if (ponePrecio) datos.comision_pct = parsearNumero(comision);
      }
      if (producto) {
        await api("PATCH", `/productos/${producto.id}`, datos);
        const s = parsearNumero(stock);
        if (producto.maneja_stock && !esModelo && s !== null && s !== producto.stock) await api("POST", `/productos/${producto.id}/stock`, { stock: s, motivo: "Conteo" });
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
    <Dialogo titulo={producto ? "Editar producto" : "Nuevo producto"} alCerrar={() => (cambioFoto.current ? alGuardar() : alCerrar())}>
      {historial && producto && <HistorialProducto producto={producto} alCerrar={() => setHistorial(false)} />}
      {combo && producto && <EditarCombo producto={producto} alCerrar={() => setCombo(false)} alGuardar={(t) => { setCombo(false); alGuardar(); void t; }} />}
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
          {esModelo
            ? <p className="muted" style={{ fontSize: 14 }}>El stock lo llevan sus {producto?.hijos} variantes.</p>
            : <CampoMonto id="p-stock" etiqueta={producto ? "Stock contado" : "Stock inicial"} valor={stock} alCambiar={setStock} />}
          <div className="campo">
            <label htmlFor="p-codigo">Código de barras</label>
            <input id="p-codigo" className="entrada" inputMode="numeric" maxLength={32} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
        </div>
        {producto && rol !== "cajero" && <FotoProducto id={producto.id} version={foto} alCambiar={(v) => { setFoto(v); cambioFoto.current = true; }} />}
        {producto && !esModelo && !producto.padre_id && producto.tipo !== "insumo" && (!producto.tiene_receta || producto.es_combo) && rol !== "cajero" && (
          <button type="button" className="boton texto pequeno" style={{ alignSelf: "flex-start" }} onClick={() => setCombo(true)}>
            {producto.es_combo ? "Editar lo que lleva el combo" : "Es un combo (armado con otros productos)"}
          </button>
        )}
        {producto && producto.maneja_stock && !esModelo && (
          <button type="button" className="boton texto pequeno" style={{ alignSelf: "flex-start" }} onClick={() => setHistorial(true)}>Ver entradas y salidas</button>
        )}
        {conServicio && producto && (
          <div className="opciones">
            <div className="campo">
              <label htmlFor="p-duracion">Duración en minutos</label>
              <input id="p-duracion" className="entrada" inputMode="numeric" maxLength={4} placeholder="30" value={duracion} onChange={(e) => setDuracion(e.target.value.replace(/\D/g, ""))} />
            </div>
            {ponePrecio && (
              <div className="campo">
                <label htmlFor="p-comision">Comisión % (si no, la del profesional)</label>
                <input id="p-comision" className="entrada" inputMode="decimal" maxLength={6} value={comision} onChange={(e) => setComision(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {conGarantia && producto && (
          <div className="campo">
            <label htmlFor="p-garantia">Garantía en meses (para anotar series al vender)</label>
            <input id="p-garantia" className="entrada" inputMode="numeric" maxLength={3} value={garantia} onChange={(e) => setGarantia(e.target.value.replace(/\D/g, ""))} />
          </div>
        )}
        {conVariantes && producto && !producto.padre_id && (
          <button type="button" className="boton secundario" onClick={() => setVariantes(true)}>
            {esModelo ? "Agregar más tallas o colores" : "Tiene tallas, colores u opciones"}
          </button>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || nombre.trim().length < 1}>{ocupado ? "Guardando…" : "Guardar"}</button>
      </form>
      {variantes && producto && <CrearVariantes producto={producto} alCerrar={() => setVariantes(false)} alGuardar={alGuardar} />}
    </Dialogo>
  );
}

function CrearVariantes({ producto, alCerrar, alGuardar }: { producto: Producto; alCerrar: () => void; alGuardar: () => void }) {
  const [grupos, setGrupos] = useState(["", ""]);
  const [stock, setStock] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listas = grupos.map((g) => g.split(",").map((x) => x.trim()).filter(Boolean)).filter((g) => g.length);
  const combinaciones = listas.reduce((n, g) => n * g.length, listas.length ? 1 : 0);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", `/productos/${producto.id}/variantes`, { opciones: listas, stock: parsearNumero(stock) ?? 0 });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo={`Variantes de ${producto.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">Cada combinación queda como un producto con su propio stock y código de barras.</p>
        <div className="campo"><label htmlFor="v-g1">Tallas (separadas por coma)</label>
          <input id="v-g1" className="entrada" placeholder="S, M, L, XL" value={grupos[0]} onChange={(e) => setGrupos([e.target.value, grupos[1]!])} /></div>
        <div className="campo"><label htmlFor="v-g2">Colores u otra opción (separadas por coma)</label>
          <input id="v-g2" className="entrada" placeholder="Negro, Blanco, Azul" value={grupos[1]} onChange={(e) => setGrupos([grupos[0]!, e.target.value])} /></div>
        <CampoMonto id="v-stock" etiqueta="Stock de cada una (opcional)" valor={stock} alCambiar={setStock} />
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!combinaciones}>Crear {combinaciones} variantes</button>
      </form>
    </Dialogo>
  );
}
