import { useEffect, useState } from "react";
import { api } from "../api";
import type { Producto } from "../tipos";
import { dinero, cantidad as fmtCantidad } from "../formato";
import { Dialogo } from "./basicos";

/** Buscar y elegir un producto (compras, cotizaciones, recetas…). */
export function SelectorProducto({ alElegir, alCerrar, titulo = "Elegir producto" }: {
  alElegir: (p: Producto) => void; alCerrar: () => void; titulo?: string;
}) {
  const [q, setQ] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ productos: Producto[] }>("GET", "/productos?q=" + encodeURIComponent(q)).then((r) => setProductos(r.productos)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      <div className="campo">
        <label htmlFor="sel-prod">Buscar</label>
        <input id="sel-prod" className="entrada" placeholder="Nombre o código de barras" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="lista-opciones" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {productos.map((p) => (
          <button key={p.id} className="item-opcion" onClick={() => alElegir(p)}>
            <span className="textos">
              <strong>{p.nombre}</strong>
              <span>{p.precio !== null ? dinero(p.precio) : "Sin precio"}{p.maneja_stock ? ` · Stock ${fmtCantidad(p.stock)} ${p.unidad.toLowerCase()}` : ""}</span>
            </span>
          </button>
        ))}
        {productos.length === 0 && <p className="muted">No hay productos con ese nombre.</p>}
      </div>
    </Dialogo>
  );
}
