#!/usr/bin/env bash
# Despliegue en Google Cloud: Cloud SQL (PostgreSQL) + Cloud Run.
#
# Correr desde la raiz del repositorio, con gcloud ya instalado y autenticado:
#   gcloud auth login
#   bash deploy/desplegar-gcp.sh
#
# Es idempotente: si algo ya existe, lo reutiliza en vez de fallar.
set -euo pipefail

PROYECTO="${PROYECTO:-subtle-canto-478007-n2}"
REGION="${REGION:-us-central1}"
INSTANCIA="${INSTANCIA:-case-uml-db}"
BD="${BD:-case_db}"
USUARIO_BD="${USUARIO_BD:-case_user}"
SERVICIO="${SERVICIO:-sw1-uml}"

echo "==> Proyecto: $PROYECTO | Region: $REGION"
gcloud config set project "$PROYECTO" >/dev/null

echo "==> Habilitando las APIs que hacen falta"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com

# --------------------------------------------------------------- contrasenas
# Se generan aca y se guardan en Secret Manager: no quedan en el historial de la
# terminal ni en ningun archivo del repositorio.
crear_secreto() {
  local nombre="$1" valor="$2"
  if gcloud secrets describe "$nombre" >/dev/null 2>&1; then
    echo "    $nombre ya existe, se reutiliza"
  else
    printf '%s' "$valor" | gcloud secrets create "$nombre" --data-file=- >/dev/null
    echo "    $nombre creado"
  fi
}

echo "==> Secretos"
PASS_BD="$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 24)"
SECRETO_AUTH="$(openssl rand -base64 48 | tr -d '\n')"
CODIGO_REGISTRO="$(openssl rand -hex 4)"
crear_secreto "case-db-password" "$PASS_BD"
crear_secreto "case-auth-secret" "$SECRETO_AUTH"
crear_secreto "case-registro-codigo" "$CODIGO_REGISTRO"

# Se releen: si ya existian, los valores buenos son los guardados.
PASS_BD="$(gcloud secrets versions access latest --secret=case-db-password)"
CODIGO_REGISTRO="$(gcloud secrets versions access latest --secret=case-registro-codigo)"

# ---------------------------------------------------------------- Cloud SQL
echo "==> Cloud SQL (PostgreSQL 16)"
if gcloud sql instances describe "$INSTANCIA" >/dev/null 2>&1; then
  echo "    la instancia ya existe"
else
  # db-f1-micro es la mas barata; alcanza de sobra para esta aplicacion.
  gcloud sql instances create "$INSTANCIA" \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=10GB \
    --storage-auto-increase
fi

gcloud sql databases create "$BD" --instance="$INSTANCIA" 2>/dev/null || echo "    la base ya existe"
if gcloud sql users list --instance="$INSTANCIA" --format='value(name)' | grep -qx "$USUARIO_BD"; then
  gcloud sql users set-password "$USUARIO_BD" --instance="$INSTANCIA" --password="$PASS_BD"
else
  gcloud sql users create "$USUARIO_BD" --instance="$INSTANCIA" --password="$PASS_BD"
fi

CONEXION="$(gcloud sql instances describe "$INSTANCIA" --format='value(connectionName)')"
echo "    conexion: $CONEXION"

# ----------------------------------------------------------------- Cloud Run
echo "==> Construyendo y desplegando en Cloud Run"
# El socket de Cloud SQL se monta en /cloudsql/<conexion>: por eso el host de la
# cadena de conexion es una ruta y no una IP.
URL_BD="postgresql://${USUARIO_BD}:${PASS_BD}@localhost/${BD}?host=/cloudsql/${CONEXION}"

gcloud run deploy "$SERVICIO" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CONEXION" \
  --memory 1Gi \
  --timeout 3600 \
  --set-env-vars "DATABASE_URL=${URL_BD}" \
  --set-env-vars "AUTH_REQUIRED=true" \
  --set-env-vars "AI_STRATEGY=cloud" \
  --set-env-vars "CORS_ORIGIN=*" \
  --set-secrets "AUTH_SECRET=case-auth-secret:latest" \
  --set-secrets "REGISTRO_CODIGO=case-registro-codigo:latest"

URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"

echo
echo "=================================================================="
echo " Listo: $URL"
echo
echo " Codigo de registro: $CODIGO_REGISTRO"
echo "   Se pide al crear una cuenta. Compartilo solo con tu equipo."
echo
echo " Para que funcione la IA hace falta una clave de OpenAI:"
echo "   gcloud run services update $SERVICIO --region $REGION \\"
echo "     --set-env-vars OPENAI_API_KEY=tu-clave"
echo "   (en la nube no hay Ollama: la IA local es del escritorio y del telefono)"
echo "=================================================================="
