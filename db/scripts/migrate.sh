#!/usr/bin/env bash
# Aplica las migraciones pendientes de db/migrations en orden.
# Usa las variables estándar de PostgreSQL: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -c "create table if not exists public.schema_migrations (
  version text primary key,
  aplicada_en timestamptz not null default now()
);"

for f in "$DIR"/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  ya="$("${PSQL[@]}" -tAc "select 1 from public.schema_migrations where version = '$v'")"
  if [[ "$ya" == "1" ]]; then
    continue
  fi
  echo "→ migración $v"
  "${PSQL[@]}" -1 -f "$f" -c "insert into public.schema_migrations (version) values ('$v');"
done
