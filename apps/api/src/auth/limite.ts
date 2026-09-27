/**
 * Límite de peticiones en memoria (ventana deslizante simple).
 * Es una segunda barrera: la principal está en la base (códigos por celular).
 * Con varias instancias de Cloud Run cada una cuenta por separado; es suficiente
 * para frenar abusos obvios sin depender de otro servicio.
 */
export class Limitador {
  private eventos = new Map<string, number[]>();

  constructor(private readonly maximo: number, private readonly ventanaMs: number) {}

  /** Devuelve true si se permite y registra el evento. */
  permitir(clave: string, ahora = Date.now()): boolean {
    const desde = ahora - this.ventanaMs;
    const lista = (this.eventos.get(clave) ?? []).filter((t) => t > desde);
    if (lista.length >= this.maximo) {
      this.eventos.set(clave, lista);
      return false;
    }
    lista.push(ahora);
    this.eventos.set(clave, lista);
    if (this.eventos.size > 50_000) this.limpiar(desde);
    return true;
  }

  private limpiar(desde: number) {
    for (const [k, v] of this.eventos) {
      if (!v.some((t) => t > desde)) this.eventos.delete(k);
    }
  }
}
