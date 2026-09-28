/** Foto de producto: se achica en el teléfono (máx. 640 px, JPEG) antes de subirla. */
import { useState } from "react";
import { api, mensajeDe } from "../api";

export async function fotoComprimida(archivo: File, lado = 640): Promise<string> {
  const img = await createImageBitmap(archivo).catch(() => { throw new Error("No pudimos abrir esa imagen"); });
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  const ctx = lienzo.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
  for (const calidad of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", calidad));
    if (blob && blob.size <= 380_000) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
  }
  throw new Error("La foto es muy pesada");
}

export function FotoProducto({ id, version, alCambiar }: { id: string; version: number | null | undefined; alCambiar: (v: number | null) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function subir(f: File | undefined) {
    if (!f) return;
    setError(null);
    setOcupado(true);
    try {
      const datos = await fotoComprimida(f);
      const r = await api<{ foto_version: number }>("POST", `/productos/${id}/foto`, { tipo: "image/jpeg", datos });
      alCambiar(r.foto_version);
    } catch (e) { setError(mensajeDe(e)); }
    setOcupado(false);
  }
  async function quitar() {
    try { await api("DELETE", `/productos/${id}/foto`); alCambiar(null); } catch (e) { setError(mensajeDe(e)); }
  }
  return (
    <div className="foto-producto">
      {version ? <img src={`/api/f/${id}?v=${version}`} alt="Foto del producto" /> : <span className="sin-foto">Sin foto</span>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="boton pequeno secundario" htmlFor={`foto-${id}`} style={{ cursor: "pointer" }}>{ocupado ? "Subiendo…" : version ? "Cambiar foto" : "Agregar foto"}</label>
        <input id={`foto-${id}`} className="oculto" type="file" accept="image/*" disabled={ocupado} onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
        {version ? <button type="button" className="boton texto pequeno" onClick={quitar}>Quitar foto</button> : null}
        {error && <span className="muted" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  );
}
