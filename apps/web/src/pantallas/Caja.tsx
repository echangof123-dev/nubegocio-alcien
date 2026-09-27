import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { InfoNegocio, ResumenCaja } from "../tipos";
import { dinero, hora, parsearNumero, redondear } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";
import { ICheckCirculo, IAlerta } from "../componentes/iconos";

export function Caja({ info, avisar }: { info: InfoNegocio; avisar: (t: string) => void }) {
  const [estado, setEstado] = useState<{ abierta: boolean; caja?: ResumenCaja; ultimoCierre?: ResumenCaja | null } | null>(null);
  const [apertura, setApertura] = useState("");
  const [contado, setContado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<"retiro" | "ingreso" | "gasto" | null>(null);
  const [cerrada, setCerrada] = useState<ResumenCaja | null>(null);

  const cargar = useCallback(() => {
    api<{ abierta: boolean; caja?: ResumenCaja; ultimoCierre?: ResumenCaja | null }>("GET", "/caja")
      .then(setEstado).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(cargar, [cargar]);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    try {
      await api("POST", "/caja/abrir", { monto: parsearNumero(apertura) ?? 0 });
      setCerrada(null);
      avisar("Caja abierta. ¡A vender!");
      cargar();
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(false); }
  }

  async function cerrar(e: FormEvent) {
    e.preventDefault();
    const n = parsearNumero(contado);
    if (n === null) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await api<{ caja: ResumenCaja }>("POST", "/caja/cerrar", { contado: n });
      setCerrada(r.caja);
      setContado("");
      cargar();
    } catch (err) { setError(mensajeDe(err)); } finally { setOcupado(false); }
  }

  if (!estado) return error ? <div className="contenido"><Aviso tipo="error">{error}</Aviso></div> : <Cargando />;

  if (!estado.abierta) {
    return (
      <div className="contenido" style={{ maxWidth: 520, width: "100%", margin: "0 auto" }}>
        <h1>Caja</h1>
        {cerrada && <ResultadoCierre caja={cerrada} />}
        <form className="tarjeta" onSubmit={abrir}>
          <h3>Abrir caja</h3>
          <p className="muted">Cuenta el efectivo con el que empiezas el día (para dar vuelto).</p>
          <CampoMonto id="apertura" etiqueta="Efectivo inicial" valor={apertura} alCambiar={setApertura} grande />
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button className="boton bloque" disabled={ocupado}>Abrir caja</button>
        </form>
        {estado.ultimoCierre && !cerrada && (
          <p className="muted">Último cierre: esperado {dinero(estado.ultimoCierre.efectivo_esperado)}, contado {dinero(estado.ultimoCierre.efectivo_contado)}.</p>
        )}
      </div>
    );
  }

  const c = estado.caja!;
  const contadoN = parsearNumero(contado);
  const dif = contadoN === null ? null : redondear(contadoN - c.efectivo_esperado);

  return (
    <div className="contenido" style={{ maxWidth: 520, width: "100%", margin: "0 auto" }}>
      <div>
        <h1>Cierre de caja</h1>
        <p className="muted">Abierta a las {hora(c.abierto_en)}</p>
      </div>

      <div className="opciones" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="tarjeta" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Ventas</span><strong>{dinero(c.ventas_total)}</strong><span className="muted" style={{ fontSize: 12 }}>{c.ventas_cantidad} ventas</span></div>
        <div className="tarjeta" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Gastos</span><strong>{dinero(c.gastos_efectivo)}</strong><span className="muted" style={{ fontSize: 12 }}>en efectivo</span></div>
        <div className="tarjeta" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Fiado</span><strong>{dinero(c.fiado)}</strong><span className="muted" style={{ fontSize: 12 }}>hoy</span></div>
      </div>

      <div className="tarjeta">
        <h3>Lo que debe haber</h3>
        <div className="fila"><span className="muted">Monto de apertura</span><span>{dinero(c.monto_apertura)}</span></div>
        <div className="fila"><span className="muted">Ventas en efectivo</span><span>{dinero(c.efectivo_ventas)}</span></div>
        {c.abonos_efectivo > 0 && <div className="fila"><span className="muted">Abonos de fiados</span><span>{dinero(c.abonos_efectivo)}</span></div>}
        {c.ingresos > 0 && <div className="fila"><span className="muted">Ingresos</span><span>{dinero(c.ingresos)}</span></div>}
        {c.retiros > 0 && <div className="fila"><span className="muted">Retiros</span><span>− {dinero(c.retiros)}</span></div>}
        {c.gastos_efectivo > 0 && <div className="fila"><span className="muted">Gastos en efectivo</span><span>− {dinero(c.gastos_efectivo)}</span></div>}
        <div className="separador" />
        <div className="fila"><strong>Efectivo esperado</strong><strong>{dinero(c.efectivo_esperado)}</strong></div>
        {c.transferencia > 0 && <div className="fila"><span className="muted">Transferencias</span><span>{dinero(c.transferencia)}</span></div>}
        {c.tarjeta > 0 && <div className="fila"><span className="muted">Tarjeta</span><span>{dinero(c.tarjeta)}</span></div>}
        {c.deuna > 0 && <div className="fila"><span className="muted">DeUna</span><span>{dinero(c.deuna)}</span></div>}
      </div>

      <div className="opciones" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <button className="boton secundario pequeno" onClick={() => setDialogo("gasto")}>Gasto</button>
        <button className="boton secundario pequeno" onClick={() => setDialogo("retiro")}>Retiro</button>
        <button className="boton secundario pequeno" onClick={() => setDialogo("ingreso")}>Ingreso</button>
      </div>

      <form onSubmit={cerrar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CampoMonto id="contado" etiqueta="Efectivo que contaste" valor={contado} alCambiar={setContado} grande />
        {dif !== null && (dif === 0
          ? <Aviso tipo="exito" titulo="¡Caja cuadrada!">Contaste lo mismo que esperábamos.</Aviso>
          : <Aviso tipo="atencion" titulo={dif < 0 ? `Te faltan ${dinero(-dif)}` : `Te sobran ${dinero(dif)}`}>Revisa los retiros y gastos de hoy antes de cerrar.</Aviso>)}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" style={{ minHeight: 56 }} disabled={ocupado || contadoN === null}>Cerrar caja</button>
      </form>

      {dialogo && (
        <DialogoMovimiento tipo={dialogo} alCerrar={() => setDialogo(null)} alGuardar={() => { setDialogo(null); avisar("Guardado"); cargar(); }} />
      )}
      <p className="muted" style={{ fontSize: 13 }}>{info.negocio.nombre}</p>
    </div>
  );
}

function ResultadoCierre({ caja }: { caja: ResumenCaja }) {
  const d = caja.diferencia ?? 0;
  return d === 0 ? (
    <div className="aviso exito"><span style={{ color: "var(--success)" }}><ICheckCirculo tam={28} /></span>
      <div><strong>¡Caja cuadrada!</strong><br />Vendiste {dinero(caja.ventas_total)} en {caja.ventas_cantidad} ventas.</div></div>
  ) : (
    <div className="aviso atencion"><IAlerta tam={28} />
      <div><strong>{d < 0 ? `Faltaron ${dinero(-d)}` : `Sobraron ${dinero(d)}`}</strong><br />Esperábamos {dinero(caja.efectivo_esperado)} y contaste {dinero(caja.efectivo_contado)}.</div></div>
  );
}

function DialogoMovimiento({ tipo, alCerrar, alGuardar }: { tipo: "retiro" | "ingreso" | "gasto"; alCerrar: () => void; alGuardar: () => void }) {
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const n = parsearNumero(monto);
  const titulos = { retiro: "Sacar dinero de la caja", ingreso: "Poner dinero en la caja", gasto: "Registrar un gasto" };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      if (tipo === "gasto") await api("POST", "/gastos", { categoria: motivo || "Otros", monto: n, metodo: "efectivo" });
      else await api("POST", "/caja/movimientos", { tipo, monto: n, motivo });
      alGuardar();
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo={titulos[tipo]} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CampoMonto id="mov-monto" etiqueta="Monto" valor={monto} alCambiar={setMonto} grande />
        <div className="campo">
          <label htmlFor="mov-motivo">{tipo === "gasto" ? "¿En qué se gastó?" : "Motivo"}</label>
          <input id="mov-motivo" className="entrada" maxLength={120} placeholder={tipo === "gasto" ? "Transporte, limpieza…" : "Depósito en el banco…"} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={n === null || n <= 0 || (tipo !== "gasto" && motivo.trim().length < 2)}>Guardar</button>
      </form>
    </Dialogo>
  );
}
