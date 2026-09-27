import { useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Sesion } from "../tipos";
import { Aviso } from "../componentes/basicos";
import { IVolver } from "../componentes/iconos";

interface RespuestaCodigo { celular: string; codigoDev?: string }

export function Acceso({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
  const [paso, setPaso] = useState<"celular" | "codigo">("celular");
  const [celular, setCelular] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoDev, setCodigoDev] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const r = await api<RespuestaCodigo>("POST", "/auth/codigo", { celular });
      setCodigoDev(r.codigoDev ?? null);
      setCodigo("");
      setPaso("codigo");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  async function verificar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const r = await api<Sesion>("POST", "/auth/verificar", { celular, codigo });
      alEntrar(r);
    } catch (err) {
      setError(mensajeDe(err));
      setOcupado(false);
    }
  }

  return (
    <main className="pagina-simple">
      {paso === "celular" ? (
        <form onSubmit={pedirCodigo} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <img src="/iconos/alcien-logo-horizontal.svg" alt="Al Cien" style={{ width: 180, height: "auto", marginTop: 24 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1>Tu negocio al cien</h1>
            <p className="muted">Vende, cobra y cuadra tu caja desde el celular. Entra con tu número: te enviamos un código por WhatsApp.</p>
          </div>
          <div className="campo">
            <label htmlFor="celular">Tu número de celular</label>
            <input id="celular" className="entrada grande" type="tel" inputMode="tel" autoComplete="tel"
              placeholder="099 123 4567" value={celular} onChange={(e) => setCelular(e.target.value)} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={ocupado || celular.replace(/\D/g, "").length < 9}>
            {ocupado ? "Enviando…" : "Enviar código por WhatsApp"}
          </button>
          <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>No necesitas contraseña. Si es tu primera vez, creamos tu cuenta.</p>
        </form>
      ) : (
        <form onSubmit={verificar} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <button type="button" className="icono-boton" aria-label="Cambiar número" onClick={() => { setPaso("celular"); setError(null); }}>
            <IVolver />
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1>Escribe el código</h1>
            <p className="muted">Te lo enviamos por WhatsApp al {celular}. Vence en 5 minutos.</p>
          </div>
          {codigoDev && <Aviso tipo="atencion" titulo="Modo de prueba">Tu código es {codigoDev}. En producción llega por WhatsApp.</Aviso>}
          <div className="campo">
            <label htmlFor="codigo">Código de 6 dígitos</label>
            <input id="codigo" className="entrada codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={ocupado || codigo.length !== 6}>{ocupado ? "Entrando…" : "Entrar"}</button>
          <button type="button" className="boton texto" onClick={() => pedirCodigo()} disabled={ocupado}>Enviarme otro código</button>
        </form>
      )}
    </main>
  );
}
