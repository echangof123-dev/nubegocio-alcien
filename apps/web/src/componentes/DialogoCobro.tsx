import { useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente, EstadoSri, InfoNegocio } from "../tipos";
import { tieneModulo } from "../tipos";
import { dinero, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Dialogo } from "./basicos";
import { ElegirCliente } from "../pantallas/Cobrar";

const NOMBRES: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", deuna: "DeUna", fiado: "Fiado" };

export interface DatosCobro {
  pagos: Record<string, unknown>[];
  comprobante: "nota" | "factura";
  cliente_id?: string;
  propina?: number;
}

/**
 * Cobro de algo ya armado (una cuenta de mesa, un pedido, una cita…): forma de pago, vuelto y
 * factura opcional. `cobrar` hace la llamada a la API y devuelve el número de venta.
 */
export function DialogoCobro({ info, titulo, total: subtotal, cliente: clienteInicial = null, alCerrar, cobrar, conFiado = true, conPropina = false }: {
  info: InfoNegocio; titulo: string; total: number; cliente?: Cliente | null;
  alCerrar: () => void; cobrar: (d: DatosCobro) => Promise<void>; conFiado?: boolean;
  /** Restaurantes: propina o 10 % de servicio, sin IVA. */
  conPropina?: boolean;
}) {
  const [propinaPct, setPropinaPct] = useState<number | "otra">(0);
  const [propinaOtra, setPropinaOtra] = useState("");
  const propina = propinaPct === "otra" ? redondear(parsearNumero(propinaOtra) ?? 0) : redondear(subtotal * propinaPct / 100);
  const total = redondear(subtotal + propina);
  const metodos = [...info.negocio.metodos_pago, ...(conFiado && tieneModulo(info, "M14") ? ["fiado"] : [])];
  const [metodo, setMetodo] = useState(metodos[0] ?? "efectivo");
  const [recibido, setRecibido] = useState("");
  const [factura, setFactura] = useState(false);
  const [sri, setSri] = useState<EstadoSri | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(clienteInicial);
  const [elegirCliente, setElegirCliente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (tieneModulo(info, "M19")) api<EstadoSri>("GET", "/sri/config").then(setSri).catch(() => {});
  }, [info]);

  const recibidoN = parsearNumero(recibido);
  const vuelto = metodo === "efectivo" && recibidoN !== null ? redondear(recibidoN - total) : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (metodo === "fiado" && !cliente) { setElegirCliente(true); return; }
    if (factura && cliente && !cliente.identificacion) { setElegirCliente(true); return; }
    if (factura && !cliente && total > 50) { setError("Las facturas de más de $50 necesitan la cédula o RUC del cliente."); return; }
    if (metodo === "efectivo" && recibidoN !== null && recibidoN < total) { setError("El efectivo recibido no alcanza."); return; }
    const pago: Record<string, unknown> = { metodo, monto: total };
    if (metodo === "efectivo") pago.recibido = recibidoN ?? total;
    setOcupado(true);
    try {
      await cobrar({ pagos: [pago], comprobante: factura ? "factura" : "nota", cliente_id: cliente?.id, ...(propina > 0 ? { propina } : {}) });
    } catch (err) {
      setError(mensajeDe(err));
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="monto-grande">{dinero(total)}</p>
        {conPropina && (
          <>
            <div className="chips" role="group" aria-label="Propina">
              {([0, 5, 10, "otra"] as const).map((x) => (
                <button type="button" key={String(x)} className={`chip${propinaPct === x ? " activo" : ""}`} aria-pressed={propinaPct === x}
                  onClick={() => setPropinaPct(x)}>{x === 0 ? "Sin propina" : x === "otra" ? "Otra" : `${x} %`}</button>
              ))}
            </div>
            {propinaPct === "otra" && <CampoMonto id="dc-propina" etiqueta="Propina" valor={propinaOtra} alCambiar={setPropinaOtra} />}
            {propina > 0 && <span className="muted" style={{ fontSize: 13 }}>Consumo {dinero(subtotal)} + propina {dinero(propina)}</span>}
          </>
        )}
        <div className="opciones" role="group" aria-label="Forma de pago">
          {metodos.map((m) => (
            <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} aria-pressed={metodo === m}
              onClick={() => { setMetodo(m); if (m === "fiado" && !cliente) setElegirCliente(true); }}>{NOMBRES[m] ?? m}</button>
          ))}
        </div>
        {metodo === "efectivo" && (
          <>
            <CampoMonto id="dc-recibido" etiqueta="Recibido (opcional)" valor={recibido} alCambiar={setRecibido} />
            {vuelto !== null && vuelto >= 0 && <div className="vuelto"><span style={{ fontWeight: 600 }}>Vuelto</span><strong>{dinero(vuelto)}</strong></div>}
          </>
        )}
        {sri?.listo && (
          <label className="casilla"><input type="checkbox" checked={factura} onChange={(e) => setFactura(e.target.checked)} /> Con factura electrónica</label>
        )}
        {(factura || metodo === "fiado") && (
          cliente ? (
            <div className="item-opcion activo">
              <span className="textos"><strong>{cliente.nombre}</strong><span>{cliente.identificacion ?? (factura ? "Falta su cédula o RUC" : cliente.celular ?? "")}</span></span>
              <button type="button" className="boton texto" onClick={() => setElegirCliente(true)}>Cambiar</button>
            </div>
          ) : (
            <button type="button" className="boton secundario" onClick={() => setElegirCliente(true)}>
              {factura && metodo !== "fiado" ? "Factura con datos del cliente (si no, consumidor final)" : "Elegir cliente"}
            </button>
          )
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={ocupado}>{ocupado ? "Registrando…" : `Cobrar ${dinero(total)}`}</button>
      </form>
      {elegirCliente && (
        <ElegirCliente paraFactura={factura} inicial={cliente} alCerrar={() => setElegirCliente(false)}
          alElegir={(c) => { setCliente(c); setElegirCliente(false); }} />
      )}
    </Dialogo>
  );
}
