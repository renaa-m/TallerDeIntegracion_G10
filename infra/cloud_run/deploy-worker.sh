#!/usr/bin/env bash
# Despliega imfd-worker (misma imagen que imfd-backend, rol worker).
# Copia env vars del backend y ajusta rol + OIDC audience del worker.
#
# Uso: ./infra/cloud_run/deploy-worker.sh IMAGE_TAG
#
# Ejemplo:
#   ./infra/cloud_run/deploy-worker.sh 77ff38f3fbaae7f250533bb19a85dfcc654858e1

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-titulo-grupo10}"
REGION="${GCP_REGION:-us-central1}"
IMAGE_TAG="${1:?IMAGE_TAG requerido (git sha o digest)}"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/imfd-backend/imfd-app:${IMAGE_TAG}"
SERVICE="imfd-worker"
BACKEND="imfd-backend"

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
  --update-env-vars="IMFD_SERVICE_ROLE=worker,DEBUG=false" \
  --to-latest

WORKER_URL="$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')"

echo "→ Sincronizando env vars desde ${BACKEND} (sin pisar secrets manualmente)..."

python3 << PYEOF
import json, subprocess, sys, yaml

project, region = "${PROJECT_ID}", "${REGION}"
backend, worker = "${BACKEND}", "${SERVICE}"
worker_url = "${WORKER_URL}"

result = subprocess.run(
    [
        "gcloud", "run", "services", "describe", backend,
        f"--project={project}", f"--region={region}", "--format=json",
    ],
    capture_output=True,
    text=True,
    check=True,
)
env = {
    e["name"]: e.get("value", "")
    for e in json.loads(result.stdout)["spec"]["template"]["spec"]["containers"][0].get("env", [])
}

worker_env = {
    "IMFD_SERVICE_ROLE": "worker",
    "DEBUG": "false",
    "CLOUD_TASKS_SERVICE_URL": worker_url,
    "CLOUD_TASKS_QUEUE": "imfd-processing-v2",
}
for key in [
    "OPENAI_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "SUPABASE_SERVICE_KEY",
    "GCP_PROJECT_ID",
    "CLOUD_TASKS_LOCATION",
    "CLOUD_TASKS_INVOKER_SA",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "MILLENNIUMDB_HOST",
    "MILLENNIUMDB_PORT",
]:
    if env.get(key):
        worker_env[key] = env[key]

path = "/tmp/imfd-worker-env.yaml"
with open(path, "w") as f:
    yaml.dump(worker_env, f, default_flow_style=False)

subprocess.run(
    [
        "gcloud", "run", "services", "update", worker,
        f"--project={project}", f"--region={region}",
        f"--env-vars-file={path}", "--quiet",
    ],
    check=True,
)
subprocess.run(
    [
        "gcloud", "run", "services", "update-traffic", worker,
        f"--project={project}", f"--region={region}", "--to-latest", "--quiet",
    ],
    check=True,
)
print(f"Worker listo: {worker_url} ({len(worker_env)} env vars)")
PYEOF

echo ""
echo "Worker URL: ${WORKER_URL}"
echo ""
echo "Verificar backend apunta al worker:"
echo "  CLOUD_TASKS_WORKER_URL=${WORKER_URL}"
echo "  CLOUD_TASKS_QUEUE=imfd-processing-v2"
echo ""
echo "IAM invoker (si no existe):"
echo "  gcloud run services add-iam-policy-binding ${SERVICE} \\"
echo "    --project=${PROJECT_ID} --region=${REGION} \\"
echo "    --member='serviceAccount:imfd-tasks-invoker@${PROJECT_ID}.iam.gserviceaccount.com' \\"
echo "    --role='roles/run.invoker'"
