# Probar Al Cien gratis: Render + Neon

Sin tarjeta. Sirve para probar; para clientes reales conviene un plan pagado.

**Límites del plan gratis:** la app se duerme tras 15 minutos sin uso y tarda cerca de un minuto en despertar;
los reintentos al SRI solo corren mientras está despierta. La base de Neon gratis tiene 0,5 GB.

## 1. Base de datos en Neon
1. Entra a https://neon.tech y crea una cuenta (con GitHub o Google).
2. Crea un proyecto: nombre `alcien`, Postgres 16 o 17, región **AWS US East 2 (Ohio)**.
3. En **Connect**, desactiva *Connection pooling* y copia la cadena de conexión
   (empieza con `postgresql://` y termina en `sslmode=require`).

## 2. La app en Render
1. Entra a https://render.com y crea una cuenta con GitHub.
2. Abre https://render.com/deploy?repo=https://github.com/echangof123-dev/nubegocio-alcien
3. En `ALCIEN_DB_ADMIN_URL` pega la cadena de Neon y pulsa **Apply / Deploy**.
4. Espera 5–10 minutos. Al arrancar, la app crea las tablas y carga las 216 plantillas.
   Tu enlace aparece arriba: `https://alcien-….onrender.com`.

## 3. Entrar
Abre el enlace, escribe tu número y pide el código. Míralo en Render → tu servicio → **Logs**,
buscando `código de acceso`.
