# Al Cien

**Tu negocio al cien.** App de ventas, caja, inventario, fiados y facturación electrónica SRI para negocios pequeños de Ecuador. Un producto de **Nubegocio**.

Al registrarse, el usuario dice qué negocio tiene y el sistema se arma solo: activa los módulos de su familia de negocio, copia categorías y productos de ejemplo, y usa su vocabulario ("platos", "servicios", "productos").

## Estado

| Etapa | Contenido | Estado |
| --- | --- | --- |
| 0 · Base | Base de datos, seguridad por fila, API, CI, imagen para Cloud Run | Listo y probado |
| 1 · Alta automática | Acceso por WhatsApp, catálogo, búsqueda, motor de plantillas, tipos nuevos por IA, pantallas de registro | Listo y probado |
| 2 · Vender | Productos, precios, venta por peso, código de barras, cobro con vuelto, pago mixto, fiado, caja, gastos, anulaciones | Listo y probado |
| 3 · Control | Proveedores y compras, reportes por periodo, recordatorios de fiado por WhatsApp | Pendiente |
| 4 · SRI | Factura y nota de crédito electrónicas | Pendiente |
| 5 · Negocio | Planes y cobro recurrente con Kushki, panel de administración | Pendiente (el equipo y los roles ya funcionan) |

## Estructura

```
data/            catalogo_plantillas_negocios.xlsx — fuente del catálogo (módulos, familias, 216 tipos)
db/
  migrations/    esquema en orden (0001 … 0008)
  seed/          catalogo.sql — GENERADO desde el Excel, no editar a mano
  tools/         generar_seed.py
  tests/         pruebas en SQL (cada una en una transacción que se revierte)
  scripts/       migrate.sh, reset.sh, test.sh, crear_usuario_api.sh
apps/api/        API en Node 22 + TypeScript, sin dependencias de ejecución
apps/web/        App web instalable (React 19 + esbuild)
e2e/             recorrido completo en navegador (Playwright)
Dockerfile       imagen única para Cloud Run (API + web)
```

## La API

Sin dependencias de ejecución: usa `node:http`, `node:crypto` y un cliente propio de PostgreSQL (`apps/api/src/db/pgwire.ts`: SCRAM-SHA-256, TLS, socket Unix para Cloud SQL, consultas con parámetros). Si más adelante se prefiere el paquete `pg`, solo cambia ese archivo.

- **Sesión:** código de 6 dígitos por WhatsApp → cookie `HttpOnly` de 30 días. Solo se guardan hashes del código y del token.
- **Negocio:** cada petición lleva `X-Negocio`; la API abre una transacción, verifica la membresía con `app.entrar_negocio` y la seguridad por fila de PostgreSQL filtra el resto.
- **Protecciones:** límite de códigos por celular, por IP y global; 5 intentos por código; solo JSON; peticiones que cambian datos solo desde el propio origen; cabeceras de seguridad y CSP.

| Rutas | Qué hacen |
| --- | --- |
| `POST /api/auth/codigo`, `POST /api/auth/verificar`, `POST /api/auth/salir`, `GET/PATCH /api/yo` | Acceso sin contraseña |
| `GET /api/tipos-negocio?q=`, `POST /api/tipos-negocio/sugerir` | Buscar el tipo de negocio; si no existe, la IA propone uno |
| `POST /api/negocios`, `GET /api/negocio`, `PATCH /api/negocio/config`, `POST /api/negocio/modulos/:m` | Alta automática, datos y módulos |
| `GET/POST /api/negocio/equipo`, `PATCH /api/negocio/equipo/:usuario` | Invitar cajeros, bodegueros y administradores por celular |
| `GET/POST /api/categorias`, `GET/POST/PATCH /api/productos`, `POST /api/productos/:id/stock` | Catálogo del negocio |
| `POST/GET /api/ventas`, `GET /api/ventas/:id`, `POST /api/ventas/:id/anular`, `GET /api/resumen/hoy` | Ventas |
| `GET /api/caja`, `POST /api/caja/abrir`, `/cerrar`, `/movimientos`, `POST /api/gastos` | Caja |
| `GET/POST /api/clientes`, `GET /api/clientes/:id`, `POST /api/clientes/:id/abonos` | Clientes y fiado |

Reglas de dinero (en la base, `app.registrar_venta`): el precio incluye IVA; base e IVA se calculan por línea; los pagos deben sumar el total; el cajero no cambia precios, no da descuentos ni anula; una venta anulada devuelve stock y revierte el fiado.

## Correr en local

Requisitos: PostgreSQL 16 (con `pg_trgm`, `unaccent`, `pgcrypto`, `citext`), Node 22 y Python 3 con `openpyxl`.

```bash
npm install
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres   # usuario administrador

# Base de desarrollo con catálogo y el usuario de la API
PGDATABASE=alcien_dev bash db/scripts/reset.sh
PGDATABASE=alcien_dev ALCIEN_API_PASSWORD=alcien-dev bash db/scripts/crear_usuario_api.sh

# Compilar la web y arrancar la API (sirve la web en http://localhost:8080)
npm run build -w @alcien/web
cp .env.example .env   # revisa los valores
set -a; . ./.env; set +a
npm run dev -w @alcien/api
```

En desarrollo el código de acceso aparece en pantalla ("Modo de prueba"); en producción llega por WhatsApp.

## Pruebas

```bash
bash db/scripts/test.sh            # 7 archivos de pruebas SQL
bash apps/api/scripts/test.sh      # 14 pruebas de la API contra PostgreSQL real
BASE=http://localhost:8080 node e2e/flujo-venta.mjs   # recorrido completo en navegador
```

La CI de GitHub corre las tres en cada cambio y guarda las capturas del recorrido.

## Desplegar en Google Cloud

1. Cloud SQL (PostgreSQL 16): crear la base, correr las migraciones y el seed con un usuario administrador, y crear `alcien_api` con `db/scripts/crear_usuario_api.sh`.
2. Secret Manager: `ALCIEN_SECRETO_CODIGOS` (32+ caracteres aleatorios), `PGPASSWORD`, `WHATSAPP_TOKEN`, `GEMINI_API_KEY`.
3. Cloud Run: `gcloud run deploy alcien --source . --region us-east1` con la conexión a Cloud SQL (`PGHOST=/cloudsql/PROYECTO:REGION:INSTANCIA`) y las variables de `.env.example`.
4. La API se niega a arrancar en producción sin secreto de códigos o con los códigos en consola.

## Cambiar el catálogo

1. Edita `data/catalogo_plantillas_negocios.xlsx`.
2. Corre `python3 db/tools/generar_seed.py` y las pruebas.
3. Sube ambos archivos. La CI falla si el seed no coincide con el Excel.

Los negocios existentes no cambian: al registrarse recibieron una copia.

## Pendientes conocidos

- Generar `package-lock.json` en la primera instalación con internet y subirlo.
- Verificar el tipado de la web en la primera corrida de CI (el paso está marcado para no bloquear).
- Plantilla de autenticación de WhatsApp aprobada por Meta y número verificado.
- Confirmar con el contador el tratamiento de IVA por producto y régimen RIMPE antes de la etapa 4.

Nunca subas firmas electrónicas (`.p12`), contraseñas ni claves: van en Secret Manager.
