# Al Cien

**Tu negocio al cien.** App de ventas, caja, inventario, fiados y facturación electrónica SRI para negocios pequeños de Ecuador. Un producto de **Nubegocio**.

Al registrarse, el usuario dice qué negocio tiene y el sistema se arma solo: activa los módulos de su familia de negocio, copia categorías y productos de ejemplo, y usa su vocabulario ("platos", "servicios", "productos").

## Estado

| Etapa | Contenido | Estado |
| --- | --- | --- |
| 0 · Base | Base de datos, seguridad por fila, migraciones, CI | Base de datos lista y probada |
| 1 · Alta automática | Catálogo, búsqueda de tipo de negocio, motor de plantillas, tipos nuevos por IA | Lógica de base de datos lista y probada |
| 1 · Alta automática | Acceso por WhatsApp, API y pantallas | Pendiente |
| 2–5 | Vender, control, SRI, planes y cobro | Pendiente |

## Estructura

```
data/          catalogo_plantillas_negocios.xlsx — fuente del catálogo (módulos, familias, 216 tipos)
db/
  migrations/  esquema en orden: base, catálogo, negocios, seguridad, motor de plantillas, búsqueda
  seed/        catalogo.sql — GENERADO desde el Excel, no editar a mano
  tools/       generar_seed.py
  tests/       pruebas en SQL (cada una en una transacción que se revierte)
  scripts/     migrate.sh, reset.sh, test.sh
apps/api       API (Node + TypeScript) — siguiente paso
apps/web       App web instalable (React + TypeScript) — siguiente paso
```

## Cómo funciona la base de datos

- **`catalogo`**: módulos, planes, familias, matriz familia × módulo y tipos de negocio. Lo administra Nubegocio.
- **`app`**: datos de cada negocio. Todas sus tablas tienen `negocio_id` y **seguridad por fila**: la API se conecta como `alcien_app` y solo ve el negocio fijado con `app.entrar_negocio(usuario, negocio)`.
- **`auth`**: usuarios, códigos de acceso y sesiones.

Funciones principales:

| Función | Qué hace |
| --- | --- |
| `catalogo.buscar_tipos(texto, límite)` | Busca el tipo de negocio sin tildes, con errores de escritura y frases como "vendo ropa" |
| `app.crear_negocio(usuario, tipo, nombre, ruc)` | Alta automática completa en una transacción |
| `app.entrar_negocio(usuario, negocio)` | Verifica membresía y fija el contexto (negocio, usuario, rol) |
| `app.modulos_visibles()` | Módulos del negocio: activo, bloqueado por plan o sugerido |
| `app.activar_modulo(m)` / `app.desactivar_modulo(m)` | Prende o apaga módulos respetando dependencias y núcleo |
| `catalogo.registrar_tipo_ia(...)` | Guarda un tipo nuevo propuesto por la IA, pendiente de revisión |

Regla de visibilidad: un módulo se ve si **su familia o el usuario lo prendió** y **el plan lo incluye**; si falta el plan, se muestra con candado. Una suscripción vencida baja a Gratis sin borrar datos.

## Correr en local

Requisitos: PostgreSQL 16 (con `pg_trgm`, `unaccent`, `pgcrypto`, `citext`) y Python 3 con `openpyxl`.

```bash
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres

python3 db/tools/generar_seed.py        # si cambiaste el Excel
PGDATABASE=alcien_dev bash db/scripts/reset.sh   # base de desarrollo con catálogo
bash db/scripts/test.sh                  # pruebas (usa la base alcien_test)
```

## Cambiar el catálogo

1. Edita `data/catalogo_plantillas_negocios.xlsx` (tipos, sinónimos, categorías, fichas).
2. Corre `python3 db/tools/generar_seed.py`.
3. Corre las pruebas y sube ambos archivos. La CI falla si el seed no coincide con el Excel.

Los negocios existentes no cambian: al registrarse recibieron una copia.

## Seguridad

- Nunca subas firmas electrónicas (`.p12`), contraseñas ni claves: van en Secret Manager.
- `db/scripts/reset.sh` se niega a borrar bases cuyo nombre contenga `prod`.

## Documentos de diseño

- Documento de diseño del sistema (arquitectura, módulos, SRI, planes, hoja de ruta y backlog).
- Marca Al Cien (sistema de diseño) y maquetas de pantallas.
