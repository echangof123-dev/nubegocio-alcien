/**
 * Firma XAdES-BES "enveloped" como la pide el SRI: RSA-SHA1, digests SHA1 y C14N 1.0.
 * Se firman tres referencias: las propiedades firmadas, el certificado (KeyInfo) y el comprobante.
 */
import crypto from "node:crypto";
import { el, serializar, DECLARACION, type Elemento } from "./xml.js";
import { emisorRfc2253, type Firma } from "./p12.js";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const ETSI = "http://uri.etsi.org/01903/v1.3.2#";
const NS = { "xmlns:ds": DS, "xmlns:etsi": ETSI };
const SHA1 = `${DS}sha1`;

const sha1 = (t: string | Buffer) => crypto.createHash("sha1").update(t).digest("base64");
const b64 = (b64url: string) => Buffer.from(b64url, "base64url").toString("base64");

/** Hora con el desfase de Ecuador (UTC−5, sin horario de verano). */
export function horaEcuador(d: Date): string {
  const local = new Date(d.getTime() - 5 * 3600_000);
  return local.toISOString().slice(0, 19) + "-05:00";
}

const metodoDigest = () => el("ds:DigestMethod", { Algorithm: SHA1 });

/**
 * Firma el comprobante (elemento raíz con id="comprobante") y devuelve el documento completo.
 * El elemento raíz recibe la firma como último hijo.
 */
export function firmarComprobante(raiz: Elemento, firma: Firma, ahora = new Date()): string {
  if (raiz.atributos.id !== "comprobante") throw new Error('La raíz debe tener id="comprobante"');
  const n = crypto.randomInt(100000, 999999);
  const idFirma = `Signature${n}`;
  const idPropiedades = `${idFirma}-SignedProperties${crypto.randomInt(100000, 999999)}`;
  const idCertificado = `Certificate${crypto.randomInt(100000, 999999)}`;
  const idReferencia = `Reference-ID-${crypto.randomInt(100000, 999999)}`;

  // 1. Digest del comprobante (sin la firma: transformación "enveloped")
  const digestComprobante = sha1(serializar(raiz));

  // 2. Propiedades firmadas
  const cert = firma.certificado;
  const propiedades = el("etsi:SignedProperties", { Id: idPropiedades },
    el("etsi:SignedSignatureProperties", null,
      el("etsi:SigningTime", null, horaEcuador(ahora)),
      el("etsi:SigningCertificate", null,
        el("etsi:Cert", null,
          el("etsi:CertDigest", null, metodoDigest(), el("ds:DigestValue", null, sha1(cert.raw))),
          el("etsi:IssuerSerial", null,
            el("ds:X509IssuerName", null, emisorRfc2253(cert)),
            el("ds:X509SerialNumber", null, firma.serie))))),
    el("etsi:SignedDataObjectProperties", null,
      el("etsi:DataObjectFormat", { ObjectReference: `#${idReferencia}` },
        el("etsi:Description", null, "contenido comprobante"),
        el("etsi:MimeType", null, "text/xml"))));
  const digestPropiedades = sha1(serializar(propiedades, NS));

  // 3. Certificado y llave pública
  const jwk = crypto.createPublicKey(firma.llave).export({ format: "jwk" }) as { n: string; e: string };
  const keyInfo = el("ds:KeyInfo", { Id: idCertificado },
    el("ds:X509Data", null, el("ds:X509Certificate", null, cert.raw.toString("base64"))),
    el("ds:KeyValue", null,
      el("ds:RSAKeyValue", null, el("ds:Modulus", null, b64(jwk.n)), el("ds:Exponent", null, b64(jwk.e)))));
  const digestKeyInfo = sha1(serializar(keyInfo, NS));

  // 4. SignedInfo y valor de la firma
  const signedInfo = el("ds:SignedInfo", { Id: `Signature-SignedInfo${crypto.randomInt(100000, 999999)}` },
    el("ds:CanonicalizationMethod", { Algorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315" }),
    el("ds:SignatureMethod", { Algorithm: `${DS}rsa-sha1` }),
    el("ds:Reference", { Id: `SignedPropertiesID${crypto.randomInt(100000, 999999)}`, Type: "http://uri.etsi.org/01903#SignedProperties", URI: `#${idPropiedades}` },
      metodoDigest(), el("ds:DigestValue", null, digestPropiedades)),
    el("ds:Reference", { URI: `#${idCertificado}` },
      metodoDigest(), el("ds:DigestValue", null, digestKeyInfo)),
    el("ds:Reference", { Id: idReferencia, URI: "#comprobante" },
      el("ds:Transforms", null, el("ds:Transform", { Algorithm: `${DS}enveloped-signature` })),
      metodoDigest(), el("ds:DigestValue", null, digestComprobante)));
  const valor = crypto.sign("sha1", Buffer.from(serializar(signedInfo, NS), "utf8"), firma.llave).toString("base64");

  const signature = el("ds:Signature", { ...NS, Id: idFirma },
    signedInfo,
    el("ds:SignatureValue", { Id: `SignatureValue${crypto.randomInt(100000, 999999)}` }, valor),
    keyInfo,
    el("ds:Object", { Id: `${idFirma}-Object${crypto.randomInt(100000, 999999)}` },
      el("etsi:QualifyingProperties", { Target: `#${idFirma}` }, propiedades)));

  return DECLARACION + serializar({ ...raiz, hijos: [...raiz.hijos, signature] });
}
