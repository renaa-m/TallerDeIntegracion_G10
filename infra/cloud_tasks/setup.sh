#!/usr/bin/env bash
# Crea la cola de Cloud Tasks para el pipeline de procesamiento IMFD.
# Uso: ./infra/cloud_tasks/setup.sh PROJECT_ID REGION QUEUE_NAME SERVICE_URL
#
# Ejemplo:
#   ./infra/cloud_tasks/setup.sh titulo-grupo10 us-central1 imfd-processing \
#     https://imfd-backend-xxxxx-uc.a.run.app

set -euo pipefail

PROJECT_ID="${1:?PROJECT_ID requerido}"
REGION="${2:-us-central1}"
QUEUE_NAME="${3:-imfd-processing}"
SERVICE_URL="${4:-}"

SA_NAME="imfd-tasks-invoker"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${5:-}"  # opcional: SA de Cloud Run que encola tasks

echo "→ Proyecto: ${PROJECT_ID}"
echo "→ Cola: ${QUEUE_NAME} (${REGION})"

gcloud config set project "${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${SA_EMAIL}" &>/dev/null; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="IMFD Cloud Tasks invoker"
fi

gcloud tasks queues describe "${QUEUE_NAME}" --location="${REGION}" &>/dev/null || \
  gcloud tasks queues create "${QUEUE_NAME}" \
    --location="${REGION}" \
    --max-concurrent-dispatches=2 \
    --max-dispatches-per-second=1 \
    --max-attempts=3 \
    --min-backoff=30s \
    --max-backoff=600s

# Permiso para que Cloud Tasks llame al worker HTTP (Cloud Run).
if [[ -n "${SERVICE_URL}" ]]; then
  RUN_SERVICE="$(gcloud run services list --region="${REGION}" --format='value(metadata.name)' | head -1)"
  if [[ -n "${RUN_SERVICE}" ]]; then
    gcloud run services add-iam-policy-binding "${RUN_SERVICE}" \
      --region="${REGION}" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="roles/run.invoker" \
      --quiet || true
  fi
fi

# SA de runtime (Cloud Run) puede encolar tasks.
if [[ -n "${RUNTIME_SA}" ]]; then
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/cloudtasks.enqueuer" \
    --quiet
fi

cat <<EOF

Cola creada. Variables para backend (.env / Cloud Run):

  GCP_PROJECT_ID=${PROJECT_ID}
  CLOUD_TASKS_QUEUE=${QUEUE_NAME}
  CLOUD_TASKS_LOCATION=${REGION}
  CLOUD_TASKS_SERVICE_URL=${SERVICE_URL:-https://TU-SERVICIO.run.app}
  CLOUD_TASKS_INVOKER_SA=${SA_EMAIL}

Asegúrate de que la SA de Cloud Run tenga roles/cloudtasks.enqueuer.

EOF
