import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TiendaPublica } from "./pantallas/TiendaPublica";
import "./estilos.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    {/* El catálogo en línea (/t/nombre) lo abren clientes sin cuenta */}
    {location.pathname.startsWith("/t/") ? <TiendaPublica slug={decodeURIComponent(location.pathname.slice(3))} /> : <App />}
  </StrictMode>,
);

// La app se puede instalar y abre aunque la señal esté mala
if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
