#!/usr/bin/env bash
# Beta cerrada (WHATSAPP_PROVEEDOR=registro): muestra los códigos de acceso de los últimos 15 minutos.
# Solo quien tiene acceso al proyecto de Google Cloud puede verlos.
#   bash deploy/ver-codigos.sh
set -euo pipefail
SERVICIO="${SERVICIO:-alcien}"
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICIO\" AND jsonPayload.message=\"código de acceso\"" \
  --freshness=15m --limit=20 \
  --format='table(timestamp.date(format="%H:%M:%S", tz=LOCAL):label=HORA, jsonPayload.celular:label=CELULAR, jsonPayload.codigo:label=CÓDIGO)'
