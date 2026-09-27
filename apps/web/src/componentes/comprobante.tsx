import { useEffect, useState } from "react";
import { api } from "../api";
import type { Comprobante, EstadoComprobante } from "../tipos";

const TEXTO: Record<EstadoComprobante, [string, string]> = {
  por_firmar: ["Por firmar", "gris"],
  firmado: ["Enviando al SRI", "no"],
  recibido: ["En el SRI", "no"],
  autorizado: ["Autorizada", "ok"],
  devuelto: ["Rechazada", "mal"],
  no_autorizado: ["No autorizada", "mal"],
  anulado: ["Anulada", "gris"],
};

export function EstadoSri({ estado, tipo = "factura" }: { estado: EstadoComprobante; tipo?: Comprobante["tipo"] }) {
  let [texto, clase] = TEXTO[estado];
  if (tipo === "nota_credito") texto = texto.replace(/da$/, "do").replace(/^Anulado$/, "Anulada");
  return <span className={`insignia ${clase}`}>{texto}</span>;
}

export const enlaceRide = (c: Pick<Comprobante, "token_publico">) => `${location.origin}/api/c/${c.token_publico}`;

/** Enlace de WhatsApp con el comprobante. Si hay celular del cliente, abre su chat. */
export function enlaceWhatsApp(c: Comprobante, negocio: string, celular?: string | null): string {
  const tipo = c.tipo === "factura" ? "factura" : "nota de crédito";
  const texto = `Hola, te comparto tu ${tipo} ${c.numero} de ${negocio}: ${enlaceRide(c)}`;
  const numero = (celular ?? c.comprador.telefono ?? "").replace(/\D/g, "").replace(/^0(?=9\d{8}$)/, "593");
  return `https://wa.me/${/^\d{10,15}$/.test(numero) ? numero : ""}?text=${encodeURIComponent(texto)}`;
}

/** Sigue un comprobante hasta que el SRI responda (o se canse de esperar). */
export function useSeguimiento(id: string | null): Comprobante | null {
  const [c, setC] = useState<Comprobante | null>(null);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    let intentos = 0;
    let t: number | undefined;
    const pedir = () => {
      api<{ comprobante: Comprobante }>("GET", `/comprobantes/${id}`)
        .then((r) => {
          if (!vivo) return;
          setC(r.comprobante);
          const pendiente = r.comprobante.estado === "firmado" || r.comprobante.estado === "recibido";
          if (pendiente && ++intentos < 15) t = window.setTimeout(pedir, 1500);
        })
        .catch(() => { if (vivo && ++intentos < 15) t = window.setTimeout(pedir, 3000); });
    };
    pedir();
    return () => { vivo = false; window.clearTimeout(t); };
  }, [id]);
  return c;
}
