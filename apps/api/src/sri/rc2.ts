/**
 * Descifrado RC2-CBC (RFC 2268). Muchas firmas .p12 emitidas en Ecuador cifran los certificados
 * con "pbeWithSHA1And40BitRC2-CBC", que OpenSSL 3 ya no trae por defecto. Solo se usa para leer.
 */

// prettier-ignore
const PITABLE = Buffer.from(
  "d978f9c419ddb5ed28e9fd794aa0d89dc67e37832b76538e624c6488448bfba2" +
  "179a59f587b34f1361456d8d09817d32bd8f40eb86b77b0bf09521225c6b4e82" +
  "54d66593ce60b21c7356c014a78cf1dc1275ca1f3bbee4d1423dd430a33cb626" +
  "6fbf0eda4669075727f21d9bbc944303f811c7f690ef3ee706c3d52fc8661ed7" +
  "08e8eade8052eef784aa72ac354d6a2a961ad2715a1549744b9fd05e0418a4ec" +
  "c2e0416e0f51cbcc2491af50a1f47039997c3a8523b8b47afc02365b25559731" +
  "2d5dfa98e38a92ae05df2910676cbac9d300e6cfe19ea82c6316013f58e289a9" +
  "0d38341bab33ffb0bb480c5fb9b1cd2ec5f3db47e5a59c770aa62068fe7fc1ad", "hex");

function expandirClave(clave: Buffer, bitsEfectivos: number): Uint16Array {
  const L = new Uint8Array(128);
  const T = clave.length;
  L.set(clave);
  for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1]! + L[i - T]!) & 0xff]!;
  const T8 = Math.ceil(bitsEfectivos / 8);
  const TM = 0xff >> (8 * T8 - bitsEfectivos);
  L[128 - T8] = PITABLE[L[128 - T8]! & TM]!;
  for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1]! ^ L[i + T8]!]!;
  const K = new Uint16Array(64);
  for (let i = 0; i < 64; i++) K[i] = L[2 * i]! | (L[2 * i + 1]! << 8);
  return K;
}

const S = [1, 2, 3, 5];

function descifrarBloque(K: Uint16Array, bloque: Buffer, salida: Buffer, pos: number) {
  const R = [bloque.readUInt16LE(0), bloque.readUInt16LE(2), bloque.readUInt16LE(4), bloque.readUInt16LE(6)];
  let j = 63;
  const mezclar = () => {
    for (let i = 3; i >= 0; i--) {
      const s = S[i]!;
      R[i] = ((R[i]! >>> s) | (R[i]! << (16 - s))) & 0xffff;
      R[i] = (R[i]! - K[j]! - (R[(i + 3) % 4]! & R[(i + 2) % 4]!) - (~R[(i + 3) % 4]! & R[(i + 1) % 4]!)) & 0xffff;
      j--;
    }
  };
  const machacar = () => {
    for (let i = 3; i >= 0; i--) R[i] = (R[i]! - K[R[(i + 3) % 4]! & 63]!) & 0xffff;
  };
  for (let n = 0; n < 5; n++) mezclar();
  machacar();
  for (let n = 0; n < 6; n++) mezclar();
  machacar();
  for (let n = 0; n < 5; n++) mezclar();
  for (let i = 0; i < 4; i++) salida.writeUInt16LE(R[i]!, pos + 2 * i);
}

export function descifrarRc2Cbc(clave: Buffer, bitsEfectivos: number, iv: Buffer, datos: Buffer): Buffer {
  if (datos.length === 0 || datos.length % 8 !== 0) throw new Error("Datos RC2 de largo inválido");
  const K = expandirClave(clave, bitsEfectivos);
  const salida = Buffer.alloc(datos.length);
  let previo = iv;
  for (let p = 0; p < datos.length; p += 8) {
    const bloque = datos.subarray(p, p + 8);
    descifrarBloque(K, bloque, salida, p);
    for (let i = 0; i < 8; i++) salida[p + i] = salida[p + i]! ^ previo[i]!;
    previo = bloque;
  }
  const relleno = salida[salida.length - 1]!;
  if (relleno < 1 || relleno > 8) throw new Error("Relleno inválido");
  for (let i = 1; i <= relleno; i++) if (salida[salida.length - i] !== relleno) throw new Error("Relleno inválido");
  return salida.subarray(0, salida.length - relleno);
}

/** Solo para las pruebas: la tabla debe ser una permutación de 0..255. */
export const _pitable = PITABLE;
