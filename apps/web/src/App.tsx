import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErrorApi, mensajeDe, negocioGuardado, usarNegocio } from "./api";
import type { InfoNegocio, LineaCarrito, NegocioResumen, Sesion } from "./tipos";
import { Aviso, Cargando, Toast } from "./componentes/basicos";
import { ICaja, IFiados, IProductos, IReportes, ITienda } from "./componentes/iconos";
import { Acceso } from "./pantallas/Acceso";
import { Registro } from "./pantallas/Registro";
import { Vender } from "./pantallas/Vender";
import { Cobrar } from "./pantallas/Cobrar";
import { Caja } from "./pantallas/Caja";
import { Productos } from "./pantallas/Productos";
import { Fiados } from "./pantallas/Fiados";
import { Reportes } from "./pantallas/Reportes";

function useRuta(): [string, (r: string) => void] {
  const [ruta, setRuta] = useState(location.pathname);
  useEffect(() => {
    const alVolver = () => setRuta(location.pathname);
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);
  const navegar = useCallback((r: string) => {
    if (r !== location.pathname) history.pushState(null, "", r);
    setRuta(r);
    window.scrollTo(0, 0);
  }, []);
  return [ruta, navegar];
}

const NAV = [
  { ruta: "/", nombre: "Vender", Icono: ITienda },
  { ruta: "/productos", nombre: "Productos", Icono: IProductos },
  { ruta: "/fiados", nombre: "Fiados", Icono: IFiados },
  { ruta: "/caja", nombre: "Caja", Icono: ICaja },
  { ruta: "/reportes", nombre: "Reportes", Icono: IReportes },
];

export function App() {
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);
  const [negocioId, setNegocioId] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoNegocio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carrito, setCarritoEstado] = useState<LineaCarrito[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [ruta, navegar] = useRuta();
  const temporizador = useRef<number | undefined>(undefined);

  const avisar = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const setCarrito = useCallback((f: (c: LineaCarrito[]) => LineaCarrito[]) => setCarritoEstado(f), []);

  const elegir = useCallback((negocios: NegocioResumen[], preferido?: string | null) => {
    const guardado = preferido ?? negocioGuardado();
    const id = negocios.find((n) => n.negocio_id === guardado)?.negocio_id ?? negocios[0]?.negocio_id ?? null;
    usarNegocio(id);
    setNegocioId(id);
  }, []);

  // Al abrir: ¿hay sesión?
  useEffect(() => {
    api<Sesion>("GET", "/yo")
      .then((s) => { setSesion(s); elegir(s.negocios); })
      .catch((e) => {
        if (e instanceof ErrorApi && e.status === 401) setSesion(null);
        else setError(mensajeDe(e));
      });
  }, [elegir]);

  // Datos del negocio elegido
  useEffect(() => {
    if (!negocioId) { setInfo(null); return; }
    setInfo(null);
    api<InfoNegocio>("GET", "/negocio")
      .then(setInfo)
      .catch((e) => {
        if (e instanceof ErrorApi && e.status === 403) { usarNegocio(null); setNegocioId(null); }
        else setError(mensajeDe(e));
      });
  }, [negocioId]);

  async function salir() {
    await api("POST", "/auth/salir").catch(() => {});
    usarNegocio(null);
    setCarritoEstado([]);
    setSesion(null);
    setNegocioId(null);
    navegar("/");
  }

  if (error) return <main className="pagina-simple"><Aviso tipo="error" titulo="No pudimos abrir Al Cien">{error}</Aviso><button className="boton" onClick={() => location.reload()}>Intentar de nuevo</button></main>;
  if (sesion === undefined) return <Cargando />;

  if (sesion === null) {
    return <Acceso alEntrar={(s) => { setSesion(s); elegir(s.negocios); navegar("/"); }} />;
  }

  if (sesion.negocios.length === 0 || ruta === "/nuevo-negocio") {
    return (
      <Registro
        alVolver={sesion.negocios.length > 0 ? () => navegar("/reportes") : undefined}
        alCrear={async (id) => {
          const s = await api<Sesion>("GET", "/yo");
          setSesion(s);
          elegir(s.negocios, id);
          navegar("/");
          avisar("¡Listo! Tu negocio está armado.");
        }} />
    );
  }

  if (!info) return <Cargando />;

  const conNav = ruta !== "/cobrar";
  let pantalla;
  switch (ruta) {
    case "/cobrar": pantalla = <Cobrar info={info} carrito={carrito} setCarrito={setCarrito} navegar={navegar} />; break;
    case "/caja": pantalla = <Caja info={info} avisar={avisar} />; break;
    case "/productos": pantalla = <Productos info={info} avisar={avisar} />; break;
    case "/fiados": pantalla = <Fiados avisar={avisar} />; break;
    case "/reportes":
      pantalla = <Reportes info={info} avisar={avisar} alSalir={salir}
        alCambiarNegocio={sesion.negocios.length > 1 ? () => {
          const i = sesion.negocios.findIndex((n) => n.negocio_id === negocioId);
          const siguiente = sesion.negocios[(i + 1) % sesion.negocios.length]!;
          setCarritoEstado([]);
          elegir(sesion.negocios, siguiente.negocio_id);
          navegar("/");
        } : undefined} />;
      break;
    default: pantalla = <Vender info={info} carrito={carrito} setCarrito={setCarrito} navegar={navegar} avisar={avisar} />;
  }

  return (
    <div className="app">
      {conNav && (
        <header className="cabecera">
          <img className="logo-mini" src="/iconos/alcien-simbolo.svg" alt="" />
          <div className="titulo">
            <strong>{info.negocio.nombre}</strong>
            <span>{info.negocio.tipo}</span>
          </div>
        </header>
      )}
      {pantalla}
      {conNav && (
        <nav className="nav-inferior" aria-label="Menú principal">
          {NAV.map(({ ruta: r, nombre, Icono }) => (
            <a key={r} href={r} className={ruta === r ? "activo" : ""} aria-current={ruta === r ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); navegar(r); }}>
              <Icono tam={22} />{nombre}
            </a>
          ))}
        </nav>
      )}
      <Toast texto={toast} />
    </div>
  );
}
