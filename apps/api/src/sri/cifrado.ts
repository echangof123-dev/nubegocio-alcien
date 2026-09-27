/**
 * Cifrado de la firma electrónica y su contraseña antes de guardarlas en la base.
 * AES-256-GCM con la clave ALCIEN_CLAVE_FIRMAS (Secret Manager). El id del negocio va como
 * dato autenticado: una firma copiada a otro negocio no se puede descifrar.
 */
import crypto from "node:crypto";

const VERSION = 1;

export function cifrar(clave: Buffer, negocioId: string, datos: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave, iv);
  c.setAAD(Buffer.from(negocioId));
  const ct = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), ct]);
}

export function descifrar(clave: Buffer, negocioId: string, sobre: Buffer): Buffer {
  if (sobre[0] !== VERSION || sobre.length < 29) throw new Error("Formato de firma guardada desconocido");
  const d = crypto.createDecipheriv("aes-256-gcm", clave, sobre.subarray(1, 13));
  d.setAAD(Buffer.from(negocioId));
  d.setAuthTag(sobre.subarray(13, 29));
  return Buffer.concat([d.update(sobre.subarray(29)), d.final()]);
}
