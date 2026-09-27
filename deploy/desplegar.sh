#!/usr/bin/env bash
# Despliega Al Cien en Google Cloud: Cloud Run (app) + Cloud SQL (PostgreSQL 16) + Secret Manager
# + Cloud Scheduler (reintentos al SRI). Se puede correr las veces que haga falta: lo que ya existe
# se deja como está y el código se actualiza.
#
# En Google Cloud Shell (el botón "Abrir en Cloud Shell" del README lo deja todo listo):
#   bash deploy/desplegar.sh
# Si no hay proyecto elegido, crea uno y le vincula la facturación.
#
# Variables opcionales: REGION (us-east1), SERVICIO (alcien), INSTANCIA (alcien-db), TIER (db-f1-micro),
# WHATSAPP_PROVEEDOR (registro | meta; con meta hacen falta los secretos alcien-whatsapp-token y
# alcien-whatsapp-numero).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROYECTO="${PROYECTO:-}"
REGION="${REGION:-us-east1}"
SERVICIO="${SERVICIO:-alcien}"
INSTANCIA="${INSTANCIA:-alcien-db}"
BASE="${BASE:-alcien}"
TIER="${TIER:-db-f1-micro}"
WHATSAPP_PROVEEDOR="${WHATSAPP_PROVEEDOR:-registro}"
CUENTA_NOMBRE="alcien-run"
PUERTO_PROXY=6543

paso() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
fallar() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

preguntar() {   # texto, valor por defecto → respuesta
  local r
  read -r -p "$1 [$2]: " r </dev/tty || true
  printf '%s' "${r:-$2}"
}

# ---------- 0. Proyecto y facturación (se crean si hace falta) ----------
if [[ -z "$PROYECTO" || "$PROYECTO" == "(unset)" ]]; then
  paso "Proyecto de Google Cloud"
  # Nunca se usa por sorpresa otro proyecto: solo se sugiere uno que se llame alcien…
  ACTUAL="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ "$ACTUAL" == alcien* ]]; then EXISTENTES="$ACTUAL"; else
    EXISTENTES="$(gcloud projects list --format='value(projectId)' --filter='projectId~^alcien' 2>/dev/null | head -1)"
  fi
  if [[ -n "$EXISTENTES" ]]; then
    PROYECTO="$(preguntar "Encontré el proyecto $EXISTENTES. ¿Uso ese? Escribe otro ID si no" "$EXISTENTES")"
  else
    PROYECTO="$(preguntar "Nombre (ID) del proyecto nuevo" "alcien-$(openssl rand -hex 3)")"
  fi
  if ! gcloud projects describe "$PROYECTO" >/dev/null 2>&1; then
    gcloud projects create "$PROYECTO" --name "Al Cien" --quiet || fallar "No se pudo crear el proyecto $PROYECTO (prueba con otro nombre)"
    ok "proyecto $PROYECTO creado"
  fi
fi
gcloud config set project "$PROYECTO" >/dev/null 2>&1

FACTURACION="$(gcloud billing projects describe "$PROYECTO" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "$FACTURACION" != "True" ]]; then
  paso "Facturación del proyecto"
  mapfile -t CUENTAS < <(gcloud billing accounts list --filter=open=true --format='value(name.basename(),displayName)' 2>/dev/null)
  if [[ ${#CUENTAS[@]} -eq 0 ]]; then
    echo "  Tu cuenta de Google todavía no tiene una forma de pago en Google Cloud."
    echo "  Créala aquí (tarjeta de crédito o débito) y vuelve a correr este comando:"
    echo "    https://console.cloud.google.com/billing/create"
    exit 1
  fi
  ELEGIDA="${CUENTAS[0]%%$'\t'*}"
  if [[ ${#CUENTAS[@]} -gt 1 ]]; then
    for i in "${!CUENTAS[@]}"; do echo "  $((i + 1)). ${CUENTAS[$i]//$'\t'/ · }"; done
    N="$(preguntar "¿Con cuál cuenta de facturación pago?" 1)"
    ELEGIDA="${CUENTAS[$((N - 1))]%%$'\t'*}"
  fi
  gcloud billing projects link "$PROYECTO" --billing-account "$ELEGIDA" --quiet >/dev/null ||
    fallar "No se pudo activar la facturación. Hazlo en https://console.cloud.google.com/billing/linkedaccount?project=$PROYECTO"
  ok "facturación activa"
fi
NUMERO_PROYECTO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')"
CUENTA="${CUENTA_NOMBRE}@${PROYECTO}.iam.gserviceaccount.com"
echo "Proyecto: $PROYECTO · Región: $REGION"

# ---------- 1. Servicios de Google Cloud ----------
paso "Activando los servicios de Google Cloud"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com \
  iam.googleapis.com cloudresourcemanager.googleapis.com --quiet
ok "servicios activos"

# ---------- 2. Secretos (se generan solos y nunca salen de Google Cloud) ----------
paso "Creando los secretos"
existe_secreto() { gcloud secrets describe "$1" >/dev/null 2>&1; }
crear_secreto() {   # nombre, valor
  if existe_secreto "$1"; then ok "$1 (ya existía)"; return; fi
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic --quiet >/dev/null
  ok "$1"
}
leer_secreto() { gcloud secrets versions access latest --secret "$1"; }

crear_secreto alcien-secreto-codigos "$(openssl rand -base64 48 | tr -d '\n')"
crear_secreto alcien-clave-firmas   "$(openssl rand -base64 32 | tr -d '\n')"
crear_secreto alcien-token-tareas   "$(openssl rand -hex 32)"
crear_secreto alcien-db-api         "$(openssl rand -hex 24)"
crear_secreto alcien-db-admin       "$(openssl rand -hex 24)"
if [[ "$WHATSAPP_PROVEEDOR" == "meta" ]]; then
  existe_secreto alcien-whatsapp-token && existe_secreto alcien-whatsapp-numero ||
    fallar "Para WHATSAPP_PROVEEDOR=meta crea antes los secretos alcien-whatsapp-token y alcien-whatsapp-numero"
fi

# ---------- 3. Cuenta de servicio de la app ----------
paso "Preparando los permisos"
if ! gcloud iam service-accounts describe "$CUENTA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$CUENTA_NOMBRE" --display-name "Al Cien (Cloud Run)" --quiet
fi
for rol in roles/cloudsql.client roles/secretmanager.secretAccessor roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROYECTO" --member "serviceAccount:$CUENTA" --role "$rol" \
    --condition=None --quiet >/dev/null
done
# Cloud Build compila la imagen con la cuenta por defecto de Compute Engine
gcloud projects add-iam-policy-binding "$PROYECTO" \
  --member "serviceAccount:${NUMERO_PROYECTO}-compute@developer.gserviceaccount.com" \
  --role roles/run.builder --condition=None --quiet >/dev/null
ok "cuenta $CUENTA"

# ---------- 4. Base de datos ----------
paso "Base de datos PostgreSQL 16 (la primera vez tarda 10–15 minutos)"
if ! gcloud sql instances describe "$INSTANCIA" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCIA" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier="$TIER" --region="$REGION" \
    --storage-size=10 --storage-auto-increase --availability-type=zonal \
    --backup-start-time=08:00 --enable-point-in-time-recovery \
    --root-password="$(leer_secreto alcien-db-admin)" --quiet
else
  ok "la instancia $INSTANCIA ya existía"
fi
gcloud sql databases describe "$BASE" --instance "$INSTANCIA" >/dev/null 2>&1 ||
  gcloud sql databases create "$BASE" --instance "$INSTANCIA" --quiet
gcloud sql users set-password postgres --instance "$INSTANCIA" --password "$(leer_secreto alcien-db-admin)" --quiet >/dev/null
CONEXION="$(gcloud sql instances describe "$INSTANCIA" --format='value(connectionName)')"
ok "base $BASE en $CONEXION"

# ---------- 5. Migraciones y catálogo ----------
paso "Aplicando el esquema y el catálogo de plantillas"
PROXY="$(command -v cloud-sql-proxy || true)"
if [[ -z "$PROXY" ]]; then
  PROXY="$HOME/.local/bin/cloud-sql-proxy"
  mkdir -p "$(dirname "$PROXY")"
  curl -fsSL -o "$PROXY" https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64
  chmod +x "$PROXY"
fi
command -v psql >/dev/null || fallar "Falta psql (en Cloud Shell viene instalado)"
"$PROXY" --port "$PUERTO_PROXY" "$CONEXION" >/tmp/alcien-proxy.log 2>&1 &
PID_PROXY=$!
trap 'kill $PID_PROXY 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "$PUERTO_PROXY" >/dev/null 2>&1 && break
  sleep 1
done
pg_isready -h 127.0.0.1 -p "$PUERTO_PROXY" >/dev/null 2>&1 || { cat /tmp/alcien-proxy.log; fallar "No se pudo conectar a la base"; }

export PGHOST=127.0.0.1 PGPORT=$PUERTO_PROXY PGUSER=postgres PGDATABASE="$BASE"
PGPASSWORD="$(leer_secreto alcien-db-admin)"
export PGPASSWORD
bash db/scripts/migrate.sh
psql -X -q -v ON_ERROR_STOP=1 -1 -f db/seed/catalogo.sql
ALCIEN_API_PASSWORD="$(leer_secreto alcien-db-api)" bash db/scripts/crear_usuario_api.sh >/dev/null
TIPOS="$(psql -X -tAc "select count(*) from catalogo.tipo_negocio")"
ok "esquema al día · $TIPOS tipos de negocio en el catálogo"
kill "$PID_PROXY" 2>/dev/null || true

# ---------- 6. La app en Cloud Run ----------
paso "Compilando y publicando la app (5–8 minutos)"
VARIABLES="PGHOST=/cloudsql/$CONEXION,PGUSER=alcien_api,PGDATABASE=$BASE,WHATSAPP_PROVEEDOR=$WHATSAPP_PROVEEDOR,SRI_INTERVALO_SEG=0"
SECRETOS="PGPASSWORD=alcien-db-api:latest,ALCIEN_SECRETO_CODIGOS=alcien-secreto-codigos:latest,ALCIEN_CLAVE_FIRMAS=alcien-clave-firmas:latest,ALCIEN_TOKEN_TAREAS=alcien-token-tareas:latest"
if [[ "$WHATSAPP_PROVEEDOR" == "registro" ]]; then
  VARIABLES="$VARIABLES,ALCIEN_PERMITIR_CODIGOS_EN_REGISTRO=true"
else
  SECRETOS="$SECRETOS,WHATSAPP_TOKEN=alcien-whatsapp-token:latest,WHATSAPP_PHONE_NUMBER_ID=alcien-whatsapp-numero:latest"
fi
if existe_secreto alcien-gemini; then SECRETOS="$SECRETOS,GEMINI_API_KEY=alcien-gemini:latest"; fi

gcloud run deploy "$SERVICIO" --source . --region "$REGION" \
  --service-account "$CUENTA" --add-cloudsql-instances "$CONEXION" \
  --allow-unauthenticated --memory 512Mi --cpu 1 --min-instances 0 --max-instances 3 --concurrency 40 \
  --set-env-vars "$VARIABLES" --set-secrets "$SECRETOS" --quiet
URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
ok "publicada en $URL"

# ---------- 7. Reintentos al SRI cada 5 minutos ----------
paso "Programando los reintentos al SRI"
TOKEN="$(leer_secreto alcien-token-tareas)"
ARGS=(--location "$REGION" --schedule "*/5 * * * *" --uri "$URL/api/tareas/sri" --http-method POST
      --headers "Authorization=Bearer $TOKEN" --time-zone "America/Guayaquil" --attempt-deadline 120s --quiet)
if gcloud scheduler jobs describe alcien-sri --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http alcien-sri "${ARGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http alcien-sri "${ARGS[@]}" >/dev/null
fi
ok "tarea alcien-sri"

# ---------- 8. Comprobación ----------
paso "Comprobando"
for _ in $(seq 1 10); do
  curl -fsS "$URL/api/salud" >/dev/null 2>&1 && break
  sleep 3
done
curl -fsS "$URL/api/salud" >/dev/null || fallar "La app no responde: revisa los registros con  gcloud run services logs read $SERVICIO --region $REGION"
ok "la app responde"

printf '\n\033[1;32m¡Listo! Abre Al Cien en: %s\033[0m\n' "$URL"
if [[ "$WHATSAPP_PROVEEDOR" == "registro" ]]; then
  echo "Beta cerrada: los códigos de acceso NO llegan por WhatsApp todavía. Para verlos:"
  echo "  bash deploy/ver-codigos.sh"
fi
