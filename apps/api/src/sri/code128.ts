/** Código de barras Code 128 (juego C para dígitos) de la clave de acceso, en SVG. */

// Anchos de barra/espacio de los 107 símbolos (0–105 y el de parada)
// prettier-ignore
const PATRONES = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

const INICIO_C = 105;
const CAMBIO_B = 100;
const PARADA = 106;

/** Valores Code 128 para una cadena de dígitos: pares en juego C y, si sobra uno, juego B. */
export function valoresCode128(digitos: string): number[] {
  if (!/^[0-9]+$/.test(digitos)) throw new Error("Solo dígitos");
  const v = [INICIO_C];
  let i = 0;
  for (; i + 1 < digitos.length; i += 2) v.push(Number(digitos.slice(i, i + 2)));
  if (i < digitos.length) v.push(CAMBIO_B, digitos.charCodeAt(i) - 32);
  let suma = v[0]!;
  for (let k = 1; k < v.length; k++) suma += v[k]! * k;
  v.push(suma % 103, PARADA);
  return v;
}

export function svgCode128(digitos: string, alto = 48): string {
  const modulos: number[] = [];
  for (const v of valoresCode128(digitos)) for (const c of PATRONES[v]!) modulos.push(Number(c));
  const margen = 10;
  const ancho = modulos.reduce((a, b) => a + b, 0) + margen * 2;
  let x = margen;
  let barras = "";
  modulos.forEach((m, i) => {
    if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${m}" height="${alto}"/>`;
    x += m;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none" role="img" aria-label="Código de barras de la clave de acceso">${barras}</svg>`;
}

export const _patrones = PATRONES;
