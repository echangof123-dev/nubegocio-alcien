import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, archivo, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";
import { diaLocal, enlaceWa, horaCorta } from "../componentes/servicios";

interface Productor { id: string; nombre: string; cedula: string | null; celular: string | null; anticipo: number; por_pagar: number; ultima_entrega: string | null }
interface ProdAcopio { id: string; nombre: string; unidad: string; stock: number; costo: number | null; humedad_base: number; precio_dia: number | null }
interface Liquidacion {
  id: string; numero: number; creado_en: string; sacos: number | null; peso_bruto: number; tara: number; humedad: number; impureza: number;
  peso_neto: number; precio: number; total: number; descontado: number; pagado: number; estado: "vigente" | "anulado";
  productor: string; producto: string; unidad: string; por_pagar: number;
}
type Vista = "comprar" | "hoy" | "productores" | "precios";

/** Misma fórmula que la base: (bruto − tara) × (100 − h)/(100 − h_ref) × (1 − impureza). */
export function pesoNeto(bruto: number, tara: number, humedad: number, base: number, impureza: number) {
  const f = humedad > base ? (100 - humedad) / (100 - base) : 1;
  return Math.round((bruto - tara) * f * (1 - impureza / 100) * 1000) / 1000;
}
const n = (x: unknown) => Number(x ?? 0);
const kilos = (x: number) => x.toLocaleString("es-EC", { maximumFractionDigits: 3 });

/** Centro de acopio: pesaje con humedad e impureza, liquidación al productor y anticipos. */
export function Acopio({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [vista, setVista] = useState<Vista>("comprar");
  const [productos, setProductos] = useState<ProdAcopio[] | null>(null);
  const [productores, setProductores] = useState<Productor[]>([]);
  const cargar = useCallback(() => {
    api<{ productos: ProdAcopio[] }>("GET", "/acopio/productos").then((r) => setProductos(r.productos)).catch(() => setProductos([]));
    api<{ productores: Productor[] }>("GET", "/productores").then((r) => setProductores(r.productores)).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  if (!productos) return <Cargando />;
  const gestiona = puedeGestionar(info.rol);
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Acopio</h1>
      <div className="chips" role="tablist">
        {([["comprar", "Comprar"], ["hoy", "Liquidaciones"], ["productores", "Productores"], ["precios", "Precios del día"]] as const).map(([v, t]) => (
          <button key={v} role="tab" aria-selected={vista === v} className={`chip${vista === v ? " activo" : ""}`} onClick={() => setVista(v)}>{t}</button>
        ))}
      </div>
      {vista === "comprar" && (productos.length === 0
        ? <Aviso tipo="info" titulo="Primero pon los precios del día">Elige qué compras (cacao, maíz, arroz…), su humedad de referencia y cuánto pagas.
            {gestiona && <> <button className="boton texto" onClick={() => setVista("precios")}>Poner precios</button></>}</Aviso>
        : <Comprar productos={productos} productores={productores} avisar={avisar} alGuardar={() => { cargar(); setVista("hoy"); }} alNuevoProductor={cargar} />)}
      {vista === "hoy" && <Liquidaciones info={info} avisar={avisar} alCambiar={cargar} />}
      {vista === "productores" && <Productores info={info} productores={productores} avisar={avisar} alCambiar={cargar} />}
      {vista === "precios" && <Precios gestiona={gestiona} productos={productos} avisar={avisar} alCambiar={cargar} />}
    </div>
  );
}

function Comprar({ productos, productores, avisar, alGuardar, alNuevoProductor }: {
  productos: ProdAcopio[]; productores: Productor[]; avisar: (t: string) => void; alGuardar: () => void; alNuevoProductor: () => void;
}) {
  const [productor, setProductor] = useState<Productor | null>(null);
  const [elegir, setElegir] = useState(false);
  const [prodId, setProdId] = useState(productos[0]!.id);
  const prod = productos.find((p) => p.id === prodId) ?? productos[0]!;
  const [sacos, setSacos] = useState("");
  const [bruto, setBruto] = useState("");
  const [tara, setTara] = useState("");
  const [humedad, setHumedad] = useState("");
  const [impureza, setImpureza] = useState("");
  const [precio, setPrecio] = useState("");
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia" | "credito">("efectivo");
  const [descontar, setDescontar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const b = parsearNumero(bruto) ?? 0, t = parsearNumero(tara) ?? 0, h = parsearNumero(humedad) ?? 0, im = parsearNumero(impureza) ?? 0;
  const pr = parsearNumero(precio) ?? n(prod.precio_dia);
  const neto = b > t ? pesoNeto(b, t, h, n(prod.humedad_base), im) : 0;
  const total = redondear(neto * pr);
  const anticipo = n(productor?.anticipo);
  const desc = Math.min(parsearNumero(descontar) ?? 0, anticipo, total);
  const u = prod.unidad.toLowerCase();

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const r = await api<{ acopio: { acopio_id: string; numero: number; a_pagar: number } }>("POST", "/acopio", {
        productor_id: productor!.id, producto_id: prod.id, sacos: sacos ? Number(sacos) : undefined, peso_bruto: b, tara: t,
        humedad: h, impureza: im, precio: parsearNumero(precio) ?? undefined, metodo, descontar_anticipo: desc || undefined,
      });
      avisar(`Liquidación N.º ${r.acopio.numero}: ${metodo === "credito" ? "queda por pagar" : "paga"} ${dinero(metodo === "credito" ? total - desc : n(r.acopio.a_pagar))}`);
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); setOcupado(false); }
  }

  return (
    <>
    <form className="tarjeta" onSubmit={guardar} style={{ gap: 12 }}>
      <button type="button" className={`item-opcion${productor ? " activo" : ""}`} onClick={() => setElegir(true)}>
        <span className="textos"><strong>{productor?.nombre ?? "Elegir productor"}</strong>
          <span>{productor ? (anticipo > 0 ? `Tiene ${dinero(anticipo)} de anticipo` : productor.cedula ?? "Toca para cambiar") : "Busca o agrégalo"}</span></span>
      </button>
      {productos.length > 1 && (
        <div className="opciones" role="group" aria-label="Qué compras">
          {productos.map((p) => <button type="button" key={p.id} className={`opcion${p.id === prod.id ? " activa" : ""}`} onClick={() => setProdId(p.id)}>{p.nombre}</button>)}
        </div>
      )}
      <div className="rejilla-2">
        <CampoMonto id="ac-bruto" etiqueta={`Peso bruto (${u})`} valor={bruto} alCambiar={setBruto} />
        <CampoMonto id="ac-tara" etiqueta={`Tara, sacos (${u})`} valor={tara} alCambiar={setTara} />
        <CampoMonto id="ac-hum" etiqueta={`Humedad % (ref. ${n(prod.humedad_base)} %)`} valor={humedad} alCambiar={setHumedad} />
        <CampoMonto id="ac-imp" etiqueta="Impureza %" valor={impureza} alCambiar={setImpureza} />
        <div className="campo"><label htmlFor="ac-sacos">Sacos</label>
          <input id="ac-sacos" className="entrada" inputMode="numeric" value={sacos} onChange={(e) => setSacos(e.target.value.replace(/\D/g, ""))} /></div>
        <CampoMonto id="ac-precio" etiqueta={`Precio por ${u}`} valor={precio || (prod.precio_dia != null ? String(prod.precio_dia).replace(".", ",") : "")} alCambiar={setPrecio} />
      </div>
      <div className="tarjeta" style={{ background: "var(--surface-alt)", gap: 4 }}>
        <div className="fila"><span className="muted">Peso neto</span><strong>{kilos(neto)} {u}</strong></div>
        {b > t && neto < b - t && <div className="fila"><span className="muted">Descuento por humedad e impureza</span><span>− {kilos(Math.round((b - t - neto) * 1000) / 1000)} {u}</span></div>}
        <div className="fila"><span className="muted">Total</span><strong className="monto-grande">{dinero(total)}</strong></div>
      </div>
      {anticipo > 0 && <CampoMonto id="ac-desc" etiqueta={`Descontar anticipo (tiene ${dinero(anticipo)})`} valor={descontar} alCambiar={setDescontar} />}
      <div className="opciones" role="group" aria-label="Cómo pagas">
        {([["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["credito", "Le debo"]] as const).map(([m, t2]) => (
          <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{t2}</button>
        ))}
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button className="boton bloque" disabled={ocupado || !productor || neto <= 0 || pr < 0}>
        {ocupado ? "Guardando…" : metodo === "credito" ? `Guardar (queda debiendo ${dinero(total - desc)})` : `Pagar ${dinero(total - desc)}`}
      </button>
    </form>
    {elegir && <ElegirProductor productores={productores} alCerrar={() => setElegir(false)}
      alElegir={(p) => { setProductor(p); setElegir(false); }} alCrear={(p) => { setProductor(p); setElegir(false); alNuevoProductor(); }} />}
    </>
  );
}

function ElegirProductor({ productores, alCerrar, alElegir, alCrear }: {
  productores: Productor[]; alCerrar: () => void; alElegir: (p: Productor) => void; alCrear: (p: Productor) => void;
}) {
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const visibles = productores.filter((p) => !q || p.nombre.toLowerCase().includes(q.toLowerCase()) || (p.cedula ?? "").startsWith(q));
  if (nuevo) return <NuevoProductor inicial={q} alCerrar={() => setNuevo(false)} alGuardar={alCrear} />;
  return (
    <Dialogo titulo="Elegir productor" alCerrar={alCerrar}>
      <div className="con-icono">
        <IBuscar tam={20} />
        <label htmlFor="ep-q" className="oculto">Buscar productor</label>
        <input id="ep-q" className="entrada" placeholder="Nombre o cédula" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="lista-opciones" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {visibles.map((p) => (
          <button key={p.id} className="item-opcion" onClick={() => alElegir(p)}>
            <span className="textos"><strong>{p.nombre}</strong><span>{p.cedula ?? "Sin cédula"}{n(p.anticipo) > 0 ? ` · anticipo ${dinero(p.anticipo)}` : ""}</span></span>
          </button>
        ))}
      </div>
      <button className="boton secundario" onClick={() => setNuevo(true)}><IMas tam={18} /> Nuevo productor</button>
    </Dialogo>
  );
}

function NuevoProductor({ inicial, alCerrar, alGuardar }: { inicial: string; alCerrar: () => void; alGuardar: (p: Productor) => void }) {
  const esCedula = /^\d+$/.test(inicial);
  const [nombre, setNombre] = useState(esCedula ? "" : inicial);
  const [cedula, setCedula] = useState(esCedula ? inicial : "");
  const [celular, setCelular] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ productor: Productor }>("POST", "/productores", { nombre, cedula: cedula || undefined, celular: celular || undefined });
      alGuardar(r.productor);
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Nuevo productor" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="campo"><label htmlFor="np-n">Nombre completo</label>
          <input id="np-n" className="entrada" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="np-c">Cédula</label>
            <input id="np-c" className="entrada" inputMode="numeric" maxLength={13} value={cedula} onChange={(e) => setCedula(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="campo"><label htmlFor="np-cel">Celular</label>
            <input id="np-cel" className="entrada" type="tel" value={celular} onChange={(e) => setCelular(e.target.value)} /></div>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={nombre.trim().length < 3}>Guardar productor</button>
      </form>
    </Dialogo>
  );
}

function Liquidaciones({ info, avisar, alCambiar }: { info: InfoNegocio; avisar: (t: string) => void; alCambiar: () => void }) {
  const [dia, setDia] = useState(diaLocal());
  const [datos, setDatos] = useState<{ acopios: Liquidacion[]; resumen: { producto: string; unidad: string; neto: number; total: number }[] } | null>(null);
  const [anular, setAnular] = useState<Liquidacion | null>(null);
  const [motivo, setMotivo] = useState("");
  const cargar = useCallback(() => {
    api<typeof datos>("GET", `/acopio?desde=${dia}&hasta=${dia}`).then(setDatos).catch(() => setDatos({ acopios: [], resumen: [] }));
  }, [dia]);
  useEffect(cargar, [cargar]);

  async function confirmarAnular(e: FormEvent) {
    e.preventDefault();
    try { await api("POST", `/acopio/${anular!.id}/anular`, { motivo }); setAnular(null); setMotivo(""); avisar("Liquidación anulada"); cargar(); alCambiar(); }
    catch (err) { avisar(mensajeDe(err)); }
  }

  return (
    <>
      <div className="campo"><label htmlFor="liq-dia">Día</label>
        <input id="liq-dia" className="entrada" type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} /></div>
      {!datos ? <Cargando /> : (
        <>
          {datos.resumen.map((r) => (
            <div key={r.producto} className="tarjeta" style={{ gap: 2 }}>
              <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{r.producto} comprado</span>
              <span className="monto-grande">{kilos(r.neto)} {r.unidad.toLowerCase()}</span>
              <span className="muted" style={{ fontSize: 13 }}>{dinero(r.total)} · promedio {dinero(r.neto ? r.total / r.neto : 0)} por {r.unidad.toLowerCase()}</span>
            </div>
          ))}
          {datos.acopios.length === 0 && <div className="vacio"><p>No hay compras este día.</p></div>}
          {datos.acopios.map((a) => (
            <div key={a.id} className="tarjeta" style={{ gap: 6, opacity: a.estado === "anulado" ? 0.6 : 1 }}>
              <div className="fila"><strong>N.º {a.numero} · {a.productor}</strong>
                {a.estado === "anulado" ? <span className="insignia gris">Anulada</span> : n(a.por_pagar) > 0 ? <span className="insignia no">Le debes {dinero(a.por_pagar)}</span> : <span className="insignia ok">Pagada</span>}</div>
              <span className="muted" style={{ fontSize: 14 }}>
                {horaCorta(a.creado_en)} · {a.producto}: {kilos(n(a.peso_bruto))} bruto → {kilos(n(a.peso_neto))} neto ({n(a.humedad)} % humedad{n(a.impureza) ? `, ${n(a.impureza)} % impureza` : ""})
              </span>
              <div className="fila"><span>{dinero(a.precio)} × {kilos(n(a.peso_neto))}{n(a.descontado) ? ` · anticipo −${dinero(a.descontado)}` : ""}</span><strong>{dinero(a.total)}</strong></div>
              <div className="acciones-fila">
                <button className="boton pequeno secundario" onClick={() => archivo(`/acopio/${a.id}/liquidacion`, "abrir").catch((e) => avisar(mensajeDe(e)))}>Ver liquidación</button>
                {a.estado === "vigente" && puedeGestionar(info.rol) && <button className="boton texto pequeno" onClick={() => setAnular(a)}>Anular</button>}
              </div>
            </div>
          ))}
        </>
      )}
      {anular && (
        <Dialogo titulo={`Anular liquidación N.º ${anular.numero}`} alCerrar={() => setAnular(null)}>
          <form onSubmit={confirmarAnular} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="muted">Sale del inventario, vuelve el efectivo a la caja (si sigue abierta) y el anticipo descontado queda otra vez pendiente.</p>
            <div className="campo"><label htmlFor="an-m">Motivo</label>
              <input id="an-m" className="entrada" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <button className="boton peligro bloque" disabled={motivo.trim().length < 3}>Anular</button>
          </form>
        </Dialogo>
      )}
    </>
  );
}

function Productores({ info, productores, avisar, alCambiar }: { info: InfoNegocio; productores: Productor[]; avisar: (t: string) => void; alCambiar: () => void }) {
  const [anticipo, setAnticipo] = useState<Productor | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia">("efectivo");
  const [nota, setNota] = useState("");
  const gestiona = puedeGestionar(info.rol);
  async function dar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/anticipos", { productor_id: anticipo!.id, monto: parsearNumero(monto), metodo, nota: nota || undefined });
      avisar(`Anticipo de ${dinero(parsearNumero(monto))} a ${anticipo!.nombre}`);
      setAnticipo(null); setMonto(""); setNota("");
      alCambiar();
    } catch (err) { avisar(mensajeDe(err)); }
  }
  return (
    <>
      <button className="boton bloque" onClick={() => setNuevo(true)}><IMas tam={20} /> Nuevo productor</button>
      {productores.length === 0 && <div className="vacio"><p>Aún no tienes productores.</p></div>}
      {productores.map((p) => {
        const wa = enlaceWa(p.celular, `Hola ${p.nombre}, `);
        return (
          <div key={p.id} className="tarjeta" style={{ gap: 6 }}>
            <div className="fila"><strong>{p.nombre}</strong><span className="muted" style={{ fontSize: 13 }}>{p.cedula ?? ""}</span></div>
            <div className="fila"><span className="muted">Anticipo pendiente</span><span>{dinero(p.anticipo)}</span></div>
            {n(p.por_pagar) > 0 && <div className="fila"><span className="muted">Le debes</span><strong>{dinero(p.por_pagar)}</strong></div>}
            <div className="acciones-fila">
              {gestiona && <button className="boton pequeno secundario" onClick={() => setAnticipo(p)}>Dar anticipo</button>}
              {wa && <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">WhatsApp</a>}
            </div>
          </div>
        );
      })}
      {nuevo && <NuevoProductor inicial="" alCerrar={() => setNuevo(false)} alGuardar={() => { setNuevo(false); avisar("Productor guardado"); alCambiar(); }} />}
      {anticipo && (
        <Dialogo titulo={`Anticipo a ${anticipo.nombre}`} alCerrar={() => setAnticipo(null)}>
          <form onSubmit={dar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <CampoMonto id="at-m" etiqueta="Monto" valor={monto} alCambiar={setMonto} grande />
            <div className="opciones">
              {(["efectivo", "transferencia"] as const).map((m) => (
                <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>{m === "efectivo" ? "Efectivo" : "Transferencia"}</button>
              ))}
            </div>
            <div className="campo"><label htmlFor="at-n">Nota (opcional)</label>
              <input id="at-n" className="entrada" maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
            <p className="muted" style={{ fontSize: 13 }}>Se descuenta cuando te entregue su producto.{metodo === "efectivo" ? " Sale de la caja si está abierta." : ""}</p>
            <button className="boton bloque" disabled={!parsearNumero(monto)}>Dar {dinero(parsearNumero(monto) ?? 0)}</button>
          </form>
        </Dialogo>
      )}
    </>
  );
}

function Precios({ gestiona, productos, avisar, alCambiar }: { gestiona: boolean; productos: ProdAcopio[]; avisar: (t: string) => void; alCambiar: () => void }) {
  const [editar, setEditar] = useState<{ producto: { id: string; nombre: string; unidad: string }; humedad: string; precio: string } | null>(null);
  const [elegir, setElegir] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/acopio/productos", { producto_id: editar!.producto.id, humedad_base: parsearNumero(editar!.humedad) ?? 0, precio_dia: parsearNumero(editar!.precio) });
      avisar("Precio del día guardado");
      setEditar(null);
      alCambiar();
    } catch (err) { avisar(mensajeDe(err)); }
  }
  const txt = (x: number | null) => (x == null ? "" : String(x).replace(".", ","));
  return (
    <>
      {productos.map((p) => (
        <button key={p.id} className="tarjeta" style={{ gap: 4, textAlign: "left" }} disabled={!gestiona}
          onClick={() => setEditar({ producto: p, humedad: txt(p.humedad_base), precio: txt(p.precio_dia) })}>
          <div className="fila"><strong>{p.nombre}</strong><strong>{p.precio_dia != null ? `${dinero(p.precio_dia)} / ${p.unidad.toLowerCase()}` : "Sin precio"}</strong></div>
          <span className="muted" style={{ fontSize: 14 }}>Humedad de referencia {n(p.humedad_base)} % · en bodega {kilos(n(p.stock))} {p.unidad.toLowerCase()}{p.costo != null ? ` · costo promedio ${dinero(p.costo)}` : ""}</span>
        </button>
      ))}
      {gestiona && <button className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar producto que compras</button>}
      {elegir && <SelectorProducto filtro="todos" titulo="¿Qué compras?" alCerrar={() => setElegir(false)}
        alElegir={(p: Producto) => { setElegir(false); setEditar({ producto: p, humedad: "", precio: "" }); }} />}
      {editar && (
        <Dialogo titulo={editar.producto.nombre} alCerrar={() => setEditar(null)}>
          <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <CampoMonto id="pd-p" etiqueta={`Precio del día por ${editar.producto.unidad.toLowerCase()}`} valor={editar.precio} alCambiar={(v) => setEditar({ ...editar, precio: v })} grande />
            <CampoMonto id="pd-h" etiqueta="Humedad de referencia % (sobre esta se descuenta)" valor={editar.humedad} alCambiar={(v) => setEditar({ ...editar, humedad: v })} />
            <button className="boton bloque">Guardar</button>
          </form>
        </Dialogo>
      )}
    </>
  );
}
