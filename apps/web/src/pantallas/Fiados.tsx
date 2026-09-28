import { enlaceWa } from "../componentes/servicios";
import { mensajeCobro } from "./Clientes";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, mensajeDe } from "../api";
import type { Cliente } from "../tipos";
import { dinero, parsearNumero } from "../formato";
import { Aviso, CampoMonto, Cargando, Dialogo } from "../componentes/basicos";

export function Fiados({ avisar, negocio }: { avisar: (t: string) => void; negocio: string }) {
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [abonar, setAbonar] = useState<Cliente | null>(null);

  const cargar = useCallback(() => {
    api<{ clientes: Cliente[] }>("GET", "/clientes?con_deuda=1").then((r) => setClientes(r.clientes)).catch(() => setClientes([]));
  }, []);
  useEffect(cargar, [cargar]);

  if (!clientes) return <Cargando />;
  const total = clientes.reduce((s, c) => s + c.saldo, 0);

  return (
    <div className="contenido" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <h1>Fiados</h1>
      <div className="total-cobro">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>Te deben en total</span>
          <span className="monto-grande">{dinero(total)}</span>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>{clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}</span>
      </div>
      {clientes.length === 0 ? (
        <div className="vacio"><p>Nadie te debe. ¡Bien!</p></div>
      ) : (
        <div className="tarjeta" style={{ padding: "4px 16px" }}>
          <div className="tabla-simple">
            {clientes.map((c) => (
              <div key={c.id} className="fila">
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <strong>{c.nombre}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>{c.celular ?? "Sin celular"}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <strong>{dinero(c.saldo)}</strong>
                  {(() => { const wa = enlaceWa(c.celular, mensajeCobro(c, negocio)); return wa ? <a className="boton pequeno secundario" href={wa} target="_blank" rel="noopener">Recordar</a> : null; })()}
                  <button className="boton pequeno secundario" onClick={() => setAbonar(c)}>Abonar</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {abonar && <DialogoAbono cliente={abonar} alCerrar={() => setAbonar(null)} alGuardar={(saldo) => {
        setAbonar(null);
        avisar(saldo > 0 ? `Abono guardado. Queda debiendo ${dinero(saldo)}` : "¡Deuda saldada!");
        cargar();
      }} />}
    </div>
  );
}

function DialogoAbono({ cliente, alCerrar, alGuardar }: { cliente: Cliente; alCerrar: () => void; alGuardar: (saldo: number) => void }) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [error, setError] = useState<string | null>(null);
  const n = parsearNumero(monto);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ saldo: number }>("POST", `/clientes/${cliente.id}/abonos`, { monto: n, metodo });
      alGuardar(r.saldo);
    } catch (err) { setError(mensajeDe(err)); }
  }

  return (
    <Dialogo titulo={`Abono de ${cliente.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted">Debe {dinero(cliente.saldo)}</p>
        <CampoMonto id="abono" etiqueta="¿Cuánto paga?" valor={monto} alCambiar={setMonto} grande />
        <button type="button" className="boton texto" style={{ alignSelf: "flex-start" }} onClick={() => setMonto(String(cliente.saldo).replace(".", ","))}>Paga todo</button>
        <div className="opciones">
          {["efectivo", "transferencia"].map((m) => (
            <button type="button" key={m} className={`opcion${metodo === m ? " activa" : ""}`} onClick={() => setMetodo(m)}>
              {m === "efectivo" ? "Efectivo" : "Transferencia"}
            </button>
          ))}
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="boton bloque" disabled={n === null || n <= 0}>Guardar abono</button>
      </form>
    </Dialogo>
  );
}
