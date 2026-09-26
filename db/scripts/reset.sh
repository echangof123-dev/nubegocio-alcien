#!/usr/bin/env bash
# Borra y vuelve a crear la base de datos, aplica migraciones y carga el catálogo.
# SOLO para desarrollo y pruebas. Nunca contra producción.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${PGDATABASE:-alcien_dev}"

if [[ "$DB" == *prod* ]]; then
  echo "Me niego a borrar una base que parece de producción: $DB" >&2
  exit 1
fi

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\";" -c "create database \"$DB\";"
PGDATABASE="$DB" bash "$DIR/scripts/migrate.sh"
PGDATABASE="$DB" psql -X -q -v ON_ERROR_STOP=1 -1 -f "$DIR/seed/catalogo.sql"
echo "Base $DB lista."
