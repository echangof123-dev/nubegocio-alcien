/** Combo: un producto armado con otros ("Combo desayuno" = café + 2 panes). Al venderlo baja el stock de cada uno. */
import { useEffect, useState } from "react";
import { api, mensajeDe } from "../api";
import type { Producto } from "../tipos";
import { dinero, parsearNumero } from "../formato";
import { Aviso, Cargando, Dialogo } from "./basicos";
import { IBasura, IMas } from "./iconos";
import { SelectorProducto } from "./SelectorProducto";

interface Componente { producto_id: string; nombre: string; cantidad: string; precio: number | null }

export function EditarCombo({ producto, alCerrar, alGuardar }: { producto: Producto; alCerrar: () => void; alGuardar: (texto: string) => void }) {
  const [lista, setLista] = useState<Componente[] | null>(null);
  const [elegir, setElegir] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ componentes: { producto_id: string; nombre: string; cantidad: number; precio: number | null }[] }>("GET", `/productos/${producto.id}/combo`)
      .then((r) => setLista(r.componentes.map((c) => ({ ...c, cantidad: String(Number(c.cantidad)).replace(".", ",") }))))
      .catch(() => setLista([]));
  }, [producto.id]);

  async function guardar() {
    setError(null);
    try {
      const r = await api<{ costo: number }>("POST", `/productos/${producto.id}/combo`, {
        componentes: lista!.map((c) => ({ producto_id: c.producto_id, cantidad: parsearNumero(c.cantidad) ?? 1 })) });
      alGuardar(`Combo guardado · costo ${dinero(Number(r.costo))}`);
    } catch (e) { setError(mensajeDe(e)); }
  }
  async function deshacer() {
    try { await api("DELETE", `/productos/${producto.id}/combo`); alGuardar("Ya no es combo"); } catch (e) { setError(mensajeDe(e)); }
  }
  const sumaPrecios = (lista ?? []).reduce((s, c) => s + (c.precio ?? 0) * (parsearNumero(c.cantidad) ?? 0), 0);

  return (
    <Dialogo titulo={`Combo: ${producto.nombre}`} alCerrar={alCerrar}>
      {!lista ? <Cargando /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Elige qué lleva. Al venderlo, baja el stock de cada producto.</p>
          {lista.map((c, i) => (
            <div key={c.producto_id} className="fila" style={{ gap: 8 }}>
              <span style={{ flex: 1 }}>{c.nombre}</span>
              <input className="entrada" style={{ width: 80 }} inputMode="decimal" aria-label={`Cantidad de ${c.nombre}`} value={c.cantidad}
                onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} />
              <button type="button" className="boton texto" aria-label={`Quitar ${c.nombre}`} onClick={() => setLista(lista.filter((_, j) => j !== i))}><IBasura tam={18} /></button>
            </div>
          ))}
          <button type="button" className="boton secundario" onClick={() => setElegir(true)}><IMas tam={18} /> Agregar producto al combo</button>
          {lista.length > 0 && producto.precio != null && (
            <span className="muted" style={{ fontSize: 13 }}>Por separado cuestan {dinero(sumaPrecios)}; el combo se vende a {dinero(producto.precio)}.</span>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={!lista.length} onClick={guardar}>Guardar combo</button>
          {producto.es_combo && <button className="boton texto" onClick={deshacer}>Ya no es combo</button>}
        </div>
      )}
      {elegir && <SelectorProducto titulo="Agregar al combo" alCerrar={() => setElegir(false)} alElegir={(p) => {
        setElegir(false);
        if (p.id === producto.id || lista?.some((c) => c.producto_id === p.id)) return;
        setLista([...(lista ?? []), { producto_id: p.id, nombre: p.nombre, cantidad: "1", precio: p.precio }]);
      }} />}
    </Dialogo>
  );
}
