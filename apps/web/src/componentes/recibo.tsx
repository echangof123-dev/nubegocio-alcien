/** Recibo de una venta: enviarlo por WhatsApp o imprimirlo en la impresora térmica. */
import { useState } from "react";
import { dinero } from "../formato";

export type Impresora = "58" | "80" | "carta";
const CLAVE = "alcien.impresora";

export function impresoraGuardada(): Impresora {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "58" || v === "80" || v === "carta" ? v : "58";
  } catch { return "58"; }
}
export function guardarImpresora(v: Impresora) {
  try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento: solo por esta vez */ }
}

export const enlaceRecibo = (token: string) => `${location.origin}/api/r/${token}`;

export function imprimirRecibo(token: string) {
  const ancho = impresoraGuardada();
  window.open(`/api/r/${token}?imprimir=1${ancho === "carta" ? "" : `&ancho=${ancho}`}`, "_blank");
}

export function whatsappRecibo(token: string, negocio: string, total: number, celular?: string | null) {
  const n = (celular ?? "").replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593");
  const texto = `Gracias por tu compra en ${negocio} (${dinero(total)}). Tu recibo: ${enlaceRecibo(token)}`;
  return `https://wa.me/${/^\d{10,15}$/.test(n) ? n : ""}?text=${encodeURIComponent(texto)}`;
}

export function AccionesRecibo({ token, negocio, total, celular, compacto = false }: {
  token: string; negocio: string; total: number; celular?: string | null; compacto?: boolean;
}) {
  const [ancho, setAncho] = useState<Impresora>(impresoraGuardada());
  const clase = compacto ? "boton pequeno secundario" : "boton secundario";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div className="acciones-fila" style={{ width: "100%" }}>
        <a className={clase} style={{ flex: 1 }} href={whatsappRecibo(token, negocio, total, celular)} target="_blank" rel="noopener">Enviar recibo</a>
        <button type="button" className={clase} style={{ flex: 1 }} onClick={() => imprimirRecibo(token)}>Imprimir</button>
      </div>
      {!compacto && (
        <div className="chips" role="group" aria-label="Tamaño de impresora" style={{ justifyContent: "center" }}>
          {(["58", "80", "carta"] as const).map((a) => (
            <button type="button" key={a} className={`chip${ancho === a ? " activo" : ""}`} aria-pressed={ancho === a}
              onClick={() => { setAncho(a); guardarImpresora(a); }}>{a === "carta" ? "Hoja" : `${a} mm`}</button>
          ))}
        </div>
      )}
    </div>
  );
}
