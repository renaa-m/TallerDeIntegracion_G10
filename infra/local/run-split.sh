#!/usr/bin/env bash
# Levanta API + worker en local para probar feature/background-processing.
#
# Uso:
#   ./infra/local/run-split.sh worker   # terminal 1
#   ./infra/local/run-split.sh api      # terminal 2
#
# Requiere backend/.env con Supabase, Auth0, OpenAI, etc.
# En .env (solo para la API):
#   IMFD_SERVICE_ROLE=api
#   DEV_WORKER_HTTP_URL=http://127.0.0.1:8081
#   DEBUG=true
# Dejar vacías CLOUD_TASKS_* (no hace falta GCP para este modo).
#
# Worker (terminal 1): IMFD_SERVICE_ROLE=worker, sin DEV_WORKER_HTTP_URL.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}/backend"

ROLE="${1:-}"

if [[ ! -d venv ]]; then
  echo "Crea el venv primero: cd backend && python3 -m venv venv && pip install -r requirements.txt"
  exit 1
fi

# shellcheck disable=SC1091
source venv/bin/activate

case "${ROLE}" in
  worker)
    export IMFD_SERVICE_ROLE=worker
    unset DEV_WORKER_HTTP_URL 2>/dev/null || true
    echo "→ Worker en http://127.0.0.1:8081 (solo /health + /internal/tasks/run)"
    exec uvicorn app.main:app --reload --port 8081 --host 127.0.0.1
    ;;
  api)
    export IMFD_SERVICE_ROLE=api
    export DEV_WORKER_HTTP_URL="${DEV_WORKER_HTTP_URL:-http://127.0.0.1:8081}"
    echo "→ API en http://127.0.0.1:8080 (DEV_WORKER_HTTP_URL=${DEV_WORKER_HTTP_URL})"
    exec uvicorn app.main:app --reload --port 8080 --host 127.0.0.1
    ;;
  *)
    echo "Uso: $0 {api|worker}"
    exit 1
    ;;
esac
