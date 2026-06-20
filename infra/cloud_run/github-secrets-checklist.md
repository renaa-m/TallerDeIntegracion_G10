# GitHub Secrets — CD (`imfd-backend`)

Secrets requeridos en **Settings → Secrets and variables → Actions** del repo.

| Secret | Ejemplo / notas |
|--------|------------------|
| `GCP_SA_KEY` | JSON service account con deploy Cloud Run |
| `GCP_PROJECT_ID` | `titulo-grupo10` |
| `GCP_REGION` | `us-central1` |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | Anon key |
| `SUPABASE_SERVICE_KEY` | Service role key |
| `OPENAI_API_KEY` | OpenAI / Wukong |
| `AUTH0_*` | Domain, audience, M2M client/secret |
| `MILLENNIUMDB_HOST` / `MILLENNIUMDB_PORT` | Host del grafo |
| `GCP_VISION_KEY` | JSON credenciales Vision OCR |
| `HF_TOKEN` | Opcional, modelo embeddings |
| `SUBMODULES_PAT` | PAT para submodule `wukong-engine` |
| `VITE_AUTH0_*` | Build frontend en Docker |
| **`CLOUD_TASKS_LOCATION`** | `us-central1` |
| **`CLOUD_TASKS_SERVICE_URL`** | URL pública del **backend** (`imfd-backend-…run.app`) |
| **`CLOUD_TASKS_WORKER_URL`** | URL pública del **worker** (`imfd-worker-…run.app`) |
| **`CLOUD_TASKS_INVOKER_SA`** | `imfd-tasks-invoker@titulo-grupo10.iam.gserviceaccount.com` |

## Cola Cloud Tasks (no va en secret)

En `.github/workflows/cd.yml` la cola está **hardcodeada** como `imfd-processing-v2`
(la cola `imfd-processing` no existe en GCP).

Si tenés el secret legacy `CLOUD_TASKS_QUEUE=imfd-processing`, **podés borrarlo**
o actualizarlo a `imfd-processing-v2`; el CD ya no lo usa.

## Worker manual

Tras cada CD del backend, desplegar el worker con la misma imagen:

```bash
./infra/cloud_run/deploy-worker.sh <git-sha>
```

El script copia env vars del backend, fuerza `CLOUD_TASKS_QUEUE=imfd-processing-v2`
y `CLOUD_TASKS_SERVICE_URL` = URL del worker (audience OIDC).
