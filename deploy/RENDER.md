# Probar Al Cien gratis: GitHub + Render

Sin tarjeta. La app y su base de datos PostgreSQL quedan en Render, en el plan gratis.
Sirve para probar; para clientes reales conviene un plan pagado.

**Límites del plan gratis de Render:**
- La app se duerme tras 15 minutos sin uso y tarda cerca de un minuto en despertar.
  Los reintentos al SRI solo corren mientras está despierta.
- La base de datos gratis **vence a los 30 días** (Render avisa antes). Para seguir, se pasa a un plan pagado
  sin perder los datos, o se crea otra.

## Pasos
1. Entra a https://render.com y crea una cuenta con **GitHub** (`echangof123-dev`).
2. Abre https://render.com/deploy?repo=https://github.com/echangof123-dev/nubegocio-alcien
3. Render muestra lo que va a crear: la base `alcien-db` y la app `alcien`, las dos **Free**.
   Pulsa **Deploy Blueprint** (o **Apply**).
4. Espera 5–10 minutos. Al arrancar, la app crea las tablas y carga las 216 plantillas.
   Cuando el servicio diga **Live**, tu enlace aparece arriba: `https://alcien-….onrender.com`.

## Entrar
Abre el enlace, escribe tu número y pide el código. Míralo en Render → servicio `alcien` → **Logs**,
buscando `código de acceso`.

## Actualizar
Cada cambio que se sube a GitHub (rama `main`) se publica solo en Render.
