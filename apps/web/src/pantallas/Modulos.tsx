import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { INCLUIDOS, PANTALLAS, tienePantalla } from "../modulos";
import { Aviso, Cargando } from "../componentes/basicos";
import { IVolver } from "../componentes/iconos";

interface ModuloCat {
  modulo: string; nombre: string; descripcion: string; fase: number;
  estado: "activo" | "bloqueado" | "disponible"; plan_requerido: string | null; en_familia: boolean; nucleo: boolean;
}

const PLANES: Record<string, string> = { gratis: "Gratis", emprendedor: "Emprendedor", negocio: "Negocio", pro: "Pro" };

export function Modulos({ info, avisar, navegar, alCambiar }: {
  info: InfoNegocio; avisar: (t: string) => void; navegar: (r: string) => void; alCambiar: () => void;
}) {
  const [modulos, setModulos] = useState<ModuloCat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<{ modulos: ModuloCat[] }>("GET", "/modulos").then((r) => setModulos(r.modulos)).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(cargar, [cargar]);

  async function cambiar(m: ModuloCat, activo: boolean) {
    setOcupado(m.modulo);
    setError(null);
    try {
      await api("POST", `/negocio/modulos/${m.modulo}`, { activo });
      avisar(activo ? `${m.nombre} activado` : `${m.nombre} desactivado`);
      cargar();
      alCambiar();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setOcupado(null);
    }
  }

  if (!modulos) return error ? <div className="contenido"><Aviso tipo="error">{error}</Aviso></div> : <Cargando />;

  const grupo = (titulo: string, lista: ModuloCat[]) => lista.length > 0 && (
    <div className="tarjeta" style={{ padding: "12px 16px" }}>
      <h3>{titulo}</h3>
      {lista.map((m) => {
        const pantalla = PANTALLAS.find((p) => p.modulo.split("|").includes(m.modulo));
        const encendido = m.estado !== "disponible";
        return (
          <div key={m.modulo} className="comprobante-fila">
            <div className="textos">
              <strong>{m.nombre}</strong>
              <span>{m.descripcion}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {m.estado === "activo" && <span className="insignia ok">Activo</span>}
                {m.estado === "bloqueado" && <span className="insignia no">Necesita plan {PLANES[m.plan_requerido ?? ""] ?? "superior"}</span>}
                {!tienePantalla(m.modulo) && <span className="insignia gris">Pronto</span>}
                {INCLUIDOS[m.modulo] && encendido && <span className="insignia gris">{INCLUIDOS[m.modulo]}</span>}
              </span>
            </div>
            <span style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              {pantalla && m.estado === "activo" && (
                <button className="boton texto pequeno" onClick={() => navegar(pantalla.ruta)}>Abrir</button>
              )}
              {gestiona && !m.nucleo && (
                <button className={`boton pequeno ${encendido ? "secundario" : ""}`} disabled={ocupado === m.modulo}
                  onClick={() => cambiar(m, !encendido)}>{encendido ? "Desactivar" : "Activar"}</button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <div className="fila" style={{ justifyContent: "flex-start" }}>
        <button className="icono-boton" aria-label="Volver" onClick={() => navegar("/mas")}><IVolver /></button>
        <h1>Módulos</h1>
      </div>
      <p className="muted">Tu negocio se armó con los módulos de «{info.negocio.familia_nombre}». Puedes activar otros cuando los necesites.</p>
      {info.negocio.suscripcion === "prueba" && (
        <Aviso tipo="info">Durante la prueba gratis tienes todos los módulos. Al terminar, se quedan los de tu plan.</Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {grupo("De tu negocio", modulos.filter((m) => m.en_familia || m.nucleo))}
      {grupo("Otros módulos", modulos.filter((m) => !m.en_familia && !m.nucleo))}
    </div>
  );
}
