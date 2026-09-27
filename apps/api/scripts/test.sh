#!/usr/bin/env bash
# Prepara una base limpia para las pruebas de la API y las corre.
# Usa PGHOST/PGUSER/PGPASSWORD de un usuario administrador para crear la base,
# y el usuario alcien_api (sin privilegios) para las pruebas.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export PGDATABASE_API="${PGDATABASE_API:-alcien_api_test}"
export PGPASSWORD_API="${PGPASSWORD_API:-alcien-dev}"

if [[ "${SALTAR_RESET:-}" != "1" ]]; then
  PGDATABASE="$PGDATABASE_API" bash "$RAIZ/db/scripts/reset.sh" > /dev/null
  PGDATABASE="$PGDATABASE_API" ALCIEN_API_PASSWORD="$PGPASSWORD_API" bash "$RAIZ/db/scripts/crear_usuario_api.sh" > /dev/null
fi

cd "$RAIZ/apps/api"
exec npx tsx --test --test-concurrency=1 test/*.test.ts
