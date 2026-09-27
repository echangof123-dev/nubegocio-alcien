/**
 * Abre una firma electrónica .p12 (PKCS#12) sin librerías externas.
 * Soporta los cifrados que usan las entidades de certificación de Ecuador:
 *   · PBES2 (PBKDF2 + AES) — .p12 recientes
 *   · pbeWithSHAAnd3-KeyTripleDES-CBC y pbeWithSHAAnd40BitRC2-CBC — .p12 "legacy"
 * y verifica la integridad (MAC), que es lo que detecta una contraseña equivocada.
 */
import crypto, { type KeyObject, X509Certificate } from "node:crypto";
import { parsear, hijo, octetos, oid, entero, explicito, type Nodo, ErrorAsn1 } from "./asn1.js";
import { descifrarRc2Cbc } from "./rc2.js";

export class ErrorFirma extends Error {}

export interface Firma {
  llave: KeyObject;
  certificado: X509Certificate;
  titular: string;
  emisor: string;
  serie: string;          // decimal
  desde: Date;
  vence: Date;
}

const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  certBag: "1.2.840.113549.1.12.10.1.3",
  x509: "1.2.840.113549.1.9.22.1",
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12",
};

const HASHES: Record<string, { nombre: string; bloque: number }> = {
  "1.3.14.3.2.26": { nombre: "sha1", bloque: 64 },
  "2.16.840.1.101.3.4.2.1": { nombre: "sha256", bloque: 64 },
  "2.16.840.1.101.3.4.2.2": { nombre: "sha384", bloque: 128 },
  "2.16.840.1.101.3.4.2.3": { nombre: "sha512", bloque: 128 },
  "2.16.840.1.101.3.4.2.4": { nombre: "sha224", bloque: 64 },
};

const PRF: Record<string, string> = {
  "1.2.840.113549.2.7": "sha1", "1.2.840.113549.2.8": "sha224", "1.2.840.113549.2.9": "sha256",
  "1.2.840.113549.2.10": "sha384", "1.2.840.113549.2.11": "sha512",
};

const CIFRADOS_PBES2: Record<string, { nombre: string; clave: number }> = {
  "2.16.840.1.101.3.4.1.2": { nombre: "aes-128-cbc", clave: 16 },
  "2.16.840.1.101.3.4.1.22": { nombre: "aes-192-cbc", clave: 24 },
  "2.16.840.1.101.3.4.1.42": { nombre: "aes-256-cbc", clave: 32 },
  "1.2.840.113549.3.7": { nombre: "des-ede3-cbc", clave: 24 },
};

// PBE de PKCS#12 (RFC 7292, apéndice C)
const PBE_P12: Record<string, { cifrado: "3des" | "rc2"; clave: number; bits?: number }> = {
  "1.2.840.113549.1.12.1.3": { cifrado: "3des", clave: 24 },
  "1.2.840.113549.1.12.1.4": { cifrado: "3des", clave: 16 },
  "1.2.840.113549.1.12.1.5": { cifrado: "rc2", clave: 16, bits: 128 },
  "1.2.840.113549.1.12.1.6": { cifrado: "rc2", clave: 5, bits: 40 },
};

/** Contraseña como BMPString (UTF-16BE) terminada en dos ceros, como pide PKCS#12. */
function claveBmp(clave: string): Buffer {
  const b = Buffer.alloc((clave.length + 1) * 2);
  for (let i = 0; i < clave.length; i++) b.writeUInt16BE(clave.charCodeAt(i), i * 2);
  return b;
}

/** Derivación de claves de PKCS#12 (RFC 7292, apéndice B.2). id: 1 clave, 2 IV, 3 MAC. */
export function derivarP12(hash: string, bloque: number, clave: Buffer, sal: Buffer, iteraciones: number, id: number, largo: number): Buffer {
  const v = bloque;
  const D = Buffer.alloc(v, id);
  const rellenar = (x: Buffer) => {
    if (x.length === 0) return Buffer.alloc(0);
    const n = v * Math.ceil(x.length / v);
    const r = Buffer.alloc(n);
    for (let i = 0; i < n; i++) r[i] = x[i % x.length]!;
    return r;
  };
  const I = Buffer.concat([rellenar(sal), rellenar(clave)]);
  const salida: Buffer[] = [];
  let total = 0;
  while (total < largo) {
    let A = crypto.createHash(hash).update(D).update(I).digest();
    for (let i = 1; i < iteraciones; i++) A = crypto.createHash(hash).update(A).digest();
    salida.push(A);
    total += A.length;
    if (total >= largo) break;
    const B = rellenar(A);
    for (let j = 0; j < I.length; j += v) {
      // I_j = (I_j + B + 1) mod 2^(v·8)
      let acarreo = 1;
      for (let k = v - 1; k >= 0; k--) {
        const s = I[j + k]! + B[k]! + acarreo;
        I[j + k] = s & 0xff;
        acarreo = s >> 8;
      }
    }
  }
  return Buffer.concat(salida).subarray(0, largo);
}

function descifrar(algoritmo: Nodo, datos: Buffer, clave: string): Buffer {
  const id = oid(hijo(algoritmo, 0));
  const params = hijo(algoritmo, 1, "los parámetros del cifrado");

  if (id === OID.pbes2) {
    const kdf = hijo(params, 0);
    const esquema = hijo(params, 1);
    if (oid(hijo(kdf, 0)) !== OID.pbkdf2) throw new ErrorFirma("Derivación de clave no soportada en la firma");
    const kp = hijo(kdf, 1);
    const sal = octetos(hijo(kp, 0));
    const iter = entero(hijo(kp, 1));
    let prf = "sha1";
    for (const x of kp.hijos.slice(2)) {
      if (x.tag === 0x30) {
        const p = PRF[oid(hijo(x, 0))];
        if (!p) throw new ErrorFirma("Función de derivación no soportada en la firma");
        prf = p;
      }
    }
    const c = CIFRADOS_PBES2[oid(hijo(esquema, 0))];
    if (!c) throw new ErrorFirma("Cifrado no soportado en la firma");
    const iv = octetos(hijo(esquema, 1));
    const k = crypto.pbkdf2Sync(Buffer.from(clave, "utf8"), sal, iter, c.clave, prf);
    const d = crypto.createDecipheriv(c.nombre, k, iv);
    return Buffer.concat([d.update(datos), d.final()]);
  }

  const pbe = PBE_P12[id];
  if (!pbe) throw new ErrorFirma(`Cifrado de la firma no soportado (${id})`);
  const sal = octetos(hijo(params, 0));
  const iter = entero(hijo(params, 1));
  const pw = claveBmp(clave);
  const k = derivarP12("sha1", 64, pw, sal, iter, 1, pbe.clave);
  const iv = derivarP12("sha1", 64, pw, sal, iter, 2, 8);
  if (pbe.cifrado === "rc2") return descifrarRc2Cbc(k, pbe.bits!, iv, datos);
  const k24 = pbe.clave === 16 ? Buffer.concat([k, k.subarray(0, 8)]) : k;   // 2-key 3DES
  const d = crypto.createDecipheriv("des-ede3-cbc", k24, iv);
  return Buffer.concat([d.update(datos), d.final()]);
}

function verificarMac(mac: Nodo, contenido: Buffer, clave: string) {
  const digestInfo = hijo(mac, 0);
  const h = HASHES[oid(hijo(hijo(digestInfo, 0), 0))];
  if (!h) throw new ErrorFirma("Algoritmo de integridad de la firma no soportado");
  const esperado = octetos(hijo(digestInfo, 1));
  const sal = octetos(hijo(mac, 1));
  const iter = mac.hijos[2] ? entero(mac.hijos[2]) : 1;
  const largo = crypto.createHash(h.nombre).digest().length;
  // Algunas herramientas usan contraseña vacía sin los dos ceros finales: se prueban ambas
  const candidatos = clave === "" ? [claveBmp(""), Buffer.alloc(0)] : [claveBmp(clave)];
  for (const pw of candidatos) {
    const k = derivarP12(h.nombre, h.bloque, pw, sal, iter, 3, largo);
    const calculado = crypto.createHmac(h.nombre, k).update(contenido).digest();
    if (calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado)) return;
  }
  throw new ErrorFirma("La contraseña de la firma no es correcta");
}

function textoDn(dn: string): string {
  // "C=EC\nO=...\nCN=..." → "CN=..., O=..., C=EC" (orden RFC 2253)
  return dn.split("\n").filter(Boolean).reverse().join(",");
}

function nombreCn(dn: string): string {
  const cn = dn.split("\n").find((l) => l.startsWith("CN="));
  return cn ? cn.slice(3) : dn.replace(/\n/g, ", ");
}

export function abrirP12(p12: Buffer, clave: string): Firma {
  let pfx: Nodo;
  try {
    pfx = parsear(p12);
  } catch (e) {
    if (e instanceof ErrorAsn1) throw new ErrorFirma("El archivo no es una firma .p12 válida");
    throw e;
  }

  try {
    const authSafe = hijo(pfx, 1, "el contenido");
    if (oid(hijo(authSafe, 0)) !== OID.data) throw new ErrorFirma("Firma .p12 con formato no soportado");
    const contenido = octetos(explicito(hijo(authSafe, 1)));
    if (pfx.hijos[2]) verificarMac(pfx.hijos[2], contenido, clave);

    const llaves: KeyObject[] = [];
    const certificados: X509Certificate[] = [];

    const leerBolsas = (safeContents: Nodo) => {
      for (const bolsa of safeContents.hijos) {
        const tipo = oid(hijo(bolsa, 0));
        const valor = explicito(hijo(bolsa, 1));
        if (tipo === OID.shroudedKeyBag) {
          const der = descifrar(hijo(valor, 0), octetos(hijo(valor, 1)), clave);
          llaves.push(crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
        } else if (tipo === OID.keyBag) {
          llaves.push(crypto.createPrivateKey({ key: Buffer.concat([Buffer.from([valor.tag]), encabezadoLargo(valor.valor.length), valor.valor]), format: "der", type: "pkcs8" }));
        } else if (tipo === OID.certBag && oid(hijo(valor, 0)) === OID.x509) {
          certificados.push(new X509Certificate(octetos(explicito(hijo(valor, 1)))));
        }
      }
    };

    for (const info of parsear(contenido).hijos) {
      const tipo = oid(hijo(info, 0));
      if (tipo === OID.data) {
        leerBolsas(parsear(octetos(explicito(hijo(info, 1)))));
      } else if (tipo === OID.encryptedData) {
        const encInfo = hijo(explicito(hijo(info, 1)), 1);
        const cifrado = encInfo.hijos[2];
        if (!cifrado) continue;
        leerBolsas(parsear(descifrar(hijo(encInfo, 1), octetos(cifrado), clave)));
      }
    }

    if (!llaves.length) throw new ErrorFirma("La firma no trae la llave privada");
    // El certificado de firma es el que corresponde a una llave y no es de una autoridad
    const pares = certificados.flatMap((c) => llaves.filter((k) => c.checkPrivateKey(k)).map((k) => ({ c, k })));
    if (!pares.length) throw new ErrorFirma("La firma no trae el certificado de la llave");
    pares.sort((a, b) => Number(a.c.ca) - Number(b.c.ca) || Date.parse(b.c.validTo) - Date.parse(a.c.validTo));
    const { c, k } = pares[0]!;
    if (k.asymmetricKeyType !== "rsa") throw new ErrorFirma("El SRI solo acepta firmas con llave RSA");

    return {
      llave: k,
      certificado: c,
      titular: nombreCn(c.subject),
      emisor: nombreCn(c.issuer),
      serie: BigInt("0x" + c.serialNumber).toString(10),
      desde: new Date(c.validFrom),
      vence: new Date(c.validTo),
    };
  } catch (e) {
    if (e instanceof ErrorFirma) throw e;
    // Un descifrado fallido casi siempre es la contraseña (si el archivo no trae MAC)
    if (e instanceof Error && /bad decrypt|Relleno|wrong final block/i.test(e.message)) {
      throw new ErrorFirma("La contraseña de la firma no es correcta");
    }
    throw new ErrorFirma("No se pudo leer la firma .p12");
  }
}

function encabezadoLargo(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Nombre del emisor en el formato que se pone en la firma XAdES (X509IssuerName). */
export function emisorRfc2253(c: X509Certificate): string {
  return textoDn(c.issuer);
}
