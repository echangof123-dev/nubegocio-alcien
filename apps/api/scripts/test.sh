#!/usr/bin/env bash
# Prepara una base limpia para las pruebas de la API y las corre.
# Usa PGHOST/PGUSER/PGPASSWORD de un usuario administrador para crear la base,
# y el usuario alcien_api (sin privilegios) para las pruebas.
#
# SIN_ROLES=1: simula un PostgreSQL administrado que no deja crear usuarios (como algunos
# planes de Render): la base es de una dueña sin CREATEROLE, la migra la propia app y la API
# se conecta con esa dueña, sujeta igual a la seguridad por fila.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export PGDATABASE_API="${PGDATABASE_API:-alcien_api_test}"
export PGPASSWORD_API="${PGPASSWORD_API:-alcien-dev}"

if [[ "${SIN_ROLES:-}" == "1" ]]; then
  DUENA=alcien_duena
  psql -X -q -d postgres -v ON_ERROR_STOP=1 <<SQL
drop database if exists "$PGDATABASE_API";
drop role if exists $DUENA;
create role $DUENA login password '$PGPASSWORD_API' nosuperuser nocreaterole nocreatedb;
create database "$PGDATABASE_API" owner $DUENA;
SQL
  cd "$RAIZ/apps/api"
  export ALCIEN_DB_ADMIN_URL="postgres://$DUENA:$PGPASSWORD_API@${PGHOST_API:-127.0.0.1}:${PGPORT:-5432}/$PGDATABASE_API"
  npx tsx scripts/migrar-local.ts
  unset ALCIEN_DB_ADMIN_URL   # las pruebas se conectan directo con la dueña
  export PGUSER_API="$DUENA"
  # La prueba de migrar crea sus propias bases como administrador: no aplica aquí
  exec npx tsx --test --test-concurrency=1 $(ls test/*.test.ts | grep -v migrar)
fi

if [[ "${SALTAR_RESET:-}" != "1" ]]; then
  PGDATABASE="$PGDATABASE_API" bash "$RAIZ/db/scripts/reset.sh" > /dev/null
  PGDATABASE="$PGDATABASE_API" ALCIEN_API_PASSWORD="$PGPASSWORD_API" bash "$RAIZ/db/scripts/crear_usuario_api.sh" > /dev/null
fi

cd "$RAIZ/apps/api"
exec npx tsx --test --test-concurrency=1 test/*.test.ts
