import { useCallback, useEffect, useState } from "react";
import { api, archivo, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { cantidad as fmtCantidad, dinero, fecha } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { descargarPlantilla, leerProductos, type Fila } from "../excel";

interface Resumen { productos: number; valor_costo?: number; valor_venta: number; agotados: number; bajos: number; sin_costo: number }
interface Alerta { id: string; nombre: string; unidad: string; stock: number; stock_minimo: number | null; categoria: string | null }
interface Movimiento { id: number; tipo: string; cantidad: number; costo_unitario: number | null; motivo: string | null; creado_en: string; usuario: string | null; numero: number | null }
const TIPOS: Record<string, string> = { inicial: "Stock inicial", venta: "Venta", anulacion: "Venta anulada", compra: "Compra", ajuste: "Ajuste" };

/** Inventario: cuánto vale, qué se está acabando, historial por producto y carga desde Excel. */
export function Inventario({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ resumen: Resumen; alertas: Alerta[] } | null>(null);
  const [cargar, setCargar] = useState(false);
  const [historial, setHistorial] = useState<Alerta | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const leer = useCallback(() => {
    api<{ resumen: Resumen; alertas: Alerta[] }>("GET", "/inventario").then(setDatos).catch(() => {});
  }, []);
  useEffect(leer, [leer]);

  if (!datos) return <Cargando />;
  const r = datos.resumen;
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Inventario</h1>
      <div className="rejilla-cifras">
        {r.valor_costo !== undefined && (
          <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Valor al costo</span>
            <span className="monto-grande">{dinero(r.valor_costo)}</span>
            {Number(r.sin_costo) > 0 && <span className="muted" style={{ fontSize: 12 }}>{r.sin_costo} productos sin costo no se cuentan</span>}</div>
        )}
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Valor a precio de venta</span>
          <span className="monto-grande">{dinero(r.valor_venta)}</span><span className="muted" style={{ fontSize: 12 }}>{r.productos} productos con stock</span></div>
        <div className="tarjeta" style={{ gap: 2 }}><span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Por acabarse</span>
          <span className="monto-grande">{r.bajos}</span><span className="muted" style={{ fontSize: 12 }}>{r.agotados} agotados</span></div>
      </div>
      {gestiona && (
        <div className="rejilla-2">
          <button className="boton" onClick={() => setCargar(true)}>Cargar desde Excel</button>
          <button className="boton secundario" onClick={() => archivo("/reportes/inventario.csv", { descargar: `inventario-${new Date().toISOString().slice(0, 10)}.csv` }).catch((e) => avisar(mensajeDe(e)))}>Descargar inventario</button>
        </div>
      )}
      <div className="tarjeta" style={{ padding: "4px 16px" }}>
        <h3 style={{ paddingTop: 12 }}>Agotados y por acabarse</h3>
        {datos.alertas.length === 0 && <p className="muted" style={{ padding: "8px 0 12px" }}>Todo tiene stock suficiente. Para recibir alertas, pon el stock mínimo en cada producto.</p>}
        {datos.alertas.map((a) => (
          <button key={a.id} className="movimiento boton-fila" onClick={() => setHistorial(a)}>
            <div className="textos"><strong>{a.nombre}</strong><span>{a.categoria ?? "Sin categoría"}{a.stock_minimo != null ? ` · mínimo ${fmtCantidad(Number(a.stock_minimo))}` : ""}</span></div>
            <span className={`insignia ${Number(a.stock) <= 0 ? "mal" : "no"}`}>{Number(a.stock) <= 0 ? "Agotado" : `Quedan ${fmtCantidad(Number(a.stock))}`}</span>
          </button>
        ))}
      </div>
      {cargar && <CargarExcel alCerrar={() => setCargar(false)} alTerminar={(t) => { setCargar(false); avisar(t); leer(); }} />}
      {historial && <HistorialProducto producto={historial} alCerrar={() => setHistorial(null)} />}
    </div>
  );
}

export function HistorialProducto({ producto, alCerrar }: { producto: { id: string; nombre: string; unidad: string; stock: number }; alCerrar: () => void }) {
  const [movs, setMovs] = useState<Movimiento[] | null>(null);
  useEffect(() => {
    api<{ movimientos: Movimiento[] }>("GET", `/productos/${producto.id}/movimientos`).then((r) => setMovs(r.movimientos)).catch(() => setMovs([]));
  }, [producto.id]);
  return (
    <Dialogo titulo={`Historial de ${producto.nombre}`} alCerrar={alCerrar}>
      <p className="muted" style={{ margin: 0 }}>Stock actual: <strong>{fmtCantidad(Number(producto.stock))} {producto.unidad.toLowerCase()}</strong></p>
      {!movs ? <Cargando /> : movs.length === 0 ? <p className="muted">Sin movimientos.</p> : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {movs.map((m) => (
            <div key={m.id} className="movimiento">
              <div className="textos">
                <strong>{TIPOS[m.tipo] ?? m.tipo}{m.numero ? ` N.º ${m.numero}` : ""}</strong>
                <span>{fecha(m.creado_en)}{m.usuario ? ` · ${m.usuario}` : ""}{m.motivo && m.tipo !== "venta" ? ` · ${m.motivo}` : ""}</span>
              </div>
              <strong className={Number(m.cantidad) < 0 ? "negativo" : "positivo"}>{Number(m.cantidad) > 0 ? "+" : "−"}{fmtCantidad(Math.abs(Number(m.cantidad)))}</strong>
            </div>
          ))}
        </div>
      )}
    </Dialogo>
  );
}

const ETIQUETAS: Record<string, string> = { nombre: "Nombre", categoria: "Categoría", unidad: "Unidad", precio: "Precio", costo: "Costo", stock: "Stock", stock_minimo: "Stock mínimo", codigo_barras: "Código de barras" };

function CargarExcel({ alCerrar, alTerminar }: { alCerrar: () => void; alTerminar: (texto: string) => void }) {
  const [leido, setLeido] = useState<{ filas: Fila[]; columnas: string[]; ignoradas: string[]; nombre: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ nuevos: number; actualizados: number; errores: { fila: number; nombre: string; error: string }[] } | null>(null);

  async function elegir(f: File | undefined) {
    if (!f) return;
    setError(null); setLeido(null); setResultado(null);
    try {
      const r = await leerProductos(f);
      if (!r.filas.length) throw new Error("El archivo no tiene productos debajo de los encabezados");
      if (r.filas.length > 3000) throw new Error("Carga hasta 3000 productos por archivo");
      setLeido({ ...r, nombre: f.name });
    } catch (e) { setError(mensajeDe(e)); }
  }
  async function subir() {
    setOcupado(true);
    try {
      const r = await api<{ resultado: NonNullable<typeof resultado> }>("POST", "/productos/importar", { filas: leido!.filas });
      setResultado(r.resultado);
    } catch (e) { setError(mensajeDe(e)); }
    setOcupado(false);
  }

  if (resultado) {
    return (
      <Dialogo titulo="Carga terminada" alCerrar={() => alTerminar(`${resultado.nuevos} nuevos y ${resultado.actualizados} actualizados`)}>
        <Aviso tipo="exito" titulo={`${resultado.nuevos} productos nuevos · ${resultado.actualizados} actualizados`}>Ya están en Productos.</Aviso>
        {resultado.errores.length > 0 && (
          <Aviso tipo="atencion" titulo={`${resultado.errores.length} filas no se cargaron`}>
            {resultado.errores.slice(0, 20).map((e) => <div key={e.fila}>Fila {e.fila + 1}{e.nombre ? ` (${e.nombre})` : ""}: {e.error}</div>)}
          </Aviso>
        )}
        <button className="boton bloque" onClick={() => alTerminar(`${resultado.nuevos} nuevos y ${resultado.actualizados} actualizados`)}>Listo</button>
      </Dialogo>
    );
  }
  return (
    <Dialogo titulo="Cargar productos desde Excel" alCerrar={alCerrar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ol className="muted" style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
          <li>Descarga la plantilla y llénala (una fila por producto).</li>
          <li>Guárdala y súbela aquí: sirve .xlsx o .csv.</li>
          <li>Si el producto ya existe (mismo nombre), se actualizan su precio, costo y stock.</li>
        </ol>
        <button className="boton secundario" onClick={descargarPlantilla}>Descargar plantilla</button>
        <label className="boton" htmlFor="excel-archivo" style={{ cursor: "pointer" }}>Elegir archivo</label>
        <input id="excel-archivo" className="oculto" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ""; }} />
        {leido && (
          <div className="tarjeta" style={{ gap: 6, background: "var(--surface-alt)" }}>
            <strong>{leido.nombre}: {leido.filas.length} productos</strong>
            <span className="muted" style={{ fontSize: 13 }}>Columnas: {leido.columnas.map((c) => ETIQUETAS[c] ?? c).join(", ")}</span>
            {leido.ignoradas.length > 0 && <span className="muted" style={{ fontSize: 13 }}>No se usan: {leido.ignoradas.join(", ")}</span>}
            <span className="muted" style={{ fontSize: 13 }}>Ej.: {leido.filas.slice(0, 3).map((f) => f.nombre).filter(Boolean).join(" · ")}</span>
          </div>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!leido || ocupado} onClick={subir}>{ocupado ? "Cargando…" : leido ? `Cargar ${leido.filas.length} productos` : "Cargar"}</button>
      </div>
    </Dialogo>
  );
}
