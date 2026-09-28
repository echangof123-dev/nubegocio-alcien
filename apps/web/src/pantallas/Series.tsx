import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, Producto } from "../tipos";
import { fecha } from "../formato";
import { Aviso, Cargando, Dialogo } from "../componentes/basicos";
import { IBuscar, IMas } from "../componentes/iconos";
import { SelectorProducto } from "../componentes/SelectorProducto";

interface Serie {
  id: string; serie: string; estado: "en_stock" | "vendida" | "devuelta"; vendida_en: string | null; garantia_hasta: string | null;
  producto: string; cliente: string | null; celular: string | null; venta_numero: number | null; en_garantia: boolean;
}

/** Series e IMEI: qué se vendió a quién y hasta cuándo tiene garantía. */
export function Series({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [registrar, setRegistrar] = useState(false);

  const cargar = useCallback(() => {
    api<{ series: Serie[] }>("GET", "/series?q=" + encodeURIComponent(q)).then((r) => setSeries(r.series)).catch(() => setSeries([]));
  }, [q]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const f = (d: string) => fecha(d + "T12:00:00");
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Series y garantías</h1>
      <div className="con-icono">
        <IBuscar tam={20} />
        <label htmlFor="buscar-serie" className="oculto">Buscar serie</label>
        <input id="buscar-serie" className="entrada" placeholder="Número de serie, IMEI o producto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {info.rol !== "cajero" && <button className="boton secundario" onClick={() => setRegistrar(true)}><IMas tam={18} /> Registrar series en stock</button>}
      {!series ? <Cargando /> : (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          {series.map((s) => (
            <div key={s.id} className="comprobante-fila">
              <div className="textos">
                <strong>{s.serie}</strong>
                <span>{s.producto}</span>
                {s.estado === "vendida" && (
                  <span>Venta N.º {s.venta_numero} del {f(s.vendida_en!)}{s.cliente ? ` · ${s.cliente}` : ""}{s.garantia_hasta ? ` · garantía hasta ${f(s.garantia_hasta)}` : ""}</span>
                )}
              </div>
              {s.estado === "en_stock" ? <span className="insignia gris">En stock</span>
                : s.en_garantia ? <span className="insignia ok">Con garantía</span>
                : <span className="insignia no">Sin garantía</span>}
            </div>
          ))}
          {series.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>{q ? "No hay series con ese número." : "Al vender un producto con garantía, anota su serie y aquí sabrás hasta cuándo la tiene."}</p>}
        </div>
      )}
      {registrar && <RegistrarSeries alCerrar={() => setRegistrar(false)} alGuardar={(n) => { setRegistrar(false); avisar(`${n} series registradas`); cargar(); }} />}
    </div>
  );
}

function RegistrarSeries({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (n: number) => void }) {
  const [producto, setProducto] = useState<Producto | null>(null);
  const [texto, setTexto] = useState("");
  const [elegir, setElegir] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const series = texto.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ agregadas: number }>("POST", "/series", { producto_id: producto!.id, series });
      alGuardar(r.agregadas);
    } catch (err) { setError(mensajeDe(err)); }
  }
  return (
    <Dialogo titulo="Registrar series" alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button type="button" className="item-opcion" onClick={() => setElegir(true)}>
          <span className="textos"><strong>{producto?.nombre ?? "Elegir producto"}</strong><span>Toca para cambiar</span></span>
        </button>
        <div className="campo"><label htmlFor="rs-t">Series o IMEI (una por línea, o separadas por coma)</label>
          <textarea id="rs-t" className="entrada" rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={!producto || !series.length}>Registrar {series.length}</button>
      </form>
      {elegir && <SelectorProducto alCerrar={() => setElegir(false)} alElegir={(p) => { setProducto(p); setElegir(false); }} />}
    </Dialogo>
  );
}
