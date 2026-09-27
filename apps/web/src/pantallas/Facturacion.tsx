import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Comprobante, ConfigSri, EstadoSri as TEstadoSri, InfoNegocio } from "../tipos";
import { puedeGestionar } from "../tipos";
import { dinero, fecha } from "../formato";
import { Aviso, Cargando } from "../componentes/basicos";
import { IVolver } from "../componentes/iconos";
import { EstadoSri, enlaceRide, enlaceWhatsApp } from "../componentes/comprobante";

type Props = { info: InfoNegocio; avisar: (t: string) => void; navegar: (r: string) => void };

export function Facturacion({ info, avisar, navegar }: Props) {
  const [estado, setEstado] = useState<TEstadoSri | null>(null);
  const [editar, setEditar] = useState(false);
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gestiona = puedeGestionar(info.rol);

  const cargar = useCallback(() => {
    api<TEstadoSri>("GET", "/sri/config").then((e) => { setEstado(e); if (!e.config) setEditar(true); }).catch((e) => setError(mensajeDe(e)));
    api<{ comprobantes: Comprobante[] }>("GET", "/comprobantes").then((r) => setComprobantes(r.comprobantes)).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  if (error) return <div className="contenido"><Aviso tipo="error">{error}</Aviso></div>;
  if (!estado) return <Cargando />;

  const cfg = estado.config;
  return (
    <div className="contenido" style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <div className="fila" style={{ justifyContent: "flex-start" }}>
        <button className="icono-boton" aria-label="Volver" onClick={() => navegar("/reportes")}><IVolver /></button>
        <h1>Facturación electrónica</h1>
      </div>

      {!estado.plan_incluye && (
        <Aviso tipo="atencion" titulo="Tu plan no incluye facturación">Las facturas electrónicas vienen en el plan Negocio y el plan Pro.</Aviso>
      )}

      {cfg && !editar ? (
        <div className="tarjeta">
          <div className="fila">
            <h3>{cfg.nombre_comercial || cfg.razon_social}</h3>
            <span className={`insignia ${cfg.ambiente === 2 ? "ok" : "no"}`}>{cfg.ambiente === 2 ? "Producción" : "Pruebas"}</span>
          </div>
          <p className="muted">RUC {cfg.ruc} · Punto de emisión {cfg.estab}-{cfg.pto_emi} · Siguiente factura N.º {cfg.siguiente_factura ?? 1}</p>
          {cfg.tiene_firma ? (
            <p className="muted">Firma de {cfg.firma_titular}, vence el {cfg.firma_vence ? fecha(cfg.firma_vence) : "—"}</p>
          ) : (
            <Aviso tipo="atencion">Falta subir tu firma electrónica (.p12).</Aviso>
          )}
          {cfg.ambiente === 1 && cfg.tiene_firma && (
            <Aviso tipo="info">Estás en ambiente de pruebas: las facturas no tienen validez tributaria. Cuando el SRI te habilite, cambia a producción.</Aviso>
          )}
          {gestiona && <button className="boton secundario pequeno" onClick={() => setEditar(true)}>Cambiar datos o firma</button>}
        </div>
      ) : gestiona ? (
        <FormularioSri cfg={cfg} alGuardar={() => { setEditar(false); avisar("Facturación guardada"); cargar(); }}
          alCancelar={cfg ? () => setEditar(false) : undefined} />
      ) : (
        <Aviso tipo="info">El dueño del negocio debe configurar la facturación.</Aviso>
      )}

      <div className="tarjeta" style={{ padding: "12px 16px" }}>
        <h3>Comprobantes</h3>
        {comprobantes.map((c) => (
          <FilaComprobante key={c.id} c={c} negocio={info.negocio.nombre} gestiona={gestiona}
            alCambiar={(t) => { if (t) avisar(t); cargar(); }} />
        ))}
        {comprobantes.length === 0 && <p className="muted">Todavía no emites comprobantes.</p>}
      </div>
    </div>
  );
}

function FilaComprobante({ c, negocio, gestiona, alCambiar }: {
  c: Comprobante; negocio: string; gestiona: boolean; alCambiar: (aviso?: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accion(ruta: string, aviso: string) {
    setOcupado(true);
    setError(null);
    try { await api("POST", ruta); alCambiar(aviso); } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(false); }
  }

  const pendiente = c.estado === "firmado" || c.estado === "recibido";
  const conProblema = c.estado === "devuelto" || c.estado === "no_autorizado";
  const mensaje = c.mensajes.find((m) => m.mensaje)?.mensaje;
  const detalle = c.mensajes.find((m) => m.informacionAdicional)?.informacionAdicional;

  return (
    <div className="comprobante-fila">
      <div className="textos">
        <strong>{c.tipo === "factura" ? "Factura" : "Nota de crédito"} {c.numero}</strong>
        <span>{fecha(c.creado_en)} · Venta N.º {c.venta_numero} · {c.comprador.razon_social}</span>
        {(pendiente || conProblema) && mensaje && <span className="mensaje-sri">{mensaje}{detalle ? `: ${detalle}` : ""}</span>}
        {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
        <div className="acciones-fila" style={{ marginTop: 6 }}>
          {c.estado !== "anulado" && <a className="boton texto pequeno" href={enlaceRide(c)} target="_blank" rel="noopener">Ver</a>}
          {c.estado === "autorizado" && (
            <a className="boton texto pequeno" href={enlaceWhatsApp(c, negocio)} target="_blank" rel="noopener">WhatsApp</a>
          )}
          {pendiente && (
            <button className="boton texto pequeno" disabled={ocupado} onClick={() => accion(`/comprobantes/${c.id}/enviar`, "Enviado al SRI")}>
              {ocupado ? "Enviando…" : "Enviar ahora"}
            </button>
          )}
          {conProblema && c.tipo === "factura" && gestiona && (
            <button className="boton texto pequeno" disabled={ocupado} onClick={() => accion(`/comprobantes/${c.id}/reemitir`, "Factura emitida de nuevo")}>
              Emitir de nuevo
            </button>
          )}
        </div>
      </div>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <strong className={c.estado === "anulado" ? "anulada" : ""}>{dinero(c.total)}</strong>
        <EstadoSri estado={c.estado} tipo={c.tipo} />
      </span>
    </div>
  );
}

function leerArchivo(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => mal(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(f);
  });
}

function FormularioSri({ cfg, alGuardar, alCancelar }: { cfg: ConfigSri | null; alGuardar: () => void; alCancelar?: () => void }) {
  const [d, setD] = useState({
    ruc: cfg?.ruc ?? "",
    razon_social: cfg?.razon_social ?? "",
    nombre_comercial: cfg?.nombre_comercial ?? "",
    dir_matriz: cfg?.dir_matriz ?? "",
    dir_establecimiento: cfg?.dir_establecimiento ?? "",
    estab: cfg?.estab ?? "001",
    pto_emi: cfg?.pto_emi ?? "001",
    regimen: cfg?.regimen ?? "rimpe_emprendedor",
    obligado_contabilidad: cfg?.obligado_contabilidad ?? false,
    contribuyente_especial: cfg?.contribuyente_especial ?? "",
    agente_retencion: cfg?.agente_retencion ?? "",
    ambiente: String(cfg?.ambiente ?? 1),
    siguiente_factura: "",
  });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cambiar = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cfg?.tiene_firma && !archivo) { setError("Elige tu archivo de firma electrónica (.p12)."); return; }
    if (archivo && !clave) { setError("Escribe la contraseña de la firma."); return; }
    if (d.ambiente === "2" && cfg?.ambiente !== 2 &&
        !confirm("En producción cada factura tiene validez tributaria. ¿El SRI ya te habilitó para emitir en producción?")) return;
    setOcupado(true);
    try {
      await api("POST", "/sri/config", {
        ...d,
        ambiente: Number(d.ambiente),
        dir_establecimiento: d.dir_establecimiento || d.dir_matriz,
        siguiente_factura: d.siguiente_factura || undefined,
      });
      if (archivo) await api("POST", "/sri/firma", { archivo: await leerArchivo(archivo), clave });
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="tarjeta" onSubmit={guardar}>
      <h3>Datos del SRI</h3>
      <p className="muted">Tal como aparecen en tu RUC. Salen en cada factura.</p>
      <div className="rejilla-2">
        <div className="campo"><label htmlFor="sri-ruc">RUC</label>
          <input id="sri-ruc" className="entrada" inputMode="numeric" maxLength={13} value={d.ruc} onChange={cambiar("ruc")} required /></div>
        <div className="campo"><label htmlFor="sri-regimen">Régimen</label>
          <select id="sri-regimen" className="entrada" value={d.regimen} onChange={cambiar("regimen")}>
            <option value="rimpe_emprendedor">RIMPE Emprendedor</option>
            <option value="rimpe_popular">RIMPE Negocio popular</option>
            <option value="general">Régimen general</option>
          </select></div>
      </div>
      <div className="campo"><label htmlFor="sri-razon">Razón social o nombres completos</label>
        <input id="sri-razon" className="entrada" maxLength={300} value={d.razon_social} onChange={cambiar("razon_social")} required /></div>
      <div className="campo"><label htmlFor="sri-comercial">Nombre comercial (opcional)</label>
        <input id="sri-comercial" className="entrada" maxLength={300} value={d.nombre_comercial} onChange={cambiar("nombre_comercial")} /></div>
      <div className="campo"><label htmlFor="sri-matriz">Dirección matriz</label>
        <input id="sri-matriz" className="entrada" maxLength={300} value={d.dir_matriz} onChange={cambiar("dir_matriz")} required /></div>
      <div className="campo"><label htmlFor="sri-local">Dirección del local (si es distinta)</label>
        <input id="sri-local" className="entrada" maxLength={300} value={d.dir_establecimiento} onChange={cambiar("dir_establecimiento")} /></div>
      <div className="rejilla-2">
        <div className="campo"><label htmlFor="sri-estab">Establecimiento</label>
          <input id="sri-estab" className="entrada" inputMode="numeric" maxLength={3} value={d.estab} onChange={cambiar("estab")} /></div>
        <div className="campo"><label htmlFor="sri-pto">Punto de emisión</label>
          <input id="sri-pto" className="entrada" inputMode="numeric" maxLength={3} value={d.pto_emi} onChange={cambiar("pto_emi")} /></div>
      </div>
      <div className="campo"><label htmlFor="sri-sig">Si ya facturabas con otro sistema, número de tu siguiente factura</label>
        <input id="sri-sig" className="entrada" inputMode="numeric" placeholder={cfg?.siguiente_factura ? String(cfg.siguiente_factura) : "1"}
          value={d.siguiente_factura} onChange={cambiar("siguiente_factura")} /></div>
      <label className="casilla"><input type="checkbox" checked={d.obligado_contabilidad}
        onChange={(e) => setD({ ...d, obligado_contabilidad: e.target.checked })} /> Obligado a llevar contabilidad</label>
      <details>
        <summary className="muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Contribuyente especial o agente de retención</summary>
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="sri-esp">N.º de contribuyente especial</label>
            <input id="sri-esp" className="entrada" inputMode="numeric" value={d.contribuyente_especial} onChange={cambiar("contribuyente_especial")} /></div>
          <div className="campo"><label htmlFor="sri-ret">Resolución de agente de retención</label>
            <input id="sri-ret" className="entrada" inputMode="numeric" value={d.agente_retencion} onChange={cambiar("agente_retencion")} /></div>
        </div>
      </details>

      <div className="separador" />
      <h3>Firma electrónica</h3>
      <p className="muted">{cfg?.tiene_firma ? `Ya tienes la firma de ${cfg.firma_titular}. Sube otra solo si la renovaste.` : "El archivo .p12 que te dio tu entidad de certificación."} Se guarda cifrada y nadie puede descargarla.</p>
      <div className="campo"><label htmlFor="sri-p12">Archivo .p12</label>
        <input id="sri-p12" className="entrada" type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
      <div className="campo"><label htmlFor="sri-clave">Contraseña de la firma</label>
        <input id="sri-clave" className="entrada" type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} /></div>

      <div className="campo"><label htmlFor="sri-amb">Ambiente</label>
        <select id="sri-amb" className="entrada" value={d.ambiente} onChange={cambiar("ambiente")}>
          <option value="1">Pruebas (sin validez tributaria)</option>
          <option value="2">Producción</option>
        </select></div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="boton" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar"}</button>
        {alCancelar && <button type="button" className="boton secundario" onClick={alCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}
