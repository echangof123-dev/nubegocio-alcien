import { useEffect, useRef, type ReactNode } from "react";
import { ICerrar } from "./iconos";

export function Dialogo({ titulo, alCerrar, children }: { titulo: string; alCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  // Solo al abrir: enfocar el primer campo, cerrar con Escape y devolver el foco al salir
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button:not(.cerrar-dialogo)")?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar.current(); };
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("keydown", tecla); previo?.focus(); };
  }, []);

  return (
    <div className="fondo-dialogo" onClick={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <div className="fila">
          <h2>{titulo}</h2>
          <button className="icono-boton cerrar-dialogo" onClick={alCerrar} aria-label="Cerrar"><ICerrar /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Aviso({ tipo, titulo, children }: { tipo: "info" | "atencion" | "exito" | "error"; titulo?: string; children?: ReactNode }) {
  return (
    <div className={`aviso ${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      <div>
        {titulo && <strong>{titulo}</strong>}
        {titulo && children ? <br /> : null}
        {children}
      </div>
    </div>
  );
}

export function Toast({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <div className="toast" role="status">{texto}</div>;
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return <div className="cargando">{texto}</div>;
}

/** Campo de dinero: acepta coma o punto y muestra el teclado numérico en el celular. */
export function CampoMonto({ id, etiqueta, valor, alCambiar, grande }: {
  id: string; etiqueta: string; valor: string; alCambiar: (v: string) => void; grande?: boolean;
}) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} className={`entrada${grande ? " grande" : ""}`} inputMode="decimal" autoComplete="off"
        placeholder="0,00" value={valor} onChange={(e) => alCambiar(e.target.value.replace(/[^\d.,]/g, ""))} />
    </div>
  );
}
