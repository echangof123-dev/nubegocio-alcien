# apps/api

API de Al Cien (Node 22 + TypeScript). Siguiente paso de la etapa 1.

Plan:

- Fastify + `pg`, conectada como el rol `alcien_app`.
- Cada petición autenticada abre una transacción y llama a `app.entrar_negocio(usuario, negocio)` antes de cualquier consulta.
- Endpoints de la etapa 1:
  - `POST /auth/codigo` → envía el código de 6 dígitos por WhatsApp.
  - `POST /auth/verificar` → valida el código y crea la sesión.
  - `GET /tipos-negocio?q=` → `catalogo.buscar_tipos`.
  - `POST /negocios` → `app.crear_negocio` (con respaldo de IA si no hay tipo).
  - `GET /negocios/actual/modulos` → `app.modulos_visibles`.
