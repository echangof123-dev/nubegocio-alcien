import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Categoria, InfoNegocio, LineaCarrito, Producto } from "../tipos";
import { esPorPeso, puedeGestionar, tieneModulo } from "../tipos";
import { cantidad as fmtCantidad, dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IEscanear } from "../componentes/iconos";

type Props = {
  info: InfoNegocio;
  carrito: LineaCarrito[];
  setCarrito: (f: (c: LineaCarrito[]) => LineaCarrito[]) => void;
  navegar: (ruta: string) => void;
  avisar: (t: string) => void;
};

export const totalCarrito = (c: LineaCarrito[]) => redondear(c.reduce((s, l) => s + redondear(l.cantidad * (l.producto.precio ?? 0)), 0));

export function Vender({ info, carrito, setCarrito, navegar, avisar }: Props) {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ponerPrecio, setPonerPrecio] = useState<Producto | null>(null);
  const [pesar, setPesar] = useState<Producto | null>(null);
  const [elegirVariante, setElegirVariante] = useState<Producto | null>(null);
  const [escanear, setEscanear] = useState(false);
  const porPeso = tieneModulo(info, "M06");

  const cargar = useCallback(async () => {
    try {
      const [p, c, caja] = await Promise.all([
        api<{ productos: Producto[] }>("GET", "/productos"),
        api<{ categorias: Categoria[] }>("GET", "/categorias"),
        api<{ abierta: boolean }>("GET", "/caja"),
      ]);
      setProductos(p.productos);
      setCategorias(c.categorias.filter((x) => x.productos > 0));
      setCajaAbierta(caja.abierta);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    if (!productos) return [];
    const q = texto.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    return productos.filter((p) =>
      (!categoria || p.categoria_id === categoria) &&
      (!q || p.nombre.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(q) || p.codigo_barras === q));
  }, [productos, categoria, texto]);

  const enCarrito = useMemo(() => new Map(carrito.map((l) => [l.producto.id, l.cantidad])), [carrito]);

  function agregar(p: Producto, cant = 1) {
    setCarrito((c) => {
      const existe = c.find((l) => l.producto.id === p.id);
      if (existe) return c.map((l) => (l.producto.id === p.id ? { ...l, cantidad: Math.round((l.cantidad + cant) * 1000) / 1000 } : l));
      return [...c, { producto: p, cantidad: cant }];
    });
  }

  function tocar(p: Producto) {
    if (p.hijos && p.hijos > 0) { setElegirVariante(p); return; }
    if (p.precio === null) {
      if (puedeGestionar(info.rol)) setPonerPrecio(p);
      else avisar("Pide al dueño que le ponga precio a este producto");
      return;
    }
    if (porPeso && esPorPeso(p.unidad)) { setPesar(p); return; }
    agregar(p);
  }

  function buscarPorCodigo(e: FormEvent) {
    e.preventDefault();
    const exacto = productos?.find((p) => p.codigo_barras && p.codigo_barras === texto.trim());
    const unico = visibles.length === 1 ? visibles[0] : undefined;
    const p = exacto ?? unico;
    if (p) { tocar(p); setTexto(""); return; }
    // Puede ser el código de una variante (no se listan sueltas)
    if (/^\d{6,}$/.test(texto.trim())) {
      api<{ producto: Producto }>("GET", `/productos/codigo/${encodeURIComponent(texto.trim())}`)
        .then((r) => { tocar(r.producto); setTexto(""); }).catch(() => {});
    }
  }

  function precioPuesto(actualizado: Producto) {
    setProductos((ps) => ps?.map((x) => (x.id === actualizado.id ? actualizado : x)) ?? null);
    setPonerPrecio(null);
    tocar(actualizado);
  }

  const total = totalCarrito(carrito);
  const unidades = carrito.length;

  if (error) return <div className="contenido"><Aviso tipo="error" titulo="No pudimos cargar tus productos">{error}</Aviso></div>;
  if (!productos) return <Cargando />;

  const sinPrecio = productos.filter((p) => p.precio === null).length;

  return (
    <div className="contenido">
      {cajaAbierta === false && info.negocio.exige_caja_abierta && (
        <div className="aviso atencion" role="status">
          <div style={{ flex: 1 }}><strong>La caja está cerrada.</strong><br />Ábrela con el efectivo que tienes para empezar a vender.</div>
          <button className="boton pequeno" onClick={() => navegar("/caja")}>Abrir caja</button>
        </div>
      )}
      {sinPrecio > 0 && puedeGestionar(info.rol) && (
        <Aviso tipo="info">{sinPrecio === 1 ? "1 producto no tiene precio." : `${sinPrecio} productos no tienen precio.`} Tócalo para ponérselo, o ve a Productos.</Aviso>
      )}

      <form className="buscador" onSubmit={buscarPorCodigo} role="search">
        <div className="con-icono">
          <IBuscar tam={20} />
          <label htmlFor="buscar" className="oculto">Buscar producto o código de barras</label>
          <input id="buscar" className="entrada" placeholder="Buscar producto" autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        {tieneModulo(info, "M07") && (
          <button type="button" className="icono-boton" style={{ width: 52, height: 52, background: "var(--ink)", color: "var(--surface)" }}
            aria-label="Escanear código de barras" onClick={() => setEscanear(true)}><IEscanear /></button>
        )}
      </form>

      {categorias.length > 1 && (
        <div className="chips" role="group" aria-label="Categorías">
          <button className={`chip${categoria === null ? " activo" : ""}`} aria-pressed={categoria === null} onClick={() => setCategoria(null)}>Todos</button>
          {categorias.map((c) => (
            <button key={c.id} className={`chip${categoria === c.id ? " activo" : ""}`} aria-pressed={categoria === c.id} onClick={() => setCategoria(c.id)}>{c.nombre}</button>
          ))}
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="vacio">
          <p>No encontramos “{texto}”.</p>
          {puedeGestionar(info.rol) && <button className="boton secundario" onClick={() => navegar("/productos")}>Crear producto</button>}
        </div>
      ) : (
        <div className="rejilla-productos">
          {visibles.map((p) => {
            const cant = enCarrito.get(p.id);
            const bajo = p.maneja_stock && p.stock_minimo !== null && p.stock <= p.stock_minimo;
            return (
              <button key={p.id} className={`producto${cant ? " en-carrito" : ""}`} onClick={() => tocar(p)}
                aria-label={`${p.nombre}, ${p.precio === null ? "sin precio" : dinero(p.precio)}${cant ? `, ${fmtCantidad(cant)} en la venta` : ""}`}>
                <span className="cabeza">
                  <span className="nombre">{p.nombre}</span>
                  {cant ? <span className="insignia azul">{fmtCantidad(cant)}</span> : null}
                </span>
                <span className="unidad">{p.hijos ? `${p.hijos} opciones` : p.unidad}{bajo ? " · " : ""}{bajo && <span className="stock-bajo">quedan {fmtCantidad(p.stock)}</span>}</span>
                {p.precio === null ? <span className="sin-precio">Poner precio</span> : <span className="precio">{dinero(p.precio)}</span>}
              </button>
            );
          })}
        </div>
      )}

      {unidades > 0 && (
        <div className="barra-cobro">
          <div className="resumen">
            <span>{unidades === 1 ? "1 producto" : `${unidades} productos`}</span>
            <strong>{dinero(total)}</strong>
          </div>
          <button className="boton" onClick={() => navegar("/cobrar")}>Cobrar</button>
        </div>
      )}

      {elegirVariante && (
        <DialogoVariantes modelo={elegirVariante} alCerrar={() => setElegirVariante(null)}
          alElegir={(v) => { setElegirVariante(null); tocar(v); }} />
      )}
      {ponerPrecio && <DialogoPrecio producto={ponerPrecio} alCerrar={() => setPonerPrecio(null)} alGuardar={precioPuesto} />}
      {pesar && (
        <DialogoPeso producto={pesar} alCerrar={() => setPesar(null)}
          alAgregar={(c) => { agregar(pesar, c); setPesar(null); }} />
      )}
      {escanear && (
        <DialogoEscanear alCerrar={() => setEscanear(false)} alLeer={(codigo) => {
          setEscanear(false);
          const p = productos.find((x) => x.codigo_barras === codigo);
          if (p) { tocar(p); return; }
          api<{ producto: Producto }>("GET", `/productos/codigo/${encodeURIComponent(codigo)}`)
            .then((r) => tocar(r.producto)).catch(() => avisar(`No hay un producto con el código ${codigo}`));
        }} />
      )}
    </div>
  );
}

function DialogoVariantes({ modelo, alCerrar, alElegir }: { modelo: Producto; alCerrar: () => void; alElegir: (v: Producto) => void }) {
  const [variantes, setVariantes] = useState<Producto[] | null>(null);
  useEffect(() => {
    api<{ variantes: Producto[] }>("GET", `/productos/${modelo.id}/variantes`).then((r) => setVariantes(r.variantes)).catch(() => setVariantes([]));
  }, [modelo.id]);
  return (
    <Dialogo titulo={modelo.nombre} alCerrar={alCerrar}>
      {!variantes ? <Cargando /> : (
        <div className="rejilla-variantes">
          {variantes.map((v) => (
            <button key={v.id} className="variante" disabled={v.maneja_stock && v.stock <= 0} onClick={() => alElegir(v)}>
              <strong>{v.variante}</strong>
              <span>{v.precio !== null ? dinero(v.precio) : "Sin precio"}</span>
              <span className="muted" style={{ fontSize: 12 }}>{v.maneja_stock ? (v.stock > 0 ? `Quedan ${fmtCantidad(v.stock)}` : "Agotado") : ""}</span>
            </button>
          ))}
        </div>
      )}
    </Dialogo>
  );
}

function DialogoPrecio({ producto, alCerrar, alGuardar }: { producto: Producto; alCerrar: () => void; alGuardar: (p: Producto) => void }) {
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const precio = parsearNumero(valor);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (precio === null) return;
    setOcupado(true);
    try {
      const r = await api<{ producto: Producto }>("PATCH", `/productos/${producto.id}`, { precio });
      alGuardar(r.producto);
    } catch (err) {
      setError(mensajeDe(err));
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo="Ponle precio" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p><strong>{producto.nombre}</strong> <span className="muted">· {producto.unidad}</span></p>
        <CampoMonto id="precio" etiqueta={`Precio por ${producto.unidad.toLowerCase()}`} valor={valor} alCambiar={setValor} grande />
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || precio === null || precio < 0}>Guardar y agregar a la venta</button>
      </form>
    </Dialogo>
  );
}

function DialogoPeso({ producto, alCerrar, alAgregar }: { producto: Producto; alCerrar: () => void; alAgregar: (c: number) => void }) {
  const [modo, setModo] = useState<"cantidad" | "monto">("cantidad");
  const [valor, setValor] = useState("");
  const n = parsearNumero(valor);
  const precio = producto.precio ?? 0;
  const cant = n === null ? null : modo === "cantidad" ? Math.round(n * 1000) / 1000 : Math.round((n / precio) * 1000) / 1000;
  const unidad = producto.unidad.toLowerCase();

  return (
    <Dialogo titulo={producto.nombre} alCerrar={alCerrar}>
      <form onSubmit={(e) => { e.preventDefault(); if (cant && cant > 0) alAgregar(cant); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="opciones">
          <button type="button" className={`opcion${modo === "cantidad" ? " activa" : ""}`} onClick={() => setModo("cantidad")}>Por {unidad}</button>
          <button type="button" className={`opcion${modo === "monto" ? " activa" : ""}`} onClick={() => setModo("monto")}>Por dinero</button>
        </div>
        <CampoMonto id="peso" etiqueta={modo === "cantidad" ? `¿Cuántas ${unidad}s?` : "¿Cuánto dinero?"} valor={valor} alCambiar={setValor} grande />
        {cant !== null && cant > 0 && (
          <p className="muted">{fmtCantidad(cant)} {unidad} × {dinero(precio)} = <strong style={{ color: "var(--ink)" }}>{dinero(redondear(cant * precio))}</strong></p>
        )}
        <button className="boton bloque" disabled={!cant || cant <= 0}>Agregar a la venta</button>
      </form>
    </Dialogo>
  );
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Lee códigos con la cámara si el navegador puede; si no, permite escribirlo. */
function DialogoEscanear({ alCerrar, alLeer }: { alCerrar: () => void; alLeer: (codigo: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [sinCamara, setSinCamara] = useState(false);
  const leer = useRef(alLeer);
  leer.current = alLeer;

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) { setSinCamara(true); return; }
    let flujo: MediaStream | null = null;
    let activo = true;
    const detector = new Ctor({ formats: ["ean_13", "upc_a", "ean_8", "code_128"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async (s) => {
      flujo = s;
      if (!video.current) return;
      video.current.srcObject = s;
      await video.current.play();
      while (activo && video.current) {
        const r = await detector.detect(video.current).catch(() => []);
        if (r[0]?.rawValue) { leer.current(r[0].rawValue); return; }
        await new Promise((ok) => setTimeout(ok, 250));
      }
    }).catch(() => setSinCamara(true));
    return () => { activo = false; flujo?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <Dialogo titulo="Escanear código" alCerrar={alCerrar}>
      {!sinCamara && <video ref={video} muted playsInline style={{ width: "100%", borderRadius: 12, background: "#000" }} />}
      {sinCamara && <p className="muted">Este navegador no puede leer códigos con la cámara. Escríbelo o usa un lector USB en el buscador.</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) alLeer(manual.trim()); }} style={{ display: "flex", gap: 8 }}>
        <label htmlFor="codigo-manual" className="oculto">Código de barras</label>
        <input id="codigo-manual" className="entrada" inputMode="numeric" placeholder="Código de barras" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="boton">Buscar</button>
      </form>
    </Dialogo>
  );
}
