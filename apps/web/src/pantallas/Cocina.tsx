import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "../api";
import { cantidad as fmtCantidad } from "../formato";
import { Cargando } from "../componentes/basicos";

interface Comanda { id: number; nombre: string; cantidad: number; nota: string | null; cocina: "enviado" | "listo"; enviado_en: string; destino: string }
interface PedidoCocina {
  id: string; numero: number; nombre: string; tipo: "retiro" | "domicilio"; estado: "recibido" | "preparando";
  hora_entrega: string | null; creado_en: string; items: { nombre: string; cantidad: number; nota: string | null }[];
}

const hace = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? "recién" : `hace ${m} min`; };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

/** Pantalla para la cocina: se actualiza sola y se usa con un toque. */
export function Cocina({ avisar }: { avisar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ comandas: Comanda[]; pedidos: PedidoCocina[] } | null>(null);

  const cargar = useCallback(() => {
    api<{ comandas: Comanda[]; pedidos: PedidoCocina[] }>("GET", "/cocina").then(setDatos).catch(() => {});
  }, []);
  useEffect(() => {
    cargar();
    const t = window.setInterval(cargar, 10_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  async function marcar(ruta: string, cuerpo: unknown) {
    try { await api("POST", ruta, cuerpo); cargar(); } catch (e) { avisar(mensajeDe(e)); }
  }

  if (!datos) return <Cargando />;
  const destinos = [...new Set(datos.comandas.map((c) => c.destino))];

  return (
    <div className="contenido">
      <h1>Cocina</h1>
      {destinos.length === 0 && datos.pedidos.length === 0 && <div className="vacio"><p>No hay nada por preparar.</p></div>}
      <div className="rejilla-cocina">
        {destinos.map((d) => {
          const lista = datos.comandas.filter((c) => c.destino === d);
          return (
            <div key={d} className="tarjeta comanda">
              <div className="fila"><h3>{d}</h3><span className="muted" style={{ fontSize: 13 }}>{hace(lista[0]!.enviado_en)}</span></div>
              {lista.map((c) => (
                <div key={c.id} className="fila" style={{ alignItems: "flex-start" }}>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <strong className={c.cocina === "listo" ? "anulada" : ""}>{fmtCantidad(c.cantidad)} × {c.nombre}</strong>
                    {c.nota && <span style={{ color: "var(--danger)", fontWeight: 600 }}>{c.nota}</span>}
                  </span>
                  {c.cocina === "enviado"
                    ? <button className="boton pequeno" onClick={() => marcar(`/cocina/${c.id}`, { estado: "listo" })}>Listo</button>
                    : <button className="boton pequeno secundario" onClick={() => marcar(`/cocina/${c.id}`, { estado: "entregado" })}>Servido</button>}
                </div>
              ))}
            </div>
          );
        })}
        {datos.pedidos.map((p) => (
          <div key={p.id} className="tarjeta comanda">
            <div className="fila">
              <h3>Pedido {p.numero} · {p.nombre}</h3>
              <span className="insignia no">{p.tipo === "domicilio" ? "Domicilio" : "Retiro"}</span>
            </div>
            {p.hora_entrega && <span className="muted" style={{ fontSize: 13 }}>Para las {hora(p.hora_entrega)}</span>}
            {p.items.map((i, n) => (
              <span key={n}><strong>{fmtCantidad(i.cantidad)} × {i.nombre}</strong>{i.nota && <span style={{ color: "var(--danger)", fontWeight: 600 }}> · {i.nota}</span>}</span>
            ))}
            <button className="boton pequeno" onClick={() => marcar(`/pedidos/${p.id}/estado`, { estado: p.estado === "recibido" ? "preparando" : "listo" })}>
              {p.estado === "recibido" ? "Empezar" : "Listo"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
