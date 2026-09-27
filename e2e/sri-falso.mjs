// SRI de mentira para el recorrido en navegador: recibe y autoriza todo lo que llega.
//   node e2e/sri-falso.mjs            (puerto 9099)
//   SRI_URL_PRUEBAS=http://127.0.0.1:9099/ws en la API
import http from "node:http";

const PUERTO = Number(process.env.PUERTO ?? 9099);
const recibidos = new Map();

const sobre = (cuerpo) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;

http.createServer(async (req, res) => {
  let cuerpo = "";
  for await (const t of req) cuerpo += t;
  res.setHeader("content-type", "text/xml; charset=utf-8");

  if (req.url.endsWith("/RecepcionComprobantesOffline")) {
    const xml = Buffer.from(/<xml>([^<]+)<\/xml>/.exec(cuerpo)?.[1] ?? "", "base64").toString("utf8");
    const clave = /<claveAcceso>(\d{49})<\/claveAcceso>/.exec(xml)?.[1];
    if (clave) recibidos.set(clave, xml);
    res.end(sobre(`<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>${clave ? "RECIBIDA" : "DEVUELTA"}</estado><comprobantes/></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>`));
    return;
  }

  const clave = /<claveAccesoComprobante>(\d{49})</.exec(cuerpo)?.[1];
  const xml = recibidos.get(clave);
  const autorizacion = xml
    ? `<autorizaciones><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${clave}</numeroAutorizacion><fechaAutorizacion>${new Date().toISOString()}</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[${xml}]]></comprobante><mensajes/></autorizacion></autorizaciones>`
    : "<autorizaciones/>";
  res.end(sobre(`<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${clave}</claveAccesoConsultada><numeroComprobantes>${xml ? 1 : 0}</numeroComprobantes>${autorizacion}</RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>`));
}).listen(PUERTO, "127.0.0.1", () => console.log(`SRI de mentira en http://127.0.0.1:${PUERTO}/ws`));
