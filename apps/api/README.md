# apps/api

API de Al Cien en Node 22 + TypeScript, sin dependencias de ejecución. Rutas, seguridad y despliegue: ver el README principal.

- `src/db/pgwire.ts` — cliente PostgreSQL propio (SCRAM, TLS, socket Unix).
- `src/db/pool.ts` — pool, transacciones y `enNegocio()` (fija el negocio para la seguridad por fila).
- `src/http/` — servidor, errores y validación.
- `src/auth/` — códigos por WhatsApp, sesiones y límites.
- `src/ia/` — tipos de negocio nuevos con Gemini (opcional).
- `src/rutas/` — acceso, negocio, productos, ventas, caja y clientes.
- `test/` — pruebas contra PostgreSQL real (`bash scripts/test.sh`).
