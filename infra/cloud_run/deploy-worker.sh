#!/usr/bin/env bash
# Despliega imfd-worker (misma imagen que imfd-backend, rol worker).
# Uso: ./infra/cloud_run/deploy-worker.sh IMAGE_TAG
#
# Ejemplo:
#   ./infra/cloud_run/deploy-worker.sh 3791498d9df89852531608e16d68019249488e23

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-titulo-grupo10}"
REGION="${GCP_REGION:-us-central1}"
IMAGE_TAG="${1:?IMAGE_TAG requerido (git sha o digest)}"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/imfd-backend/imfd-app:${IMAGE_TAG}"
SERVICE="imfd-worker"

echo "→ Desplegando ${SERVICE} con imagen ${IMAGE}"

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --no-allow-unauthenticated \
  --timeout=3600 \
  --memory=4Gi \
  --cpu=4 \
  --no-cpu-throttling \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars="IMFD_SERVICE_ROLE=worker,DEBUG=false"

WORKER_URL="$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')"

echo ""
echo "Worker URL: ${WORKER_URL}"
echo ""
echo "Siguiente paso — apuntar la API al worker:"
echo "  gcloud run services update imfd-backend \\"
echo "    --project=${PROJECT_ID} --region=${REGION} \\"
echo "    --update-env-vars=CLOUD_TASKS_WORKER_URL=${WORKER_URL}"
echo ""
echo "IAM invoker (si no existe):"
echo "  gcloud run services add-iam-policy-binding ${SERVICE} \\"
echo "    --project=${PROJECT_ID} --region=${REGION} \\"
echo "    --member='serviceAccount:imfd-tasks-invoker@${PROJECT_ID}.iam.gserviceaccount.com' \\"
echo "    --role='roles/run.invoker'"
