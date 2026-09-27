#!/usr/bin/env bash
# Crea (o actualiza) el usuario con el que se conecta la API.
# Hereda los permisos de alcien_app y NO se salta la seguridad por fila.
#
#   ALCIEN_API_PASSWORD=... bash db/scripts/crear_usuario_api.sh
set -euo pipefail

: "${ALCIEN_API_PASSWORD:?Define ALCIEN_API_PASSWORD}"
USUARIO="${ALCIEN_API_USUARIO:-alcien_api}"

psql -X -q -v ON_ERROR_STOP=1 \
  -v usuario="$USUARIO" -v clave="$ALCIEN_API_PASSWORD" <<'SQL'
select format('create role %I login nobypassrls in role alcien_app', :'usuario')
where not exists (select 1 from pg_roles where rolname = :'usuario') \gexec
select format('alter role %I with login nobypassrls password %L', :'usuario', :'clave') \gexec
SQL
echo "Usuario $USUARIO listo."
