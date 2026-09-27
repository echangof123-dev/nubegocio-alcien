import type { Router } from "../http/servidor.js";
import { COOKIE_SESION } from "../http/servidor.js";
import type { ServicioAcceso } from "../auth/acceso.js";
import type { EnviadorCodigos } from "../auth/whatsapp.js";
import { EnviadorConsola } from "../auth/whatsapp.js";
import type { Consultable } from "../db/pool.js";
import { celular, objeto, texto } from "../http/validar.js";

export function rutasAcceso(r: Router, dep: {
  db: Consultable; acceso: ServicioAcceso; enviador: EnviadorCodigos; desarrollo: boolean; produccion: boolean;
}) {
  const cookie = (token: string, dias: number) =>
    `${COOKIE_SESION}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${dias * 86400}${dep.produccion ? "; Secure" : ""}`;

  r.publico("POST", "/auth/codigo", async (p) => {
    const cuerpo = objeto(p.cuerpo);
    const numero = celular(cuerpo.celular);
    const { expiraEn } = await dep.acceso.pedirCodigo(numero, p.ip);
    // En desarrollo, con envío por consola, se devuelve el código para probar sin WhatsApp
    const codigoDev = dep.desarrollo && dep.enviador instanceof EnviadorConsola ? dep.enviador.ultimos.get(numero) : undefined;
    return { enviado: true, celular: numero, expiraEn, ...(codigoDev ? { codigoDev } : {}) };
  });

  r.publico("POST", "/auth/verificar", async (p) => {
    const cuerpo = objeto(p.cuerpo);
    const numero = celular(cuerpo.celular);
    const codigo = texto(cuerpo.codigo, "El código", { min: 6, max: 6 });
    const { token, usuario, diasSesion } = await dep.acceso.verificarCodigo(numero, codigo, String(p.headers["user-agent"] ?? "") || null);
    const { rows: negocios } = await dep.db.query("select * from app.mis_negocios($1)", [usuario.id]);
    const nativo = p.headers["x-alcien-cliente"] === "nativo";
    return {
      cookies: [cookie(token, diasSesion)],
      cuerpo: { usuario: { id: usuario.id, nombre: usuario.nombre, celular: numero }, nuevo: usuario.nuevo, negocios, ...(nativo ? { token } : {}) },
    };
  });

  r.sesion("POST", "/auth/salir", async (p) => {
    await dep.acceso.cerrarSesion(p.sesionId!);
    return { status: 204, cookies: [`${COOKIE_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`] };
  });

  r.sesion("GET", "/yo", async (p) => {
    const { rows } = await dep.db.query<{ id: string; nombre: string | null; celular: string }>(
      "select id, nombre, celular from auth.usuario where id = $1", [p.usuarioId]);
    const { rows: negocios } = await dep.db.query("select * from app.mis_negocios($1)", [p.usuarioId]);
    return { usuario: rows[0], negocios };
  });

  r.sesion("PATCH", "/yo", async (p) => {
    const nombre = texto(objeto(p.cuerpo).nombre, "Tu nombre", { min: 2, max: 80 });
    await dep.db.query("update auth.usuario set nombre = $2 where id = $1", [p.usuarioId, nombre]);
    return { nombre };
  });
}
