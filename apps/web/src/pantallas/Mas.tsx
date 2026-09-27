import type { ReactElement } from "react";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { pantallasActivas } from "../modulos";
import { ICamion, IDocumento, IFactura, IFiados, IPiezas, IReloj, IUsuarios } from "../componentes/iconos";

const ICONOS: Record<string, (p: { tam?: number }) => ReactElement> = {
  M14: IFiados, M15: ICamion, M16: IReloj, M24: IDocumento, M19: IFactura, M20: IUsuarios,
};

export function Mas({ info, navegar }: { info: InfoNegocio; navegar: (r: string) => void }) {
  const pantallas = pantallasActivas(info);
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Más</h1>
      <div className="rejilla-mas">
        {pantallas.map((p) => {
          const Icono = ICONOS[p.modulo] ?? IPiezas;
          return (
            <button key={p.ruta} className="tile" onClick={() => navegar(p.ruta)}>
              <span className="tile-icono"><Icono tam={26} /></span>
              <strong>{p.nombre}</strong>
              <span>{p.descripcion}</span>
            </button>
          );
        })}
        <button className="tile" onClick={() => navegar("/modulos")}>
          <span className="tile-icono"><IPiezas tam={26} /></span>
          <strong>Módulos</strong>
          <span>{puedeGestionar(info.rol) ? "Activa lo que tu negocio necesita" : "Lo que tiene tu negocio"}</span>
        </button>
      </div>
    </div>
  );
}
