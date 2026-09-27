/** Íconos de línea (2 px, extremos redondeados) al estilo de la marca. */
import type { ReactNode } from "react";

function Icono({ children, tam = 22, etiqueta }: { children: ReactNode; tam?: number; etiqueta?: string }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={etiqueta ? undefined : true}
      role={etiqueta ? "img" : undefined} aria-label={etiqueta}>
      {children}
    </svg>
  );
}

type P = { tam?: number; etiqueta?: string };

export const ITienda = (p: P) => <Icono {...p}><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /></Icono>;
export const IProductos = (p: P) => <Icono {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></Icono>;
export const IFiados = (p: P) => <Icono {...p}><path d="M4 4h12a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-2 1V4z" /><path d="M8 9h6M8 13h4" /></Icono>;
export const ICaja = (p: P) => <Icono {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 11h18M8 4h8" /></Icono>;
export const IReportes = (p: P) => <Icono {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></Icono>;
export const IBuscar = (p: P) => <Icono {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icono>;
export const IEscanear = (p: P) => <Icono {...p}><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M8 8v8M11 8v8M14 8v8M17 8v8" /></Icono>;
export const IVolver = (p: P) => <Icono {...p}><path d="M15 18l-6-6 6-6" /></Icono>;
export const ICheck = (p: P) => <Icono {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icono>;
export const ICheckCirculo = (p: P) => <Icono {...p}><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.5 2.5L16 9.5" /></Icono>;
export const IMas = (p: P) => <Icono {...p}><path d="M12 5v14M5 12h14" /></Icono>;
export const IMenos = (p: P) => <Icono {...p}><path d="M5 12h14" /></Icono>;
export const ICerrar = (p: P) => <Icono {...p}><path d="M6 6l12 12M18 6L6 18" /></Icono>;
export const IAlerta = (p: P) => <Icono {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5v.5" /></Icono>;
export const IChispa = (p: P) => <Icono {...p}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></Icono>;
export const ISalir = (p: P) => <Icono {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></Icono>;
export const IBasura = (p: P) => <Icono {...p}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></Icono>;
