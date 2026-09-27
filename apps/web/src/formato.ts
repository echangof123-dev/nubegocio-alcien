/** Formatos de Ecuador: $ 1.234,50 · 26/09/2026 */

export function dinero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const negativo = n < 0;
  const [entero, dec] = Math.abs(n).toFixed(2).split(".");
  const miles = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "− " : ""}$ ${miles},${dec}`;
}

export function cantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(".", ",");
}

/** Acepta "1,35", "1.35" y "$ 1,35". Devuelve null si no es un número válido. */
export function parsearNumero(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "");
  if (!limpio) return null;
  // Si trae coma, la coma es el decimal y los puntos son miles
  const normal = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export const redondear = (n: number) => Math.round(n * 100) / 100;

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

export function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
}
