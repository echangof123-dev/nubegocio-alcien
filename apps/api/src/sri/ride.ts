/**
 * RIDE: la representación impresa del comprobante electrónico. Se arma desde el mismo XML
 * firmado que recibió el SRI, así lo impreso siempre coincide con lo autorizado.
 */
import { leerXml, buscar, buscarTodos, textoDe, type NodoXml } from "./xml.js";
import { svgCode128 } from "./code128.js";

export interface DatosRide {
  tipo: string;
  numero: string;
  estado: string;
  ambiente: number;
  clave_acceso: string;
  xml_firmado: string;
  numero_autorizacion: string | null;
  fecha_autorizacion: string | Date | null;
  anulado_por_nc: boolean;
}

const h = (t: string | number | null | undefined) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NOMBRE_IVA: Record<string, string> = {
  "0": "0 %", "2": "12 %", "3": "14 %", "4": "15 %", "5": "5 %", "8": "8 %", "10": "13 %", "6": "No objeto", "7": "Exento",
};
const FORMA_PAGO: Record<string, string> = {
  "01": "Sin utilización del sistema financiero", "15": "Compensación de deudas", "16": "Tarjeta de débito",
  "17": "Dinero electrónico", "18": "Tarjeta prepago", "19": "Tarjeta de crédito",
  "20": "Otros con utilización del sistema financiero", "21": "Endoso de títulos",
};
const TIPO_ID: Record<string, string> = { "04": "RUC", "05": "Cédula", "06": "Pasaporte", "07": "Consumidor final", "08": "Identificación del exterior" };

function fechaHora(v: string | Date | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const l = new Date(d.getTime() - 5 * 3600_000).toISOString();
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 19)}`;
}

const dinero = (t: string) => (t ? Number(t).toFixed(2) : "0.00");
const cantidad = (t: string) => String(Number(t));

function fila(etiqueta: string, valor: string) {
  return valor ? `<tr><th>${h(etiqueta)}</th><td>${h(valor)}</td></tr>` : "";
}

export function htmlRide(d: DatosRide, enlaceXml: string): string {
  const doc = leerXml(d.xml_firmado);
  const it = buscar(doc, "infoTributaria");
  const esNota = d.tipo === "nota_credito";
  const info: NodoXml | undefined = buscar(doc, esNota ? "infoNotaCredito" : "infoFactura");
  const titulo = esNota ? "NOTA DE CRÉDITO" : "FACTURA";

  const detalles = buscarTodos(buscar(doc, "detalles"), "detalle").map((x) => `
    <tr>
      <td>${h(textoDe(x, esNota ? "codigoInterno" : "codigoPrincipal"))}</td>
      <td class="n">${h(cantidad(textoDe(x, "cantidad")))}</td>
      <td>${h(textoDe(x, "descripcion"))}</td>
      <td class="n">${h(Number(textoDe(x, "precioUnitario")).toFixed(4))}</td>
      <td class="n">${h(dinero(textoDe(x, "descuento")))}</td>
      <td class="n">${h(dinero(textoDe(x, "precioTotalSinImpuesto")))}</td>
    </tr>`).join("");

  const impuestos = buscarTodos(buscar(info, "totalConImpuestos"), "totalImpuesto");
  const subtotales = impuestos.map((t) => {
    const nombre = NOMBRE_IVA[textoDe(t, "codigoPorcentaje")] ?? textoDe(t, "codigoPorcentaje");
    return `<tr><th>Subtotal ${h(nombre)}</th><td>${h(dinero(textoDe(t, "baseImponible")))}</td></tr>`;
  }).join("");
  const ivas = impuestos.filter((t) => Number(textoDe(t, "valor")) > 0).map((t) => {
    const nombre = NOMBRE_IVA[textoDe(t, "codigoPorcentaje")] ?? "";
    return `<tr><th>IVA ${h(nombre)}</th><td>${h(dinero(textoDe(t, "valor")))}</td></tr>`;
  }).join("");
  const total = esNota ? textoDe(info, "valorModificacion") : textoDe(info, "importeTotal");

  const pagos = buscarTodos(buscar(info, "pagos"), "pago").map((p) =>
    `<tr><td>${h(FORMA_PAGO[textoDe(p, "formaPago")] ?? textoDe(p, "formaPago"))}</td><td class="n">${h(dinero(textoDe(p, "total")))}</td></tr>`).join("");

  const adicional = buscarTodos(buscar(doc, "infoAdicional"), "campoAdicional")
    .map((c) => fila(c.atributos.nombre ?? "", c.texto.trim())).join("");

  let aviso = "";
  if (d.estado !== "autorizado") {
    const txt: Record<string, string> = {
      firmado: "En proceso de autorización en el SRI.",
      recibido: "En proceso de autorización en el SRI.",
      devuelto: "El SRI rechazó este comprobante: no tiene validez tributaria.",
      no_autorizado: "El SRI no autorizó este comprobante: no tiene validez tributaria.",
      anulado: "Comprobante anulado: no tiene validez tributaria.",
    };
    aviso = `<p class="aviso">${h(txt[d.estado] ?? "Comprobante sin autorización del SRI.")}</p>`;
  } else if (d.anulado_por_nc) {
    aviso = `<p class="aviso">Esta factura fue anulada con una nota de crédito.</p>`;
  }
  if (d.ambiente === 1) aviso += `<p class="aviso prueba">Ambiente de PRUEBAS: sin validez tributaria.</p>`;

  const rimpe = textoDe(it, "contribuyenteRimpe");
  const nombreComercial = textoDe(it, "nombreComercial");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${h(titulo)} ${h(d.numero)}</title>
<style>
  :root { color-scheme: light; --tinta: #0b1b33; --suave: #5b6b82; --linea: #d9e0ea; --marca: #1847c2; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #f3f5f9; color: var(--tinta); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .hoja { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid var(--linea); border-radius: 10px; padding: 20px; }
  .cab { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .caja { border: 1px solid var(--linea); border-radius: 8px; padding: 12px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 8px; color: var(--marca); letter-spacing: .02em; }
  .num { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .etq { color: var(--suave); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-top: 6px; }
  .clave { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; word-break: break-all; }
  .barras svg { width: 100%; height: 44px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .det { margin-top: 14px; }
  .det th, .det td { border-bottom: 1px solid var(--linea); padding: 6px 4px; text-align: left; vertical-align: top; }
  .det th { font-size: 11px; color: var(--suave); text-transform: uppercase; }
  .n { text-align: right !important; white-space: nowrap; }
  .pie { display: grid; grid-template-columns: 1fr 280px; gap: 16px; margin-top: 14px; }
  .kv th { text-align: left; font-weight: 500; color: var(--suave); padding: 3px 0; }
  .kv td { text-align: right; padding: 3px 0; }
  .total th, .total td { font-size: 15px; font-weight: 700; color: var(--tinta); border-top: 2px solid var(--tinta); padding-top: 6px; }
  .aviso { margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; background: #fff4d6; color: #6b4a00; font-weight: 600; }
  .aviso.prueba { background: #eef2ff; color: #1b2f7a; }
  .acciones { max-width: 820px; margin: 12px auto 0; text-align: center; color: var(--suave); }
  .acciones a { color: var(--marca); }
  @media (max-width: 640px) { .cab, .pie { grid-template-columns: 1fr; } .det .oc { display: none; } }
  @media print { body { background: #fff; padding: 0; } .hoja { border: 0; } .acciones { display: none; } }
</style></head>
<body>
<main class="hoja">
  ${aviso}
  <div class="cab">
    <div class="caja">
      <h1>${h(nombreComercial || textoDe(it, "razonSocial"))}</h1>
      ${nombreComercial ? `<div>${h(textoDe(it, "razonSocial"))}</div>` : ""}
      <div class="etq">Dirección matriz</div><div>${h(textoDe(it, "dirMatriz"))}</div>
      ${textoDe(info, "dirEstablecimiento") ? `<div class="etq">Dirección sucursal</div><div>${h(textoDe(info, "dirEstablecimiento"))}</div>` : ""}
      ${textoDe(info, "contribuyenteEspecial") ? `<div class="etq">Contribuyente especial N°</div><div>${h(textoDe(info, "contribuyenteEspecial"))}</div>` : ""}
      <div class="etq">Obligado a llevar contabilidad</div><div>${h(textoDe(info, "obligadoContabilidad") || "NO")}</div>
      ${textoDe(it, "agenteRetencion") ? `<div class="etq">Agente de retención</div><div>Resolución N° ${h(textoDe(it, "agenteRetencion"))}</div>` : ""}
      ${rimpe ? `<div style="margin-top:8px;font-weight:600">${h(rimpe)}</div>` : ""}
    </div>
    <div class="caja">
      <div class="etq" style="margin-top:0">R.U.C.</div><div class="num">${h(textoDe(it, "ruc"))}</div>
      <h2>${h(titulo)}</h2>
      <div class="num">N° ${h(d.numero)}</div>
      <div class="etq">Número de autorización</div><div class="clave">${h(d.numero_autorizacion ?? "—")}</div>
      <div class="etq">Fecha y hora de autorización</div><div>${h(fechaHora(d.fecha_autorizacion)) || "—"}</div>
      <div class="etq">Ambiente</div><div>${d.ambiente === 2 ? "PRODUCCIÓN" : "PRUEBAS"}</div>
      <div class="etq">Emisión</div><div>NORMAL</div>
      <div class="etq">Clave de acceso</div>
      <div class="barras">${svgCode128(d.clave_acceso)}</div>
      <div class="clave">${h(d.clave_acceso)}</div>
    </div>
  </div>

  <div class="caja" style="margin-top:14px">
    <table class="kv">
      ${fila("Razón social / Nombres", textoDe(info, "razonSocialComprador"))}
      ${fila(TIPO_ID[textoDe(info, "tipoIdentificacionComprador")] ?? "Identificación", textoDe(info, "identificacionComprador"))}
      ${fila("Fecha de emisión", textoDe(info, "fechaEmision"))}
      ${esNota ? fila("Comprobante que se modifica", `FACTURA ${textoDe(info, "numDocModificado")}`) : ""}
      ${esNota ? fila("Fecha de emisión (comprobante a modificar)", textoDe(info, "fechaEmisionDocSustento")) : ""}
      ${esNota ? fila("Razón de modificación", textoDe(info, "motivo")) : ""}
    </table>
  </div>

  <table class="det">
    <thead><tr><th>Código</th><th class="n">Cant.</th><th>Descripción</th><th class="n">P. unitario</th><th class="n">Desc.</th><th class="n">P. total</th></tr></thead>
    <tbody>${detalles}</tbody>
  </table>

  <div class="pie">
    <div>
      ${adicional ? `<div class="caja"><div class="etq" style="margin-top:0">Información adicional</div><table class="kv">${adicional}</table></div>` : ""}
      ${pagos ? `<div class="caja" style="margin-top:12px"><div class="etq" style="margin-top:0">Forma de pago</div><table class="kv">${pagos}</table></div>` : ""}
    </div>
    <table class="kv">
      ${subtotales}
      <tr><th>Subtotal sin impuestos</th><td>${h(dinero(textoDe(info, "totalSinImpuestos")))}</td></tr>
      ${esNota ? "" : `<tr><th>Total descuento</th><td>${h(dinero(textoDe(info, "totalDescuento")))}</td></tr>`}
      ${ivas}
      <tr class="total"><th>Valor total</th><td>$ ${h(dinero(total))}</td></tr>
    </table>
  </div>
</main>
<p class="acciones">Para imprimir o guardar en PDF usa el menú del navegador · <a href="${h(enlaceXml)}">Descargar XML</a></p>
</body></html>`;
}

/** XML autorizado (como lo entrega el SRI) para descargar. */
export function xmlAutorizado(d: DatosRide): string {
  const fecha = d.fecha_autorizacion ? new Date(d.fecha_autorizacion).toISOString() : "";
  const cdata = d.xml_firmado.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<?xml version="1.0" encoding="UTF-8"?><autorizacion><estado>${d.estado === "autorizado" ? "AUTORIZADO" : h(d.estado.toUpperCase())}</estado>` +
    `<numeroAutorizacion>${h(d.numero_autorizacion ?? "")}</numeroAutorizacion><fechaAutorizacion>${h(fecha)}</fechaAutorizacion>` +
    `<ambiente>${d.ambiente === 2 ? "PRODUCCIÓN" : "PRUEBAS"}</ambiente><comprobante><![CDATA[${cdata}]]></comprobante></autorizacion>`;
}
