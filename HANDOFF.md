# Guía de Traspaso — Plataforma de Exploración Documental IMFD

> Este documento está dirigido al equipo técnico del IMFD que hereda el sistema. Explica qué servicios externos sostienen la plataforma, cuáles quedan ligados a cuentas del equipo de desarrollo, y los pasos para reconectarlos en infraestructura propia.

---

## Índice

1. [Panorama general](#1-panorama-general)
2. [Servicios a reconectar](#2-servicios-a-reconectar)
3. [Supabase](#3-supabase)
4. [Auth0](#4-auth0)
5. [Google Cloud Platform (GCP)](#5-google-cloud-platform-gcp)
6. [OpenAI](#6-openai)
7. [Wukong (submodule GitHub)](#7-wukong-submodule-github)
8. [Variables de entorno — referencia completa](#8-variables-de-entorno--referencia-completa)
9. [GitHub Actions — secrets del repositorio](#9-github-actions--secrets-del-repositorio)
10. [Orden recomendado de reconexión](#10-orden-recomendado-de-reconexión)
11. [Verificación final](#11-verificación-final)

---

## 1. Panorama general

La plataforma es una aplicación web desplegada en contenedor Docker sobre **Google Cloud Run**. El backend (FastAPI) sirve también el frontend compilado (React), por lo que hay un único servicio en producción.

Al terminar el proyecto académico, el equipo de desarrollo se desconectará de todos los servicios listados a continuación. Sin reconectarlos en cuentas propias del IMFD, el sistema dejará de funcionar completamente.

> **Los datos del prototipo no se migran automáticamente.** Si el IMFD necesita conservar documentos, colecciones, embeddings o grafos `.qm` generados durante el proyecto, deben exportarse de Supabase antes del cierre. Ver nota de exportación en la sección 3.

---

## 2. Servicios a reconectar

| Servicio | Qué rompe sin él |
|---|---|
| **Supabase** | Base de datos, Storage y búsqueda semántica |
| **Auth0** | Login de usuarios |
| **GCP** (Cloud Run, Artifact Registry, Cloud Tasks, Vision API) | Deploy, cola de procesamiento y OCR |
| **OpenAI** | Extracción de entidades y relaciones por Wukong |
| **Wukong** (repo privado GitHub del IMFD) | Construcción del grafo de conocimiento |

**Nota sobre OpenAI:** la API key actualmente en producción pertenece al equipo de desarrollo y se desconectará junto con el resto de los servicios. El IMFD debe proveer su propia key antes de levantar el sistema. Sin ella, Wukong no puede procesar ninguna colección.

---

## 3. Supabase

### Qué hace en este sistema

- **PostgreSQL + pgvector**: almacena colecciones, documentos, textos extraídos y chunks con embeddings vectoriales.
- **Storage**: guarda archivos originales (PDF/TXT) y grafos `.qm` generados por Wukong. El bucket se llama `documentos`.
- **RPC `search_chunks`**: función SQL que ejecuta la búsqueda semántica por similitud coseno (índice HNSW).

### Variables que controla

```
SUPABASE_URL
SUPABASE_KEY          (anon key — usada en CI y en el frontend embebido)
SUPABASE_SERVICE_KEY  (service_role key — bypasea RLS; usada por el backend en producción)
```

### Pasos para reconectar

**1. Crear el proyecto**

Ir a [supabase.com](https://supabase.com) → New project. Elegir una región cercana a la de Cloud Run (`us-central1` o equivalente).

**2. Habilitar pgvector**

En el SQL Editor del proyecto:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**3. Aplicar las migraciones**

Las 15 migraciones están en `backend/supabase/migrations/`, numeradas en orden. Ejecutarlas en secuencia desde el SQL Editor o con la CLI:

```bash
supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
```

Las migraciones crean el esquema completo: tablas, índices HNSW, la función RPC `search_chunks`, políticas RLS y el bucket `documentos`.

**4. Obtener las credenciales**

En Project Settings → API:

- **Project URL** → `SUPABASE_URL`
- **anon / public key** → `SUPABASE_KEY`
- **service_role key** → `SUPABASE_SERVICE_KEY`

> La `service_role` key nunca debe exponerse en el frontend. Solo el backend la usa en servidor.

### Exportar datos del prototipo (si aplica)

```bash
pg_dump "postgresql://postgres:<password>@<host>:5432/postgres" \
  --no-owner --no-acl -Fc -f backup.dump

pg_restore --clean --no-owner --no-acl \
  -d "postgresql://postgres:<nueva-password>@<nuevo-host>:5432/postgres" \
  backup.dump
```

Los archivos de Storage deben descargarse por separado via la API o interfaz de Supabase.

---

## 4. Auth0

### Qué hace en este sistema

- Gestiona el registro e inicio de sesión de investigadores (OAuth2 / OIDC).
- El backend valida los JWT en cada request autenticado.
- Una aplicación Machine-to-Machine (M2M) permite al backend eliminar usuarios de Auth0 cuando un investigador borra su cuenta.

### Variables que controla

Backend:
```
AUTH0_DOMAIN            (ej: tu-tenant.auth0.com — sin https://)
AUTH0_API_AUDIENCE      (ej: https://imfd-api)
AUTH0_M2M_CLIENT_ID
AUTH0_M2M_CLIENT_SECRET
```

Frontend (embebidas en el build Docker — ver sección 9):
```
VITE_AUTH0_DOMAIN
VITE_AUTH0_CLIENT_ID
VITE_AUTH0_AUDIENCE
```

### Pasos para reconectar

**1. Crear el tenant**

Ir a [auth0.com](https://auth0.com) → Create tenant. El plan gratuito soporta hasta 7.500 usuarios activos mensuales.

**2. Registrar la aplicación SPA (frontend)**

Applications → Create Application → tipo: **Single Page Application**.

En Settings configurar:
- **Allowed Callback URLs**: `https://<url-cloud-run>/callback, http://localhost:5173/callback`
- **Allowed Logout URLs**: `https://<url-cloud-run>, http://localhost:5173`
- **Allowed Web Origins**: `https://<url-cloud-run>, http://localhost:5173`

Copiar **Client ID** → `VITE_AUTH0_CLIENT_ID` y el secret `VITE_AUTH0_CLIENT_ID` de GitHub Actions.

**3. Registrar la API (backend)**

Applications → APIs → Create API. El **Identifier** puede ser cualquier string (ej: `https://imfd-api`); se usa como audience del JWT.

Copiar el identifier → `AUTH0_API_AUDIENCE` y `VITE_AUTH0_AUDIENCE`.

**4. Crear la M2M application (para eliminar usuarios)**

Applications → Create Application → tipo: **Machine to Machine Applications** → autorizar la **Auth0 Management API** con los permisos `delete:users` y `read:users`.

Copiar **Client ID** → `AUTH0_M2M_CLIENT_ID`
Copiar **Client Secret** → `AUTH0_M2M_CLIENT_SECRET`

---

## 5. Google Cloud Platform (GCP)

### Qué hace en este sistema

| Servicio | Uso |
|---|---|
| **Cloud Run** | Hospeda el backend + frontend compilado |
| **Artifact Registry** | Almacena las imágenes Docker del CD |
| **Cloud Tasks** | Cola asíncrona para el pipeline de grafos (cola: `imfd-processing-v3`) |
| **Cloud Vision API** | OCR de PDFs escaneados |

### Pasos para reconectar

**1. Crear el proyecto GCP y habilitar APIs**

```bash
gcloud services enable \
  run.googleapis.com \
  tasks.cloudtasks.googleapis.com \
  vision.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  --project=TU-PROJECT-ID
```

**2. Crear el repositorio en Artifact Registry**

```bash
gcloud artifacts repositories create imfd-backend \
  --repository-format=docker \
  --location=us-central1 \
  --project=TU-PROJECT-ID
```

**3. Crear la service account para Cloud Vision**

```bash
gcloud iam service-accounts create imfd-backend \
  --display-name="IMFD Backend SA" \
  --project=TU-PROJECT-ID

gcloud projects add-iam-policy-binding TU-PROJECT-ID \
  --member="serviceAccount:imfd-backend@TU-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/cloudvision.imageAnnotator"

gcloud iam service-accounts keys create gcp-vision-key.json \
  --iam-account=imfd-backend@TU-PROJECT-ID.iam.gserviceaccount.com
```

> `gcp-vision-key.json` **nunca debe subirse al repositorio** — está en `.gitignore`. En el CD se escribe desde el secret `GCP_VISION_KEY` (ver sección 9).

**4. Crear la cola de Cloud Tasks**

El script `infra/cloud_tasks/setup.sh` automatiza este paso. Acepta argumentos posicionales:

```bash
bash infra/cloud_tasks/setup.sh \
  TU-PROJECT-ID \          # 1º — obligatorio
  us-central1 \            # 2º — región (default: us-central1)
  imfd-processing-v3 \     # 3º — nombre de la cola (default: imfd-processing)
  https://<url-cloud-run> \ # 4º — URL del servicio Cloud Run (opcional)
  imfd-backend@TU-PROJECT-ID.iam.gserviceaccount.com  # 5º — SA del backend (opcional)
```

El script crea la SA `imfd-tasks-invoker`, la cola con los límites de concurrencia correctos y otorga los permisos IAM necesarios. Al terminar imprime las variables de entorno resultantes.

> Usar el nombre `imfd-processing-v3` para el argumento 3º — es el nombre hardcodeado en el CD (`.github/workflows/cd.yml`). Si se usa otro nombre, hay que actualizar el workflow.

**5. Crear la service account para el deploy (GitHub Actions)**

```bash
gcloud iam service-accounts create github-actions-deploy \
  --project=TU-PROJECT-ID

gcloud projects add-iam-policy-binding TU-PROJECT-ID \
  --member="serviceAccount:github-actions-deploy@TU-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding TU-PROJECT-ID \
  --member="serviceAccount:github-actions-deploy@TU-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding TU-PROJECT-ID \
  --member="serviceAccount:github-actions-deploy@TU-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud iam service-accounts keys create github-sa-key.json \
  --iam-account=github-actions-deploy@TU-PROJECT-ID.iam.gserviceaccount.com
```

El contenido de `github-sa-key.json` va en el secret `GCP_SA_KEY` del repositorio (ver sección 9).

**Nota sobre el build local de la imagen Docker**

El `Dockerfile` de la raíz asume que existen dos artefactos que el CD genera antes del build:

- `backend/gcp-vision-key.json` — escrito desde el secret `GCP_VISION_KEY`
- `hf-model/` — el modelo de embeddings pre-descargado desde HuggingFace

Sin estos dos archivos el build fallará con `COPY` error. Para un build local de la imagen de producción hay que generarlos manualmente:

```bash
# 1. Copiar el JSON de Vision a la ruta esperada
cp /ruta/a/gcp-vision-key.json backend/gcp-vision-key.json

# 2. Descargar el modelo (requiere Python con sentence-transformers instalado)
python -c "
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
model.save('hf-model')
"

# 3. Build
docker build -t imfd-explorer:latest .
```

Para desarrollo local, usar `docker compose up --build` desde la raíz (usa `backend/Dockerfile`, que no tiene estos requisitos).

---

## 6. OpenAI

### Qué hace en este sistema

La API key la consume **Wukong internamente** para extraer entidades y relaciones durante el pipeline de construcción del grafo. El modelo configurado es `gpt-4.1-mini` (en `backend/wukong-engine/config/default.toml`).

El backend no llama a OpenAI directamente.

### Variable que controla

```
OPENAI_API_KEY
```

### Acción requerida antes del traspaso

La key actual en producción pertenece al equipo de desarrollo y quedará inactiva al cierre del proyecto. El IMFD debe proveer una key propia con acceso al modelo `gpt-4.1-mini` y actualizarla en:

1. El secret `OPENAI_API_KEY` de GitHub Actions (para el CD y el CI).
2. La variable de entorno del servicio Cloud Run (se actualiza en el deploy o con `gcloud run services update`).

---

## 7. Wukong (submodule GitHub)

### Qué hace en este sistema

Wukong es la librería Python del IMFD que construye el grafo de conocimiento. Está incluida como git submodule en `backend/wukong-engine/` apuntando al repositorio privado del IMFD.

### Reconexión

El acceso al repositorio de Wukong ya lo gestiona el IMFD. Para que el CD funcione se necesita un **Personal Access Token (PAT)** con permisos de lectura sobre ese repositorio, configurado como secret `SUBMODULES_PAT` en el repositorio (ver sección 9).

Para clonar localmente con el submodule:

```bash
git clone --recurse-submodules https://github.com/TU-ORG/TallerDeIntegracion_G10.git
```

Si ya se clonó sin submodules:

```bash
git submodule update --init --recursive
```

---

## 8. Variables de entorno — referencia completa

Copiar desde `backend/.env.example` y completar con los valores de los servicios propios.

| Variable | Servicio | Cómo obtenerla |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI / Wukong | Proveer key propia del IMFD |
| `SUPABASE_URL` | Supabase | Project Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase | Project Settings → API → anon/public key |
| `SUPABASE_SERVICE_KEY` | Supabase | Project Settings → API → service_role key |
| `AUTH0_DOMAIN` | Auth0 | Settings de la SPA (sin `https://`) |
| `AUTH0_API_AUDIENCE` | Auth0 | Identifier de la API en Auth0 |
| `AUTH0_M2M_CLIENT_ID` | Auth0 | Client ID de la M2M application |
| `AUTH0_M2M_CLIENT_SECRET` | Auth0 | Client Secret de la M2M application |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP Vision | Ruta al `gcp-vision-key.json` (en producción: `gcp-vision-key.json`) |
| `GCP_PROJECT_ID` | GCP | ID del proyecto GCP |
| `CLOUD_TASKS_QUEUE` | Cloud Tasks | Nombre de la cola — valor: `imfd-processing-v3` |
| `CLOUD_TASKS_LOCATION` | Cloud Tasks | Región — valor: `us-central1` |
| `CLOUD_TASKS_SERVICE_URL` | Cloud Tasks | URL del servicio Cloud Run |
| `CLOUD_TASKS_INVOKER_SA` | Cloud Tasks | Email de la SA invoker |
| `MILLENNIUMDB_HOST` | MillenniumDB | Host del servidor IMFD (escalamiento futuro) |
| `MILLENNIUMDB_PORT` | MillenniumDB | Puerto del servidor IMFD — default: `1234` |
| `MAX_UPLOAD_RETRIES` | Backend | Default: `3` |
| `UPLOAD_RETRY_DELAY_SECONDS` | Backend | Default: `1.0` |
| `OCR_DPI_DEFAULT` | Cloud Vision | Default: `300` |
| `OCR_DPI_COMPLEX` | Cloud Vision | Default: `400` |
| `DEBUG` | Backend | `false` en producción |

Variables del frontend (embebidas en el build — si cambian, hay que reconstruir y redesplegar la imagen):

| Variable | Valor |
|---|---|
| `VITE_API_URL` | Dejar vacío (`""`) — el frontend usa rutas relativas en producción |
| `VITE_AUTH0_DOMAIN` | Igual que `AUTH0_DOMAIN` |
| `VITE_AUTH0_CLIENT_ID` | Client ID de la SPA en Auth0 |
| `VITE_AUTH0_AUDIENCE` | Igual que `AUTH0_API_AUDIENCE` |
| `VITE_SUPABASE_URL` | Igual que `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Igual que `SUPABASE_KEY` |

---

## 9. GitHub Actions — secrets del repositorio

Configurar en Settings → Secrets and variables → Actions del repositorio. Sin estos secrets el CI falla y el CD no despliega.

| Secret | Usado en | Contenido |
|---|---|---|
| `SUPABASE_URL` | CI + CD | URL del proyecto Supabase |
| `SUPABASE_KEY` | CI + CD | anon key de Supabase |
| `SUPABASE_SERVICE_KEY` | CI + CD | service_role key de Supabase |
| `OPENAI_API_KEY` | CI + CD | API key de OpenAI |
| `AUTH0_DOMAIN` | CI | Domain del tenant Auth0 |
| `AUTH0_API_AUDIENCE` | CI + CD | Audience de la API en Auth0 |
| `AUTH0_M2M_CLIENT_ID` | CI | Client ID de la M2M application |
| `AUTH0_M2M_CLIENT_SECRET` | CI | Client Secret de la M2M application |
| `VITE_AUTH0_CLIENT_ID` | CD | Client ID de la SPA (build del frontend) |
| `GCP_SA_KEY` | CD | JSON de la SA de deploy (raw JSON) |
| `GCP_PROJECT_ID` | CD | ID del proyecto GCP |
| `GCP_REGION` | CD | Región de Cloud Run (ej: `us-central1`) |
| `GCP_VISION_KEY` | CD | Contenido del `gcp-vision-key.json` (se escribe en disco durante el build) |
| `HF_TOKEN` | CD | Token de HuggingFace (para descargar el modelo en cache miss; plan gratuito es suficiente) |
| `SUBMODULES_PAT` | CI + CD | Personal Access Token con lectura del repo privado de Wukong |
| `CLOUD_TASKS_SERVICE_URL` | CD | URL del servicio Cloud Run |
| `CLOUD_TASKS_LOCATION` | CD | Región de la cola |
| `CLOUD_TASKS_INVOKER_SA` | CD | Email de la SA invoker |
| `MILLENNIUMDB_HOST` | CD | Host del servidor MillenniumDB |
| `MILLENNIUMDB_PORT` | CD | Puerto del servidor MillenniumDB |

> Al transferir el repositorio o hacer un fork, todos estos secrets deben reconfigurarse — no se transfieren con el repositorio.

---

## 10. Orden recomendado de reconexión

```
1. OpenAI
   └─ Obtener key propia del IMFD antes de cualquier otra cosa

2. Supabase
   └─ Crear proyecto → habilitar pgvector → correr migraciones

3. Auth0
   └─ Crear tenant → registrar SPA → registrar API → crear M2M app

4. GCP
   └─ Crear proyecto → habilitar APIs → crear Artifact Registry
      → crear SA Vision (bajar gcp-vision-key.json)
      → correr setup.sh (Cloud Tasks + SA invoker)
      → crear SA de deploy para GitHub Actions

5. Actualizar secrets de GitHub Actions
   └─ Todos los secrets de la sección 9

6. Primer deploy
   └─ Push a main → el CD construye la imagen y despliega en Cloud Run
      → copiar la URL generada
      → actualizar CLOUD_TASKS_SERVICE_URL en los secrets y repetir el paso 4 (setup.sh) si no se pasó la URL en ese momento

7. Actualizar Auth0
   └─ Añadir la URL de Cloud Run a Allowed Callback URLs, Logout URLs y Web Origins

8. Verificar (sección 11)
```

---

## 11. Verificación final

**Health checks:**

```bash
# El backend responde
curl https://<url-cloud-run>/health

# Supabase conectado (realiza una query real; 503 si falla)
curl https://<url-cloud-run>/ready
```

El frontend muestra un banner de advertencia cuando `/ready` devuelve 503.

**Flujo completo mínimo:**

1. Abrir la URL → redirige al login de Auth0.
2. Registrar un usuario → aparece el dashboard vacío.
3. Crear una colección y subir un PDF digital → estado pasa a `text_extracted`.
4. Iniciar el pipeline ("Generar Grafo") → estado avanza: `processing_text` → `processing_graph` → `graph_ready`.
5. Buscar texto → devuelve fragmentos con score de similitud.
6. Abrir el visualizador → Cytoscape renderiza nodos y aristas.

Si Cloud Tasks no está configurado (entorno sin GCP), el pipeline corre en un thread local — el flujo es el mismo pero sin cola persistente entre reinicios.
