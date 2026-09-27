/**
 * Envío del código de acceso.
 *   · consola: solo desarrollo; escribe el código en el registro.
 *   · meta: WhatsApp Cloud API con una plantilla de autenticación aprobada.
 */
import type { Config } from "../config.js";

export interface EnviadorCodigos {
  enviar(celular: string, codigo: string): Promise<void>;
}

export class EnviadorConsola implements EnviadorCodigos {
  ultimos = new Map<string, string>();
  async enviar(celular: string, codigo: string) {
    this.ultimos.set(celular, codigo);
    console.log(JSON.stringify({ nivel: "info", msg: "código de acceso (solo desarrollo)", celular, codigo }));
  }
}

export class EnviadorWhatsAppMeta implements EnviadorCodigos {
  constructor(private readonly cfg: Config["whatsapp"]) {
    if (!cfg.token || !cfg.phoneNumberId) throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
  }

  async enviar(celular: string, codigo: string) {
    const url = `https://graph.facebook.com/${this.cfg.version}/${this.cfg.phoneNumberId}/messages`;
    const cuerpo = {
      messaging_product: "whatsapp",
      to: celular.replace("+", ""),
      type: "template",
      template: {
        name: this.cfg.plantilla,
        language: { code: "es" },
        components: [
          { type: "body", parameters: [{ type: "text", text: codigo }] },
          // Las plantillas de autenticación llevan un botón para copiar el código
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: codigo }] },
        ],
      },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      throw new Error(`WhatsApp respondió ${r.status}: ${detalle.slice(0, 300)}`);
    }
  }
}

export function crearEnviador(cfg: Config["whatsapp"]): EnviadorCodigos {
  return cfg.proveedor === "meta" ? new EnviadorWhatsAppMeta(cfg) : new EnviadorConsola();
}
