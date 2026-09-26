#!/usr/bin/env bash
# Crea una base de pruebas limpia y corre cada archivo de db/tests.
# Cada prueba corre en una transacción que se revierte al final.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGDATABASE="${PGDATABASE_TEST:-alcien_test}"

bash "$DIR/scripts/reset.sh" > /dev/null

fallos=0
for f in "$DIR"/tests/*.sql; do
  nombre="$(basename "$f")"
  if salida="$(psql -X -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "✔ $nombre"
  else
    echo "✘ $nombre"
    echo "$salida" | sed 's/^/    /'
    fallos=$((fallos + 1))
  fi
done

if [[ $fallos -gt 0 ]]; then
  echo "$fallos archivo(s) con fallas."
  exit 1
fi
echo "Todas las pruebas pasaron."
