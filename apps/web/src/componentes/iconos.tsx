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
export const IMenu = (p: P) => <Icono {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Icono>;
export const ICamion = (p: P) => <Icono {...p}><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></Icono>;
export const IDocumento = (p: P) => <Icono {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></Icono>;
export const IUsuarios = (p: P) => <Icono {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2" /><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.9c1.6.7 2.6 2.4 3 5.1" /></Icono>;
export const IPiezas = (p: P) => <Icono {...p}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M17 14v6M14 17h6" /></Icono>;
export const IReloj = (p: P) => <Icono {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icono>;
export const IFactura = (p: P) => <Icono {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></Icono>;
export const IMesa = (p: P) => <Icono {...p}><path d="M3 9h18M5 9v11M19 9v11M8 9V5h8v4" /></Icono>;
export const IMoto = (p: P) => <Icono {...p}><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-2-6h-4M13 11l2-4h3M6 14l3-3" /></Icono>;
export const IOlla = (p: P) => <Icono {...p}><path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M2 10h20M9 6c0-1 1-2 1-3M14 6c0-1 1-2 1-3" /></Icono>;
export const IReceta = (p: P) => <Icono {...p}><path d="M6 3h12v18H6z" /><path d="M9 7h6M9 11h6M9 15h3" /></Icono>;
export const IEtiqueta = (p: P) => <Icono {...p}><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></Icono>;
export const IEscudo = (p: P) => <Icono {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></Icono>;
export const IGlobo = (p: P) => <Icono {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></Icono>;
