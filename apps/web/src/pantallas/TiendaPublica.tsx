import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import { dinero, redondear } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IMas, IMenos } from "../componentes/iconos";

interface Variante { id: string; variante: string; precio: number; agotado: boolean }
interface ProductoPub { id: string; foto_version?: number | null; nombre: string; precio: number; unidad: string; categoria_id: string | null; agotado: boolean; variantes: Variante[] | null }
interface Catalogo {
  negocio: string; negocio_id?: string; logo_version?: number | null; tipo: string; mensaje: string | null; whatsapp: string | null; acepta_pedidos: boolean; costo_envio: number | null;
  categorias: { id: string; nombre: string }[]; productos: ProductoPub[];
}
interface Linea { id: string; nombre: string; precio: number; cantidad: number }

/** Catálogo público (sin sesión): lo que ve el cliente al abrir el enlace del negocio. */
export function TiendaPublica({ slug }: { slug: string }) {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [variantes, setVariantes] = useState<ProductoPub | null>(null);
  const [pedir, setPedir] = useState(false);
  const [listo, setListo] = useState<{ numero: number | null; texto: string } | null>(null);

  useEffect(() => {
    api<{ catalogo: Catalogo }>("GET", `/tienda/${encodeURIComponent(slug)}`)
      .then((r) => { setCat(r.catalogo); document.title = r.catalogo.negocio; })
      .catch((e) => setError(mensajeDe(e)));
  }, [slug]);

  const visibles = useMemo(() => (cat?.productos ?? []).filter((p) => !categoria || p.categoria_id === categoria), [cat, categoria]);
  const total = redondear(carrito.reduce((s, l) => s + l.precio * l.cantidad, 0));

  function agregar(id: string, nombre: string, precio: number, delta = 1) {
    setCarrito((c) => {
      const e = c.find((l) => l.id === id);
      if (e) return c.map((l) => (l.id === id ? { ...l, cantidad: l.cantidad + delta } : l)).filter((l) => l.cantidad > 0);
      return delta > 0 ? [...c, { id, nombre, precio, cantidad: delta }] : c;
    });
  }

  if (error) return <main className="pagina-simple"><Aviso tipo="error" titulo="Catálogo no disponible">Revisa el enlace o escribe al negocio.</Aviso></main>;
  if (!cat) return <Cargando />;

  if (listo) {
    return (
      <main className="pagina-simple" style={{ justifyContent: "center", textAlign: "center" }}>
        <h1>¡Gracias!</h1>
        <p>{listo.numero ? `Recibimos tu pedido N.º ${listo.numero}.` : "Tu pedido está listo para enviar."} {cat.negocio} te confirmará por WhatsApp.</p>
        {cat.whatsapp && (
          <a className="boton bloque" href={`https://wa.me/${cat.whatsapp}?text=${encodeURIComponent(listo.texto)}`} target="_blank" rel="noopener">
            {listo.numero ? "Escribir al negocio" : "Enviar pedido por WhatsApp"}
          </a>
        )}
      </main>
    );
  }

  return (
    <div className="tienda">
      <header className="tienda-cabecera">
        {cat.logo_version ? <img className="tienda-logo" src={`/api/logo/${cat.negocio_id}?v=${cat.logo_version}`} alt="" /> : null}
        <h1>{cat.negocio}</h1>
        <span className="muted">{cat.mensaje ?? cat.tipo}</span>
      </header>
      <div className="contenido" style={{ paddingBottom: carrito.length ? 120 : 32 }}>
        {cat.categorias.length > 1 && (
          <div className="chips" role="group" aria-label="Categorías">
            <button className={`chip${categoria === null ? " activo" : ""}`} onClick={() => setCategoria(null)}>Todo</button>
            {cat.categorias.map((c) => (
              <button key={c.id} className={`chip${categoria === c.id ? " activo" : ""}`} onClick={() => setCategoria(c.id)}>{c.nombre}</button>
            ))}
          </div>
        )}
        <div className="rejilla-productos">
          {visibles.map((p) => {
            const cant = p.variantes ? carrito.filter((l) => p.variantes!.some((v) => v.id === l.id)).reduce((s, l) => s + l.cantidad, 0)
              : carrito.find((l) => l.id === p.id)?.cantidad ?? 0;
            return (
              <button key={p.id} className={`producto${cant ? " en-carrito" : ""}`} disabled={p.agotado && !p.variantes}
                onClick={() => (p.variantes ? setVariantes(p) : agregar(p.id, p.nombre, p.precio))}>
                {p.foto_version ? <img className="foto" src={`/api/f/${p.id}?v=${p.foto_version}`} alt="" loading="lazy" /> : null}
                <span className="cabeza"><span className="nombre">{p.nombre}</span>{cant ? <span className="insignia azul">{cant}</span> : null}</span>
                <span className="unidad">{p.variantes ? `${p.variantes.length} opciones` : p.agotado ? "Agotado" : p.unidad}</span>
                <span className="precio">{dinero(p.precio)}</span>
              </button>
            );
          })}
        </div>
        {visibles.length === 0 && <div className="vacio"><p>Pronto habrá productos aquí.</p></div>}
      </div>

      {carrito.length > 0 && (
        <div className="barra-cobro">
          <div className="resumen"><span>{carrito.reduce((s, l) => s + l.cantidad, 0)} productos</span><strong>{dinero(total)}</strong></div>
          <button className="boton" onClick={() => setPedir(true)}>Hacer pedido</button>
        </div>
      )}

      {variantes && (
        <Dialogo titulo={variantes.nombre} alCerrar={() => setVariantes(null)}>
          <div className="rejilla-variantes">
            {variantes.variantes!.map((v) => {
              const cant = carrito.find((l) => l.id === v.id)?.cantidad ?? 0;
              return (
                <button key={v.id} className="variante" disabled={v.agotado} onClick={() => agregar(v.id, `${variantes.nombre} · ${v.variante}`, v.precio)}>
                  <strong>{v.variante}</strong><span>{dinero(v.precio)}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{v.agotado ? "Agotado" : cant ? `${cant} en tu pedido` : ""}</span>
                </button>
              );
            })}
          </div>
          <button className="boton bloque" onClick={() => setVariantes(null)}>Listo</button>
        </Dialogo>
      )}

      {pedir && <FormularioPedido cat={cat} slug={slug} carrito={carrito} total={total}
        cambiar={(l, d) => agregar(l.id, l.nombre, l.precio, d)}
        alCerrar={() => setPedir(false)} alEnviar={(numero, texto) => { setPedir(false); setCarrito([]); setListo({ numero, texto }); }} />}
    </div>
  );
}

function FormularioPedido({ cat, slug, carrito, total, cambiar, alCerrar, alEnviar }: {
  cat: Catalogo; slug: string; carrito: Linea[]; total: number; cambiar: (l: Linea, delta: number) => void;
  alCerrar: () => void; alEnviar: (numero: number | null, texto: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [tipo, setTipo] = useState<"retiro" | "domicilio">("retiro");
  const [direccion, setDireccion] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const envio = tipo === "domicilio" ? cat.costo_envio ?? 0 : 0;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lineas = carrito.map((l) => `• ${l.cantidad} × ${l.nombre} (${dinero(l.precio * l.cantidad)})`).join("\n");
    let numero: number | null = null;
    if (cat.acepta_pedidos) {
      setOcupado(true);
      try {
        const r = await api<{ pedido: { numero: number } }>("POST", `/tienda/${encodeURIComponent(slug)}/pedido`, {
          nombre, celular, tipo, direccion: direccion || undefined, nota: nota || undefined,
          items: carrito.map((l) => ({ producto_id: l.id, cantidad: l.cantidad })),
        });
        numero = r.pedido.numero;
      } catch (err) { setError(mensajeDe(err)); setOcupado(false); return; }
    }
    const texto = `Hola ${cat.negocio}, soy ${nombre}.${numero ? ` Mi pedido es el N.º ${numero}:` : " Quiero pedir:"}\n${lineas}\n` +
      `${envio ? `Envío: ${dinero(envio)}\n` : ""}Total: ${dinero(total + envio)}\n${tipo === "domicilio" ? `Entregar en: ${direccion}` : "Retiro en el local"}${nota ? `\nNota: ${nota}` : ""}`;
    alEnviar(numero, texto);
  }

  return (
    <Dialogo titulo="Tu pedido" alCerrar={alCerrar}>
      <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {carrito.map((l) => (
          <div key={l.id} className="linea-carrito">
            <div className="info"><strong>{l.nombre}</strong><span>{dinero(l.precio)}</span></div>
            <div className="cantidad">
              <button type="button" aria-label={`Quitar uno de ${l.nombre}`} onClick={() => cambiar(l, -1)}><IMenos tam={18} /></button>
              <span>{l.cantidad}</span>
              <button type="button" aria-label={`Agregar uno de ${l.nombre}`} onClick={() => cambiar(l, 1)}><IMas tam={18} /></button>
            </div>
          </div>
        ))}
        <div className="opciones">
          <button type="button" className={`opcion${tipo === "retiro" ? " activa" : ""}`} onClick={() => setTipo("retiro")}>Retiro en el local</button>
          <button type="button" className={`opcion${tipo === "domicilio" ? " activa" : ""}`} onClick={() => setTipo("domicilio")}>A domicilio{cat.costo_envio ? ` (+${dinero(cat.costo_envio)})` : ""}</button>
        </div>
        <div className="campo"><label htmlFor="tp-n">Tu nombre</label>
          <input id="tp-n" className="entrada" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="tp-c">Tu celular</label>
          <input id="tp-c" className="entrada" type="tel" inputMode="tel" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
        {tipo === "domicilio" && (
          <div className="campo"><label htmlFor="tp-d">Dirección de entrega</label>
            <input id="tp-d" className="entrada" maxLength={300} value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
        )}
        <div className="campo"><label htmlFor="tp-nota">Nota (opcional)</label>
          <input id="tp-nota" className="entrada" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado || !carrito.length || nombre.trim().length < 2 || celular.replace(/\D/g, "").length < 7 || (tipo === "domicilio" && !direccion.trim())}>
          {ocupado ? "Enviando…" : `Pedir ${dinero(total + envio)}`}
        </button>
      </form>
    </Dialogo>
  );
}
