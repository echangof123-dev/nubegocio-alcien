# Al Cien

**Tu negocio al cien.** App de ventas, caja, inventario, fiados y facturación electrónica SRI para negocios pequeños de Ecuador. Un producto de **Nubegocio**.

Al registrarse, el usuario dice qué negocio tiene y el sistema se arma solo: activa los módulos de su familia de negocio, copia categorías y productos de ejemplo, y usa su vocabulario ("platos", "servicios", "productos").

## Estado

| Etapa | Contenido | Estado |
| --- | --- | --- |
| 0 · Base | Base de datos, seguridad por fila, API, CI, imagen para Cloud Run | Listo y probado |
| 1 · Alta automática | Acceso por WhatsApp, catálogo, búsqueda, motor de plantillas, tipos nuevos por IA, pantallas de registro | Listo y probado |
| 2 · Vender | Productos, precios, venta por peso, código de barras, cobro con vuelto, pago mixto, fiado, caja, gastos, anulaciones | Listo y probado |
| 3 · Control | Proveedores y compras, reportes por periodo con descarga para Excel, recordatorios de fiado por WhatsApp | Listo y probado (falta el envío automático de recordatorios de fiado) |
| Como Treinta | Balance de ingresos y egresos, gastos por categoría con fecha, venta libre, recibo de cada venta por WhatsApp o impresora térmica (58/80 mm), clientes con historial y fecha de pago, inventario con valor y alertas, carga de productos desde Excel, fotos de productos, descargas para Excel, ajustes del negocio | Listo y probado |
| Módulos por negocio | Los 26 módulos de la matriz: mesas y cocina, recetas, pedidos y delivery, variantes, listas de precios, series y garantías, catálogo en línea, cotizaciones, lotes, agenda y comisiones, órdenes de trabajo, reservas, membresías, acopio con humedad y anticipos | Listo y probado (5 recorridos en navegador) |
| 4 · SRI | Factura y nota de crédito electrónicas, firma XAdES-BES, envío y autorización con reintentos, RIDE para compartir | Listo y probado (con un SRI simulado; falta la prueba en el ambiente de pruebas real del SRI) |
| 5 · Negocio | Planes y cobro recurrente con Kushki, panel de administración | Pendiente (el equipo y los roles ya funcionan) |

## Estructura

```
data/            catalogo_plantillas_negocios.xlsx — fuente del catálogo (módulos, familias, 216 tipos)
db/
  migrations/    esquema en orden (0001 … 0009)
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
| `GET/POST /api/clientes`, `GET/PATCH /api/clientes/:id`, `POST /api/clientes/:id/abonos` | Clientes y fiado |
| `GET/POST /api/sri/config`, `POST /api/sri/firma` | Datos del SRI y firma electrónica del negocio |
| `GET /api/comprobantes`, `GET /api/comprobantes/:id`, `POST /api/comprobantes/:id/enviar`, `/reemitir`, `POST /api/ventas/:id/facturar` | Facturas y notas de crédito |
| `GET /api/c/:token`, `GET /api/c/:token/xml` | RIDE público (el enlace que se envía al cliente) y XML autorizado |
| `POST /api/tareas/sri` | Reintentos programados (Cloud Scheduler, con `ALCIEN_TOKEN_TAREAS`) |
| `/api/proveedores`, `/api/compras`, `/api/lotes`, `/api/cotizaciones`, `GET /api/q/:token` | Compras, lotes y cotizaciones (`rutas/compras.ts`) |
| `/api/mesas`, `/api/cuentas`, `/api/cocina`, `/api/pedidos`, `/api/recetas/:producto` | Restaurantes (`rutas/comida.ts`) |
| `/api/listas`, `/api/series`, `/api/catalogo/*`, `GET /api/tienda/:slug` | Tiendas (`rutas/retail.ts`) |
| `/api/profesionales`, `/api/comisiones`, `/api/citas`, `/api/ordenes`, `/api/recursos`, `/api/reservas`, `/api/planes-membresia`, `/api/membresias`, `/api/asistencias`, `GET /api/o/:token` | Servicios (`rutas/servicios.ts`) |
| `GET /api/balance`, `/api/gastos`, `POST /api/ventas/libre`, `GET /api/r/:token`, `/api/clientes/:id/compras`, `/api/inventario`, `/api/productos/importar`, `/api/productos/:id/foto`, `GET /api/f/:producto`, `/api/reportes/{gastos,inventario}.csv` | Paridad con Treinta (`rutas/balance.ts`) |
| `/api/productores`, `/api/anticipos`, `/api/acopio`, `GET /api/reportes`, `GET /api/reportes/ventas.csv` | Acopio y reportes por periodo (`rutas/acopio.ts`) |

Reglas de dinero (en la base, `app.registrar_venta`): el precio incluye IVA; base e IVA se calculan por línea; los pagos deben sumar el total; el cajero no cambia precios, no da descuentos ni anula; una venta anulada devuelve stock y revierte el fiado.

## Facturación electrónica (SRI)

Cada negocio factura con **su propio RUC y su propia firma**. El dueño sube su `.p12` desde la app (Reportes → Facturación electrónica); la API la abre, la valida y la guarda cifrada (AES-256-GCM con `ALCIEN_CLAVE_FIRMAS`, atada al negocio). Nunca se devuelve.

- **Emisión:** al cobrar con "Factura", en la misma transacción de la venta se reserva el número, se arma el XML (factura 1.1.0 / nota de crédito 1.1.0) y se firma (XAdES-BES, RSA-SHA1). Si algo falla, la venta no se guarda.
- **Envío:** después de confirmar la venta se manda a recepción y autorización del SRI. Si el SRI no responde, queda pendiente y se reintenta con espera creciente (cada minuto dentro del servicio y con la tarea programada). La venta nunca espera al SRI.
- **Reglas:** consumidor final solo hasta $50; desde 2026 una factura a consumidor final no se anula (Resolución NAC-DGERCGC25-00000014); anular una factura autorizada emite nota de crédito; una devuelta o no autorizada se vuelve a emitir con otro número.
- **Sin librerías:** lector de `.p12` (PBES2/AES, 3DES y RC2 de las firmas antiguas), C14N y XAdES propios en `apps/api/src/sri/`. Las pruebas verifican la firma con una implementación independiente (`lxml` + `cryptography`) y el XML contra los XSD oficiales del SRI.
- **Ambientes:** cada negocio empieza en **pruebas**. Cuando el SRI lo habilite, cambia a producción desde la app.

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
bash db/scripts/test.sh            # 14 archivos de pruebas SQL
bash apps/api/scripts/test.sh      # 48 pruebas de la API contra PostgreSQL real (con Python + lxml + cryptography verifica la firma)
node e2e/sri-falso.mjs &           # SRI de mentira para el recorrido (API con SRI_URL_PRUEBAS=http://127.0.0.1:9099/ws)
BASE=http://localhost:8080 node e2e/flujo-venta.mjs   # recorrido completo en navegador, incluida una factura
# y los recorridos por tipo de negocio: flujo-restaurante, flujo-ropa, flujo-servicios, flujo-acopio, flujo-treinta
```

La CI de GitHub corre las tres en cada cambio y guarda las capturas del recorrido.

## Probar gratis en Render

[![Desplegar en Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/echangof123-dev/nubegocio-alcien)

`render.yaml` crea la app y su PostgreSQL en el plan gratis, sin tarjeta. La app migra la base al arrancar. Si el PostgreSQL no permite crear usuarios, usa el "modo sin roles": la seguridad por fila queda obligatoria también para la dueña de las tablas (la CI corre todas las pruebas de la API también así). Guía: `deploy/RENDER.md`.

## Desplegar en Google Cloud

[![Abrir en Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/echangof123-dev/nubegocio-alcien&cloudshell_tutorial=deploy/TUTORIAL.md&show=terminal)

El botón abre Google Cloud Shell con el código y una guía paso a paso. Ahí solo se corre:

```bash
bash deploy/desplegar.sh
```

Si no hay proyecto elegido, el script crea uno (`alcien-…`) y le vincula la cuenta de facturación.
El script crea o actualiza, sin borrar nada: Cloud SQL (PostgreSQL 16, `db-f1-micro`, respaldos diarios), los secretos en Secret Manager (generados al azar, nunca salen de Google Cloud), la cuenta de servicio con permisos mínimos, las migraciones y el catálogo, la app en Cloud Run y la tarea de Cloud Scheduler que reintenta los envíos al SRI cada 5 minutos. Para publicar una versión nueva, se vuelve a correr.

**Beta cerrada:** mientras Meta aprueba la plantilla de WhatsApp, la app corre con `WHATSAPP_PROVEEDOR=registro`: el código de acceso no llega por WhatsApp; queda en el registro del servidor y solo lo ve quien tiene acceso al proyecto (`bash deploy/ver-codigos.sh`). Con la plantilla aprobada: crear los secretos `alcien-whatsapp-token` y `alcien-whatsapp-numero` y correr `WHATSAPP_PROVEEDOR=meta bash deploy/desplegar.sh`.

La API se niega a arrancar en producción sin secreto de códigos, sin clave de firmas o con los códigos en pantalla. La CI construye la imagen de Docker y la arranca en modo producción en cada cambio.

## Cambiar el catálogo

1. Edita `data/catalogo_plantillas_negocios.xlsx`.
2. Corre `python3 db/tools/generar_seed.py` y las pruebas.
3. Sube ambos archivos. La CI falla si el seed no coincide con el Excel.

Los negocios existentes no cambian: al registrarse recibieron una copia.

## Pendientes conocidos

- Generar `package-lock.json` en la primera instalación con internet y subirlo.
- Verificar el tipado de la web en la primera corrida de CI (el paso está marcado para no bloquear).
- Plantilla de autenticación de WhatsApp aprobada por Meta y número verificado.
- Probar una factura real en el ambiente de pruebas del SRI con una firma real (la CI usa un SRI simulado).
- Confirmar con el contador: IVA por producto, facturas de negocios populares RIMPE y formas de pago del fiado.
- Envío del RIDE por correo (hoy se comparte por enlace y WhatsApp).
- Liquidación de compra electrónica del SRI (documento 03) para el acopio: hoy la liquidación es un comprobante interno para imprimir.
- Recordatorios automáticos por WhatsApp (citas, fiado, membresías por vencer): hoy son botones que abren WhatsApp con el mensaje listo.

Nunca subas firmas electrónicas (`.p12`), contraseñas ni claves: van en Secret Manager.
