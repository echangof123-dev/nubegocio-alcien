import type { ReactElement } from "react";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { pantallasActivas } from "../modulos";
import { ICamion, IDocumento, IFactura, IFiados, IMesa, IMoto, IOlla, IPiezas, IReceta, IReloj, IUsuarios, IEtiqueta, IEscudo, IGlobo, ICalendario, ILlave, ICama, ICarnet, IBalanza, IGrafico, ICaja, IProductos, IReportes, IChat } from "../componentes/iconos";

const ICONOS: Record<string, (p: { tam?: number }) => ReactElement> = {
  "/asistente": IChat, "/deudas": IFiados, "/clientes": IUsuarios, "/gastos": ICaja, "/inventario": IProductos, "/reportes": IReportes, "/ajustes": IPiezas,
  M25: IBalanza, M21: IGrafico, M11: ICalendario, M13: ILlave, M26: ICama, M22: ICarnet, "M11|M12|M13": IUsuarios, M17: IEtiqueta, M23: IEscudo, M18: IGlobo, M09: IMesa, M10: IMoto, "M09|M10": IOlla, M08: IReceta, M14: IFiados, M15: ICamion, M16: IReloj, M24: IDocumento, M19: IFactura, M20: IUsuarios,
};

export function Mas({ info, navegar }: { info: InfoNegocio; navegar: (r: string) => void }) {
  const pantallas = pantallasActivas(info);
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <h1>Más</h1>
      <div className="rejilla-mas">
        {pantallas.map((p) => {
          const Icono = ICONOS[p.ruta] ?? ICONOS[p.modulo] ?? IPiezas;
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
