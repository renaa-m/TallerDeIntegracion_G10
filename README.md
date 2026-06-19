# Plataforma de Exploración Documental para Humanidades Digitales

> Proyecto de Título — Ingeniería Civil Industrial · Diploma en Tecnologías de Información
> Pontificia Universidad Católica de Chile · En colaboración con el **Instituto Milenio Fundamento de los Datos (IMFD)**

---

## Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Funcionalidades Implementadas](#funcionalidades-implementadas)
3. [Cómo Funciona la Plataforma](#cómo-funciona-la-plataforma)
4. [Arquitectura del Sistema](#arquitectura-del-sistema)
5. [Stack Tecnológico](#stack-tecnológico)
6. [Estructura del Proyecto](#estructura-del-proyecto)
7. [Requisitos Previos](#requisitos-previos)
8. [Setup — Desarrollo Local](#setup--desarrollo-local)
9. [Variables de Entorno](#variables-de-entorno)
10. [CI/CD](#cicd)
11. [Testing](#testing)
12. [Integración con Wukong](#integración-con-wukong)
13. [Integración con MillenniumDB](#integración-con-millenniumdb)
14. [Docker](#docker)
15. [Equipo](#equipo)

---

## Descripción General

Plataforma web tipo **buscador** (no un chat) que permite a investigadores del IMFD:

1. Subir colecciones de documentos (PDF/TXT) a un espacio personal
2. Definir qué entidades y relaciones quieren extraer (formulario en el frontend → `data_model.json`)
3. Procesar la colección con **Wukong** para construir un grafo de conocimiento (export `.qm`) y generar **embeddings de chunks** almacenados en **Supabase (pgvector)**
4. **Buscar** de forma **semántica** sobre fragmentos indexados y **visualizar el grafo** de conocimiento resultante con Cytoscape

---

## Funcionalidades Implementadas

### Autenticación y gestión de cuenta

| Funcionalidad | Descripción |
|---|---|
| **Login / Logout** | OAuth2 con Auth0; JWT validado en todas las rutas del backend |
| **Eliminar cuenta** | Borra archivos en Storage, datos en DB (cascada) y usuario en Auth0 (M2M) |

### Gestión de colecciones

| Funcionalidad | Descripción |
|---|---|
| **Crear colección** | Nombre, descripción e idioma; nombre único por usuario (409 si duplicado) |
| **Listar colecciones** | Con estado de procesamiento y progreso visible en la landing |
| **Renombrar colección** | `PATCH /api/collections/{id}` |
| **Eliminar colección** | Elimina colección y todos sus datos asociados |

### Carga de documentos

| Funcionalidad | Descripción |
|---|---|
| **Subida individual** | `POST /api/documentos/upload` — PDF/TXT hasta 30 MB, guardado en Supabase Storage |
| **Subida múltiple (batch)** | Resultado parcial con éxitos, duplicados y fallidos |
| **Deduplicación** | Detección por SHA-256; retorna 409 si el archivo ya existe en la colección |
| **URLs firmadas** | Acceso seguro a archivos en Storage |

### Pipeline de procesamiento

| Funcionalidad | Descripción |
|---|---|
| **Extracción de texto** | TXT directo, PDF digital (PyMuPDF), PDF escaneado (Google Cloud Vision OCR con DPI adaptativo e hints de idioma) |
| **Generación de grafo** | Wukong procesa textos + data model → exporta `.qm` |
| **Data model personalizado** | El frontend permite seleccionar entidades (Persona, Organización, Lugar, Evento); se envía a `POST .../generate-graph` |
| **Data model por idioma** | Modelos por defecto en español (`default_data_model_es.json`) e inglés (`default_data_model_en.json`) |
| **Cancelación cooperativa** | `POST .../process/cancel` — detiene el pipeline de forma segura |
| **Confirmación de grafo parcial** | Si la extracción tuvo errores parciales, el usuario puede confirmar continuar con `awaiting_graph_confirmation` |
| **Pipeline en segundo plano** | FastAPI BackgroundTasks; el frontend hace polling sobre el estado de la colección |
| **Cola de procesamiento** | Solo una colección activa por usuario a la vez; recuperación de jobs huérfanos al arrancar |

**Estados de procesamiento:**
`idle` → `processing_text` → `processing_graph` → `graph_ready` / `partial_error` / `error` / `cancelled` / `awaiting_graph_confirmation`

### Búsqueda semántica

| Funcionalidad | Descripción |
|---|---|
| **Búsqueda vectorial** | `POST /api/search` — embedding de la consulta + RPC `search_chunks` con similitud coseno (pgvector / HNSW) |
| **Paginación** | 10 resultados por página con `offset` |
| **Filtros** | Por tipo de entidad, rango de años y score mínimo (backend completo; UI marcada como "próximamente") |
| **Facetas de entidades** | `GET /api/collections/{id}/entities` con caché en memoria |

### Visualización de grafo

| Funcionalidad | Descripción |
|---|---|
| **Visualizador Cytoscape** | `GET /api/collections/{id}/graph` — nodos y aristas renderizados con Cytoscape.js (layout `cose`) |
| **Panel de detalle** | Al seleccionar nodo o arista se muestra información del elemento |
| **Almacenamiento del grafo** | `.qm` subido a Supabase Storage tras el pipeline |

---

## Cómo Funciona la Plataforma

### Fase 1 — Carga de documentos

```
Investigador sube archivos (PDF y/o TXT) a una colección
        │
        ▼
Se guardan TAL CUAL en Supabase (Storage) y se registran en la base.
No corre el pipeline hasta usar "Generar Grafo".
```

### Fase 2 — Definición del data model

El investigador selecciona en el modal de carga qué entidades quiere extraer. Por ejemplo:

- **Entidades**: Persona, Organización, Lugar, Evento
- **Relaciones**: las define Wukong según el data model

Esto genera un `data_model.json` que Wukong usa para saber exactamente qué extraer. Si no se personaliza, el backend usa el modelo por defecto según el idioma de la colección.

### Fase 3 — Procesamiento (botón "Generar Grafo")

```
POST /api/collections/{id}/generate-graph   →   202 Accepted
        │   (BackgroundTasks → wukong_runner.process_collection)
        ▼
═══════════════════════════════════════════════════════
  PIPELINE 1 — Extracción de texto (por documento)
═══════════════════════════════════════════════════════

  El backend descarga los archivos originales de Supabase
        │
        ▼
  Para cada archivo:
  ├── Es .txt?          → lectura directa del texto
  ├── PDF digital?      → PyMuPDF extrae el texto
  └── PDF escaneado?    → Google Cloud Vision (OCR por página renderizada,
                          DPI adaptativo, hints de idioma según colección)
        │
        ▼
  El texto extraído se guarda en Supabase (tabla document_texts)

        │   [Si hay errores parciales → awaiting_graph_confirmation]
        ▼
═══════════════════════════════════════════════════════
  PIPELINE 2 — Wukong procesa el workdir
═══════════════════════════════════════════════════════

  Estructura workdir:
    .../docs/text/preview/
    │     ├── <id-doc>.txt
    │     └── ...
    └── data_model.json

  Wukong:
    1. Divide cada .txt en chunks
    2. Usa OpenAI para extraer entidades y relaciones
    3. Emite artefactos bajo exports/ (incl. .qm y JSONs)

        │
        ▼
═══════════════════════════════════════════════════════
  PIPELINE 3 — Índice semántico en Supabase (pgvector)
═══════════════════════════════════════════════════════

  Con los chunks de Wukong, el backend genera embeddings locales
  (sentence-transformers) e inserta en chunk_embeddings
  (índice HNSW + RPC search_chunks).

  El .qm se sube a Supabase Storage para visualización del grafo.

        │
        ▼
═══════════════════════════════════════════════════════
  MillenniumDB (integración pendiente)
═══════════════════════════════════════════════════════

  El .qm puede importarse en el servidor IMFD (mdb import …).
  El código está preparado en millenniumdb_import.py;
  la integración automática al pipeline es trabajo pendiente.
```

> **Resumen**:
> - Originales y textos extraídos → **Supabase Storage + DB**
> - Chunks + embeddings para búsqueda → **Supabase (`chunk_embeddings`)**
> - Grafo visualizable (`.qm`) → **Supabase Storage** (descargado por el frontend vía API)
> - Grafo en **MillenniumDB** → integración pendiente

### Fase 4 — Búsqueda y visualización

```
Investigador escribe en el buscador de la colección
        │
        ▼
POST /api/search  { coleccion_id, query, filtros opcionales, … }
        │
        ▼
FastAPI genera el embedding de la consulta (mismo modelo que en indexación)
        │
        ▼
Supabase: RPC search_chunks (similitud coseno; filtros por tipo / años si aplica)
        │
        ▼
FastAPI devuelve fragmentos paginados con score y storage_path
        │
        ▼
Frontend muestra lista de resultados — toggle al visualizador de grafo Cytoscape
```

---

## Arquitectura del Sistema

### Diagrama A — Flujo de carga y procesamiento

```mermaid
graph LR
    subgraph Browser
        U[Usuario / Browser]
    end

    subgraph Auth0_ext ["Externo"]
        AUTH0[Auth0\nOAuth2 / JWT]
    end

    subgraph GCP ["Google Cloud Platform"]
        API[FastAPI\nCloud Run]
        SUPA[(Supabase\nDB + pgvector + Storage)]
        BT[BackgroundTasks\nHTTP 202]

        subgraph Pipeline_1 ["Pipeline 1 — Extracción de texto"]
            VISION[Cloud Vision\nOCR]
            PYMUPDF[PyMuPDF]
            TXT_PASS[.txt\nlectura directa]
        end

        subgraph Pipeline_2 ["Pipeline 2 — Grafo e índice semántico"]
            WK[Wukong]
            EMB[Embeddings\nsentence-transformers]
        end
    end

    subgraph IMFD_servers ["Servidores IMFD (pendiente)"]
        MDB[(MillenniumDB)]
    end

    U -->|"0. Login (OAuth2)"| AUTH0
    AUTH0 -->|"JWT"| API
    U -->|"1. Sube PDF/TXT"| API
    API -->|"2. Guarda originales"| SUPA
    U -->|"3. Selecciona entidades (data model)"| API
    U -->|"4. Botón Generar Grafo"| API
    API -->|"5. Encola pipeline"| BT
    BT -->|"6a. PDF digital"| PYMUPDF
    BT -->|"6b. PDF escaneado"| VISION
    BT -->|"6c. Archivo .txt"| TXT_PASS
    Pipeline_1 -->|"7. Textos + estados"| SUPA
    SUPA -->|"8a. Textos + data_model"| WK
    WK --> EMB
    EMB -->|"9a. chunk_embeddings"| SUPA
    WK -->|"9b. .qm → Storage"| SUPA
    WK -.->|"10. .qm\n(import pendiente)"| MDB
```

### Diagrama B — Flujo de consulta / búsqueda

```mermaid
graph RL
    subgraph Browser
        U[Usuario / Browser]
    end

    subgraph GCP ["Google Cloud Platform"]
        API[FastAPI\nCloud Run]
    end

    subgraph Data_platform ["Supabase"]
        SUPA[(Postgres + pgvector)]
    end

    U -->|"1. Query de búsqueda (HTTPS)"| API
    API -->|"2. Embedding local +\nRPC search_chunks"| SUPA
    SUPA -->|"3. Chunks + similitud"| API
    API -->|"4. Resultados paginados (JSON)"| U
```

### Protocolos de comunicación

| Conexión | Protocolo | Detalle |
|---|---|---|
| Browser ↔ FastAPI | **HTTPS** (producción) / **HTTP** (local) | REST; CORS permite el origen del dev server de Vite |
| Browser → Auth0 | **HTTPS (OAuth2)** | Login; el front obtiene JWT para la API |
| FastAPI → Auth0 | **HTTPS (JWKS)** | Validación de JWT (middleware) + eliminación de usuarios (M2M) |
| FastAPI → Supabase | **HTTPS (REST)** | Cliente PostgREST / Storage / RPC (`search_chunks`, etc.) |
| FastAPI → Google Cloud Vision | **API cliente oficial** | Credenciales vía `GOOGLE_APPLICATION_CREDENTIALS` |
| FastAPI → MillenniumDB | **WebSocket** | Driver `millenniumdb_driver` (`ws://host:puerto`); no usado en el flujo principal actual |
| FastAPI → OpenAI | **HTTPS** | Consumido por **Wukong** (extracción de entidades/relaciones) |
| Embeddings | **Proceso local** | `sentence-transformers` (sin API key; descarga modelo a caché HuggingFace) |
| FastAPI ↔ Wukong | **Subproceso Python** | `python -m wukong_engine` en el mismo contenedor / máquina |

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend | React + TypeScript + Vite | React 19, Vite 8, Node 20 |
| Visualización de grafo | Cytoscape.js + react-cytoscapejs | cytoscape 3.33 |
| Backend / API | FastAPI (Python) | Python 3.13, FastAPI 0.115 |
| Autenticación | Auth0 (JWT / OAuth2) | Servicio externo |
| Base de datos + Storage + vectores | Supabase (Postgres, Storage, **pgvector** HNSW) | — |
| Extracción de texto | PyMuPDF + **Google Cloud Vision** (OCR escaneados) | `google-cloud-vision` 3.10 |
| Grafo de conocimiento | Wukong (IMFD) → export `.qm` | submodule Python 3.13 |
| Búsqueda semántica | **sentence-transformers** + Supabase `search_chunks` | `paraphrase-multilingual-MiniLM-L12-v2` |
| Grafo en IMFD | MillenniumDB + driver WebSocket | integración pendiente |
| Orquestación async | FastAPI **BackgroundTasks** | — |
| Deploy producción | Google Cloud Run + Artifact Registry | us-central1 |
| CI/CD | GitHub Actions | ci.yml (lint+test) + cd.yml (deploy) |
| Tests backend | pytest 8.3 | 17 módulos |
| Tests frontend | Jest 30 + Testing Library | cobertura amplia |

> **Nota sobre Python**: Wukong requiere Python 3.13+. El backend usa la misma versión para compatibilidad.

---

## Estructura del Proyecto

```
TallerDeIntegracion_G10/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI: lint + test en cada push/PR a main
│       └── cd.yml              # CD: build Docker + deploy a Cloud Run
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI: CORS, routers, static SPA
│   │   ├── config.py           # Pydantic Settings (todas las env vars)
│   │   ├── api/routes/
│   │   │   ├── health.py            # GET /health, GET /ready
│   │   │   ├── collections.py       # CRUD + pipeline + grafo + entidades
│   │   │   ├── documentos.py        # Carga individual, batch, URLs firmadas
│   │   │   ├── usuarios.py          # DELETE /usuarios/me
│   │   │   └── search.py            # POST /api/search
│   │   ├── middleware/
│   │   │   └── auth.py              # JWT Auth0
│   │   ├── models/                  # Pydantic (document, search)
│   │   ├── schemas/                 # graph.py (DataModelUpdate)
│   │   └── services/
│   │       ├── supabase_client.py   # DB, Storage, chunk_embeddings, RPC
│   │       ├── text_extraction.py   # TXT / PyMuPDF / Cloud Vision
│   │       ├── wukong_runner.py     # Orquestación: extracción → Wukong → embeddings
│   │       ├── embeddings_service.py
│   │       ├── graph_transformer.py # .qm → Cytoscape; facetas de entidades
│   │       ├── qm_storage.py        # Upload/download .qm en Storage
│   │       ├── processing_queue.py  # Cola 1 job por usuario + recuperación
│   │       ├── delete_user.py       # Eliminación completa de cuenta
│   │       ├── millenniumdb.py      # Cliente WebSocket (consultas grafo)
│   │       ├── millenniumdb_import.py  # Import .qm (preparado, no integrado)
│   │       ├── vision_quota.py      # Control de cuota OCR
│   │       ├── default_data_model_es.json
│   │       └── default_data_model_en.json
│   ├── supabase/migrations/         # 10 migraciones SQL (esquema + pgvector)
│   ├── wukong-engine/               # Submodule Wukong
│   ├── tests/                       # 17 módulos pytest
│   ├── scripts/                     # Utilidades (grafo, OCR, cuotas)
│   ├── docs/                        # PROCESAMIENTO_BACKGROUND_Y_CANCELACION.md
│   ├── static/                      # Frontend compilado (servido por FastAPI)
│   ├── lib/                         # vis-network, tom-select (assets grafo)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── landing_page.tsx         # Dashboard de colecciones
│   │   │   ├── login_page.tsx
│   │   │   ├── buscador_coleccion.tsx   # Buscador semántico + toggle grafo
│   │   │   ├── visualizador_grafo.tsx   # Cytoscape.js
│   │   │   └── navbar.tsx
│   │   ├── components/                  # Modales (carga, documentos, eliminar)
│   │   └── lib/
│   │       └── collection_processing.ts # Lógica estados, banners, progreso
│   ├── package.json
│   └── .env.example
├── infra/
│   └── millenniumdb/
│       ├── entrypoint.sh    # Script para levantar mdb server local
│       └── sample.ttl       # Datos de ejemplo TTL
├── Dockerfile               # Multi-stage: frontend build + backend Python 3.13
├── docker-compose.yml       # Dev: backend :8080 con hot reload
└── README.md
```

### Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servidor |
| GET | `/api/collections` | Lista colecciones del usuario |
| POST | `/api/collections` | Crear colección |
| GET | `/api/collections/{id}` | Detalle + status de procesamiento |
| PATCH | `/api/collections/{id}` | Renombrar |
| DELETE | `/api/collections/{id}` | Eliminar |
| POST | `/api/collections/{id}/generate-graph` | Iniciar pipeline con data model personalizado (202) |
| POST | `/api/collections/{id}/generate-graph/continue-graph` | Continuar tras confirmación parcial |
| POST | `/api/collections/{id}/process` | Iniciar pipeline con data model por defecto (202) |
| POST | `/api/collections/{id}/process/cancel` | Cancelar pipeline |
| POST | `/api/collections/{id}/process/continue-graph` | Continuar pipeline (default model) |
| GET | `/api/collections/{id}/graph` | Grafo en formato Cytoscape.js |
| GET | `/api/collections/{id}/entities` | Facetas de entidades para filtros |
| POST | `/api/documentos/upload` | Subir documento |
| POST | `/api/documentos/upload/batch` | Subida múltiple |
| GET | `/api/documentos` | Listar documentos |
| POST | `/api/search` | Búsqueda semántica |
| DELETE | `/usuarios/me` | Eliminar cuenta completa |

---

## Requisitos Previos

| Herramienta | Versión mínima | Para qué |
|---|---|---|
| **Python** | 3.13+ | Backend + Wukong |
| **Node.js** | 20+ | Frontend |
| **npm** | 10+ | Frontend |
| **Git** | 2.x | Submódulo `wukong-engine` |
| **Docker** | 24+ | (Opcional) Desarrollo con contenedores |
| **Cuenta / clave GCP** | — | Solo si pruebas el OCR con Cloud Vision |

---

## Setup — Desarrollo Local

### 1. Clonar el repositorio

```bash
git clone --recurse-submodules https://github.com/renaa-m/TallerDeIntegracion_G10.git
cd TallerDeIntegracion_G10
```

Si ya clonaste sin submodules:

```bash
git submodule update --init --recursive
```

### 2. Backend

```bash
cd backend

/opt/homebrew/bin/python3.13 -m venv venv   # macOS con Homebrew
# o: python3.13 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
pip install -e ./wukong-engine

cp .env.example .env
# Completar .env (ver Variables de Entorno)

uvicorn app.main:app --reload --port 8000
```

El backend queda en:
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### 3. Supabase

El proyecto Supabase **es compartido del equipo**.

- Pedir credenciales por un canal seguro (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`).
- Las **migraciones** en `backend/supabase/migrations/` son la referencia del esquema; en el proyecto compartido ya están aplicadas.

### 4. Frontend

```bash
cd frontend
npm install
```

Crear `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_AUTH0_DOMAIN=...
VITE_AUTH0_CLIENT_ID=...
VITE_AUTH0_AUDIENCE=...
```

```bash
npm run dev
```

Queda en `http://localhost:5173`.

### 5. Verificar que todo funciona

```bash
# Backend
cd backend && source venv/bin/activate
pytest tests/ -v
ruff check app/ tests/

# Frontend
cd ../frontend
npm run lint
npm run format:check
npm test
npm run build
```

---

## Variables de Entorno

```bash
cd backend
cp .env.example .env
```

```env
# OpenAI — Wukong (extracción con LLM). Sin comillas.
OPENAI_API_KEY=

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-or-service-key
SUPABASE_SERVICE_KEY=your-service-role-key

# Auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_API_AUDIENCE=https://your-api-identifier
AUTH0_M2M_CLIENT_ID=...
AUTH0_M2M_CLIENT_SECRET=...

# MillenniumDB (driver WebSocket)
MILLENNIUMDB_HOST=localhost
MILLENNIUMDB_PORT=1234

# Google Cloud Vision (PDF escaneados)
GOOGLE_APPLICATION_CREDENTIALS=gcp-vision-key.json
GCP_PROJECT_ID=your-gcp-project-id

# Opcional: copia del workdir Wukong tras cada run (depuración)
WUKONG_ARTIFACTS_DIR=

# HU-13: reintentos de subida a Storage
MAX_UPLOAD_RETRIES=3
UPLOAD_RETRY_DELAY_SECONDS=1.0

# OCR: DPI para páginas simples y complejas
OCR_DPI_DEFAULT=300
OCR_DPI_COMPLEX=400

DEBUG=true
```

> `OPENAI_API_KEY` sin comillas. El `.env` no se sube al repo.

---

## CI/CD

### CI — `.github/workflows/ci.yml`

Corre en **push** y **pull request** a `main`:

| Job | Pasos |
|---|---|
| **Backend** | Python 3.13, `pip install`, `ruff check`, `pytest` (con secrets de Supabase, Auth0, OpenAI) |
| **Frontend** | Node 20, `npm install`, `eslint`, `prettier --check`, `jest --coverage`, `npm run build` |

### CD — `.github/workflows/cd.yml`

Corre en **push a `main`**:

1. Checkout con submodules (PAT para wukong-engine privado)
2. Auth GCP + escribe credenciales Vision
3. Descarga y cachea modelo HuggingFace (`paraphrase-multilingual-MiniLM-L12-v2`)
4. `docker build` imagen multi-stage
5. Push a Artifact Registry: `us-central1-docker.pkg.dev/titulo-grupo10/imfd-backend/imfd-app`
6. Deploy Cloud Run (`imfd-backend`): 2 CPU, 2Gi RAM, `--min-instances=1`

---

## Testing

### Backend

```bash
cd backend
source venv/bin/activate
pytest tests/ -v --tb=short
```

Módulos de test (cobertura ~70%):

| Módulo | Qué prueba |
|---|---|
| `test_health.py` | `/health`, `/ready` |
| `test_auth.py` | Middleware JWT Auth0 |
| `test_collections.py` | CRUD colecciones, estados, pipeline |
| `test_documentos.py` | Upload individual y batch, deduplicación |
| `test_text_extraction.py` | TXT, PyMuPDF, Vision OCR |
| `test_wukong_runner.py` | Orquestación del runner |
| `test_search.py` | Búsqueda semántica |
| `test_search_not_ready.py` | Colección no lista → `ready: false` |
| `test_delete_user.py` | Eliminación de cuenta |
| `test_collection_entities.py` | Facetas de entidades |
| `test_processing_queue.py` | Cola de procesamiento |
| `test_graph_transformer.py` | Parseo .qm → Cytoscape |
| `test_qm_storage.py` | Upload/download Storage |
| `test_vision_quota.py` | Control cuota OCR |
| `test_usuarios.py` | Rutas de usuario |

### Frontend

```bash
cd frontend
npm test                  # Jest + Testing Library
npm run lint              # ESLint
npm run format:check      # Prettier
```

---

## Integración con Wukong

[Wukong](https://github.com/MillenniumDB/wukong-engine) construye el grafo a partir de textos + `data_model.json`. Está en **`backend/wukong-engine/`** (submódulo).

```bash
git submodule update --init --recursive
cd backend
pip install -e ./wukong-engine
```

### Qué necesita Wukong

1. **`OPENAI_API_KEY`**
2. **Workdir** con `docs/text/preview/*.txt` y `data_model.json`
3. **Config** TOML: `wukong-engine/config/default.toml`

### Ejecución manual

```bash
python -m wukong_engine <path/to/data_dir> --config backend/wukong-engine/config/default.toml
```

### Salida

En `<data_dir>/exports/`: el **`.qm`** y JSONs de entidades y relaciones. El backend además genera filas en **`chunk_embeddings`** y sube el `.qm` a Supabase Storage.

---

## Integración con MillenniumDB

[MillenniumDB](https://github.com/MillenniumDB/MillenniumDB) corre en servidores del IMFD. Las consultas desde el driver Python usan **WebSocket** (`ws://host:puerto`).

### CLI (operación en el servidor IMFD)

```bash
mdb import knowledge_graph.qm /path/to/mi-db
mdb server /path/to/mi-db --port 1234 --timeout 3600
```

### Ejemplo de driver en Python

```python
import millenniumdb_driver

driver = millenniumdb_driver.driver("ws://localhost:1234")
session = driver.session()
result = session.run(
    "MATCH (?person :Persona)-[:VotaEn]->(?sent :Sentencia) RETURN *"
)
data = result.data()
driver.close()
```

El cliente está en `backend/app/services/millenniumdb.py`. La **import automática del `.qm` al pipeline** es trabajo pendiente (código preparado en `millenniumdb_import.py`).

---

## Docker

### Desarrollo local

```bash
docker compose up --build
```

Levanta el backend en `:8080` con hot reload. Para incluir el frontend compilado, correr `npm run build` en `frontend/` primero.

### Imagen de producción (raíz)

```bash
docker build -t imfd-explorer:latest .
docker run -p 8080:8080 --env-file backend/.env imfd-explorer:latest
```

---

## Equipo

Proyecto de Título 2025 — Pontificia Universidad Católica de Chile
En colaboración con el Instituto Milenio Fundamento de los Datos (IMFD)
