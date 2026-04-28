# Plataforma de Exploración Documental para Humanidades Digitales

> Proyecto de Título — Ingeniería Civil Industrial · Diploma en Tecnologías de Información
> Pontificia Universidad Católica de Chile · En colaboración con el **Instituto Milenio Fundamento de los Datos (IMFD)**

---

## Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Cómo Funciona la Plataforma](#cómo-funciona-la-plataforma)
3. [Arquitectura del Sistema](#arquitectura-del-sistema)
4. [Stack Tecnológico](#stack-tecnológico)
5. [Estructura del Proyecto](#estructura-del-proyecto)
6. [Requisitos Previos](#requisitos-previos)
7. [Setup — Desarrollo Local](#setup--desarrollo-local)
8. [Variables de Entorno](#variables-de-entorno)
9. [CI/CD](#cicd)
10. [Testing](#testing)
11. [Integración con Wukong](#integración-con-wukong)
12. [Integración con MillenniumDB](#integración-con-millenniumdb)
13. [Docker](#docker)
14. [Equipo](#equipo)

---

## Descripción General

Plataforma web tipo **buscador** (no un chat) que permite a investigadores del IMFD:

1. Subir colecciones de documentos (PDF/TXT)
2. Definir qué entidades y relaciones quieren extraer (formulario → data model)
3. Procesar la colección con Wukong para construir un grafo de conocimiento
4. **Buscar** entidades, relaciones y documentos dentro del grafo generado

### Funcionalidades principales

| Funcionalidad | Descripción |
|---|---|
| **Carga de documentos** | El usuario sube PDFs y/o TXTs a una colección. Se guardan tal cual en Supabase (Storage) |
| **Definición del data model** | El investigador define qué entidades y relaciones quiere extraer mediante un formulario. Esto genera el `data_model.json` que Wukong necesita |
| **Procesamiento (botón "Procesar")** | El usuario presiona "Procesar" y se dispara todo el pipeline: extracción de texto (Pipeline 1) + construcción del grafo con Wukong (Pipeline 2). Los textos quedan en Supabase, el grafo queda en MillenniumDB |
| **Búsqueda** | Buscador tipo Google: el usuario escribe una query → FastAPI consulta MillenniumDB (grafo) → devuelve resultados al frontend |
| **Visualización de grafo** | Cytoscape.js para explorar nodos y aristas interactivamente |

---

## Cómo Funciona la Plataforma

### Fase 1 — Carga de documentos

```
Investigador sube archivos (PDF y/o TXT) a una colección
        │
        ▼
Se guardan TAL CUAL en Supabase (Storage)
No se procesan todavía. Solo se almacenan.
```

### Fase 2 — Definición del data model

El investigador llena un formulario en el frontend indicando qué quiere extraer. Por ejemplo:

- **Contexto**: "Sentencias civiles de la Corte Suprema de Chile"
- **Entidades**: Sentencia (con rol, fecha, problema legal), Persona (con nombre)
- **Relaciones**: VotaEn (Persona → Sentencia, con decisión: "A Favor" / "En Contra")

Esto genera un `data_model.json` que Wukong usa para saber exactamente qué extraer.

### Fase 3 — Procesamiento (botón "Procesar")

El usuario presiona **"Procesar"** y se dispara el pipeline completo.
Todo esto pasa **dentro del backend** (el servidor), de forma invisible para el usuario:

```
Botón "Procesar"
        │
        ▼
═══════════════════════════════════════════════════════
  PIPELINE 1 — Extracción de texto (por documento)
═══════════════════════════════════════════════════════

  El backend descarga los archivos originales de Supabase
        │
        ▼
  Para cada archivo:
  ├── Es .txt?          → se usa tal cual, no se procesa
  ├── PDF digital?      → PyMuPDF extrae el texto
  └── PDF escaneado?    → OpenAI OCR extrae el texto
        │
        ▼
  Resultado: todos los documentos convertidos a .txt
  Se guardan en Supabase (como respaldo)

        │
        ▼
═══════════════════════════════════════════════════════
  CARPETA TEMPORAL — Se arma en el servidor (/tmp/)
═══════════════════════════════════════════════════════

  El backend crea una carpeta temporal en el servidor
  y la llena con la estructura que Wukong necesita:

  /tmp/coleccion-abc123/
  ├── docs/
  │   └── text/
  │       └── mi-coleccion/
  │           ├── archivo1.txt   ← vino de un PDF digital
  │           ├── archivo2.txt   ← vino de un PDF escaneado
  │           └── archivo3.txt   ← subido como .txt directo
  └── data_model.json            ← generado del formulario (Fase 2)

  Esta carpeta es TEMPORAL. Se borra al terminar.

        │
        ▼
═══════════════════════════════════════════════════════
  PIPELINE 2 — Wukong procesa la carpeta
═══════════════════════════════════════════════════════

  El backend ejecuta:
    python -m wukong_engine /tmp/coleccion-abc123/

  Wukong lee TODOS los .txt + el data_model.json y:
    1. Divide cada .txt en pedazos (chunks)
    2. Usa OpenAI para extraer entidades (personas, sentencias, etc.)
    3. Usa OpenAI para extraer relaciones (quién votó en qué, etc.)
    4. Genera el grafo en formato .qm

  Resultado: /tmp/coleccion-abc123/exports/mdb/  ← archivo .qm

        │
        ▼
═══════════════════════════════════════════════════════
  CARGA EN MILLENNIUMDB
═══════════════════════════════════════════════════════

  El .qm se carga en MillenniumDB (servidor del IMFD):
    mdb import knowledge_graph.qm /path/to/db

  Se borra la carpeta temporal. Fin del procesamiento.
```

> **Resumen**:
> - Los documentos originales y los textos extraídos quedan en **Supabase**
> - El grafo de conocimiento (entidades + relaciones) queda en **MillenniumDB**
> - La carpeta temporal en el servidor **se borra** después de procesar
> - El usuario solo presiona un botón y espera

### Fase 4 — Búsqueda (el producto principal)

```
Investigador escribe en el buscador: "Pérez González"
        │
        ▼
FastAPI recibe la query
        │
        ▼
Consulta a MillenniumDB → entidades y relaciones del grafo
        │
        ▼
FastAPI devuelve resultados al frontend
        │
        ▼
Frontend muestra:
  ├── Grafo interactivo (Cytoscape.js)
  ├── Lista de entidades encontradas
  ├── Documentos/fragmentos relacionados
  └── Filtros por tipo, colección, fecha
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
        SUPA[(Supabase\nDB + Storage)]
        CT[Cloud Tasks]

        subgraph Pipeline_1 ["Pipeline 1 — Extracción de texto"]
            OCR[OpenAI OCR]
            PYMUPDF[PyMuPDF]
            TXT_PASS[Ya es .txt\nsin procesar]
        end

        subgraph Pipeline_2 ["Pipeline 2 — Construcción de grafo"]
            WK[Wukong]
        end
    end

    subgraph IMFD_servers ["Servidores IMFD"]
        MDB[(MillenniumDB)]
    end

    U -->|"0. Login (OAuth2)"| AUTH0
    AUTH0 -->|"JWT"| API
    U -->|"1. Sube PDF/TXT"| API
    API -->|"2. Guarda originales"| SUPA
    U -->|"3. Define data model (formulario)"| API
    API -->|"4. Guarda data_model.json"| SUPA
    U -->|"5. Botón PROCESAR"| API
    API -->|"6. Lanza pipeline"| CT
    CT -->|"7a. PDF digital"| PYMUPDF
    CT -->|"7b. PDF escaneado"| OCR
    CT -->|"7c. Archivo .txt"| TXT_PASS
    Pipeline_1 -->|"8. Textos .txt"| SUPA
    SUPA -->|"9a. Todos los .txt"| WK
    SUPA -->|"9b. data_model.json"| WK
    WK -->|"10. .qm"| MDB
```

### Diagrama B — Flujo de consulta/búsqueda

```mermaid
graph RL
    subgraph Browser
        U[Usuario / Browser]
    end

    subgraph GCP ["Google Cloud Platform"]
        API[FastAPI\nCloud Run]
    end

    subgraph IMFD_servers ["Servidores IMFD"]
        MDB[(MillenniumDB)]
    end

    U -->|"1. Query de búsqueda (HTTPS)"| API
    API -->|"2. Consulta grafo (WebSocket)"| MDB
    MDB -->|"3. Entidades + relaciones (JSON)"| API
    API -->|"4. Resultados (JSON)"| U
```

### Protocolos de comunicación

| Conexión | Protocolo | Detalle |
|---|---|---|
| Browser ↔ FastAPI | **HTTPS** | Requests REST. Frontend hace `fetch()` a la API |
| Browser → Auth0 | **HTTPS (OAuth2)** | Redirect al login de Auth0, devuelve JWT |
| FastAPI → Auth0 | **HTTPS (JWKS)** | Descarga las public keys de Auth0 para validar tokens JWT |
| FastAPI → Supabase | **HTTPS (REST API)** | Cliente de Supabase con anon key para DB + Storage |
| FastAPI → MillenniumDB | **WebSocket** | Driver oficial `millenniumdb-driver` se conecta vía `ws://host:port` |
| FastAPI → OpenAI | **HTTPS (REST API)** | Llamadas a la API de OpenAI para OCR de PDFs escaneados |
| FastAPI → Cloud Tasks | **gRPC (GCP SDK)** | Crea tasks en la cola de GCP |
| FastAPI ↔ Wukong | **Python (local)** | Wukong es un paquete Python instalado en el backend. Se llama directo |
| Wukong → OpenAI | **HTTPS (REST API)** | Wukong usa OpenAI internamente para extraer entidades/relaciones |

### Notas clave

- **FastAPI sirve todo**: la API REST y el frontend estático compilado (React/Vite). No hay Firebase ni hosting separado.
- **Auth0** es externo a GCP. Maneja login (OAuth2) y emite tokens JWT que FastAPI valida.
- **MillenniumDB** corre en servidores del IMFD (fuera de GCP). FastAPI se conecta vía WebSocket usando el driver oficial (`millenniumdb-driver`).
- **Wukong** ya está incluido como git submodule en `backend/wukong-engine/`. Se instala como paquete Python local. No es un servicio HTTP externo.
- **Cloud Tasks** maneja los jobs de procesamiento de forma asíncrona dentro de GCP.
- **Archivos `.txt`** subidos directamente se guardan en Supabase sin pasar por Pipeline 1 (ya son texto plano).

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend | React + TypeScript + Vite | React 19, Vite 8, Node 20 |
| Backend / API | FastAPI (Python) en Cloud Run | Python 3.13, FastAPI 0.115 |
| Autenticación | Auth0 (JWT / OAuth2) | Servicio externo |
| Base de datos + Storage | Supabase (DB + Storage) | — |
| Extracción de texto | PyMuPDF + OpenAI (OCR) | — |
| Grafo de conocimiento + Búsqueda | Wukong (IMFD) → MillenniumDB (IMFD) | Python 3.13 |
| Cola de tareas | Cloud Tasks (GCP) | — |
| Visualización de grafo | Cytoscape.js (react-cytoscapejs) | — |
| CI/CD | GitHub Actions → Cloud Run | — |

> **Nota sobre Python**: Wukong requiere Python 3.13+. El backend usa la misma versión para compatibilidad.

---

## Estructura del Proyecto

```
TallerDeIntegracion_G10/
├── .github/
│   └── workflows/
│       └── ci.yml              # Pipeline CI: lint + test en cada push/PR a main
├── backend/
│   ├── app/
│   │   ├── __init__.py         # Marca app/ como paquete Python
│   │   ├── main.py             # Punto de entrada FastAPI: CORS, rutas, hosting estático
│   │   ├── config.py           # Variables de entorno tipadas con Pydantic Settings
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── health.py        # GET /health y GET /ready (Cloud Run health checks)
│   │   │       └── collections.py   # GET y POST /api/collections (esqueleto Sprint 1)
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── document.py          # Schema Pydantic para documentos
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   └── supabase_client.py   # Cliente Supabase (DB + Storage)
│   │   └── middleware/         # Autenticación JWT con Auth0 (por crear)
│   │       └── __init__.py
│   ├── supabase/
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql   # Schema inicial: tablas collections y documents
│   │       └── 002_storage_bucket.sql   # Bucket 'documentos' y políticas RLS de storage
│   ├── wukong-engine/          # Submodule de Wukong (ya incluido)
│   ├── tests/
│   │   ├── __init__.py
│   │   └── test_health.py      # Tests de los endpoints /health y /ready
│   ├── requirements.txt        # Dependencias Python (incluye ./wukong-engine)
│   ├── Dockerfile              # Imagen Docker del backend para Cloud Run
│   └── .env.example            # Plantilla de variables de entorno
├── frontend/
│   ├── src/
│   │   ├── main.tsx            # Punto de entrada: monta React en el DOM
│   │   ├── App.tsx             # Componente raíz
│   │   ├── App.css             # Estilos del componente App
│   │   ├── index.css           # Estilos globales
│   │   └── assets/             # Imágenes y recursos estáticos
│   ├── public/                 # Archivos servidos directamente (favicon)
│   ├── index.html              # HTML base donde se monta React
│   ├── package.json            # Dependencias y scripts npm
│   ├── package-lock.json       # Lockfile de npm
│   ├── tsconfig.json           # Config base de TypeScript
│   ├── tsconfig.app.json       # Config TS para código de la app
│   ├── tsconfig.node.json      # Config TS para archivos de config (vite.config.ts)
│   ├── vite.config.ts          # Configuración de Vite (bundler y dev server)
│   ├── eslint.config.js        # ESLint con integración Prettier
│   ├── .prettierrc             # Formato: sin punto y coma, comillas simples, 2 espacios
│   └── .gitignore              # Ignora node_modules/ y dist/
├── Dockerfile                  # Build completo (frontend + backend) para Cloud Run
├── docker-compose.yml          # Desarrollo local con Docker
├── .gitignore                  # Exclusiones globales del repo
└── README.md                   # Este archivo
```

### Qué hace cada archivo clave

| Archivo | Qué hace |
|---|---|
| `backend/app/main.py` | Crea la app FastAPI, configura CORS, registra rutas. En producción, sirve el frontend compilado como archivos estáticos (SPA catch-all) |
| `backend/app/config.py` | Lee las variables de entorno del `.env` y las expone como un objeto tipado. Si falta una variable obligatoria, la app falla al arrancar con error claro |
| `backend/app/api/routes/health.py` | Dos endpoints que Cloud Run usa para saber si el contenedor está vivo (`/health`) y listo para tráfico (`/ready`) |
| `backend/requirements.txt` | Dependencias Python con versiones exactas. Incluye `./wukong-engine` para instalar Wukong como paquete local |
| `backend/.env.example` | Plantilla con todas las variables de entorno necesarias. Cada dev la copia como `.env` y pone sus credenciales reales |
| `backend/Dockerfile` | Imagen Docker multi-stage del backend. Instala dependencias, copia código y sirve en puerto 8080 |
| `Dockerfile` (raíz) | Build completo: compila el frontend (Node 20) + backend (Python 3.13) en una sola imagen para Cloud Run |
| `docker-compose.yml` | Levanta el backend en local con hot reload. Monta el código y el build del frontend |
| `.github/workflows/ci.yml` | Pipeline CI que corre en cada push/PR a main: linter + tests del backend, linter + build del frontend |

---

## Requisitos Previos

| Herramienta | Versión mínima | Para qué |
|---|---|---|
| **Python** | 3.13+ | Backend + Wukong (ambos requieren 3.13) |
| **Node.js** | 20+ | Frontend (React + Vite) |
| **npm** | 10+ | Gestor de paquetes del frontend |
| **Git** | 2.x | Control de versiones |
| **Docker** | 24+ | (Opcional) Desarrollo local con contenedores |

> **Tip**: Para manejar múltiples versiones de Python, se recomienda usar [pyenv](https://github.com/pyenv/pyenv).

---

## Setup — Desarrollo Local

### 1. Clonar el repositorio

```bash
git clone https://github.com/your-org/TallerDeIntegracion_G10.git
cd TallerDeIntegracion_G10
```

Wukong viene como submodule, así que hay que inicializarlo:

```bash
git submodule update --init --recursive
```

### 2. Backend

```bash
cd backend

# Crear y activar entorno virtual con Python 3.13
python3.13 -m venv .venv
source .venv/bin/activate        # En Windows: .venv\Scripts\activate

# Instalar dependencias (incluye Wukong)
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Abrir .env y llenar con tus credenciales (ver sección Variables de Entorno)

# Levantar el servidor de desarrollo
uvicorn app.main:app --reload --port 8080
```

El backend queda disponible en:
- API: `http://localhost:8080`
- Docs interactivos (Swagger): `http://localhost:8080/docs`
- Docs alternativo (ReDoc): `http://localhost:8080/redoc`

### 3. Supabase

El proyecto Supabase **ya existe y es compartido del equipo** — no hay que crear uno nuevo.

- **Credenciales**: pedir `SUPABASE_URL` y `SUPABASE_KEY` al equipo por un canal seguro (no compartir por GitHub ni chat público). Una vez obtenidas, pegarlas en el `.env` local.
- **Migraciones**: ya fueron corridas sobre el proyecto compartido. No hay que volver a ejecutarlas.

### 4. Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Levantar el servidor de desarrollo
npm run dev
```

El frontend queda disponible en `http://localhost:5173`.

### 5. Verificar que todo funciona

```bash
# Desde la raíz del proyecto:

# Backend — tests
cd backend && source .venv/bin/activate && pytest tests/ -v

# Backend — linter
ruff check app/ tests/

# Frontend — linter + build
cd ../frontend && npm run lint && npm run format:check && npm run build
```

---

## Variables de Entorno

El backend necesita un archivo `.env` dentro de `backend/`. Copia la plantilla y llena tus credenciales:

```bash
cd backend
cp .env.example .env
```

### Referencia completa

```env
# ──────────────────────────────────────────────
# OpenAI — REQUERIDO
# Se usa para: OCR de PDFs escaneados.
# Wukong también lo usa internamente para extraer entidades/relaciones.
# Formato: pegar la key TAL CUAL, sin comillas.
# ──────────────────────────────────────────────
OPENAI_API_KEY=sk-proj-abc123...

# ──────────────────────────────────────────────
# Supabase — Base de datos + Storage
# ──────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUz...

# ──────────────────────────────────────────────
# Auth0 — Autenticación
# ──────────────────────────────────────────────
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_API_AUDIENCE=https://your-api-identifier

# ──────────────────────────────────────────────
# MillenniumDB — Servidores del IMFD
# Host y puerto donde corre el servidor mdb
# ──────────────────────────────────────────────
MILLENNIUMDB_HOST=imfd-server.example.com
MILLENNIUMDB_PORT=1234

# ──────────────────────────────────────────────
# GCP Cloud Tasks — Pipeline asíncrono
# ──────────────────────────────────────────────
GCP_PROJECT_ID=your-gcp-project
CLOUD_TASKS_QUEUE=your-queue-name
CLOUD_TASKS_LOCATION=us-central1

# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
DEBUG=true
```

> **Importante sobre `OPENAI_API_KEY`**: Pegar la key directamente, **sin comillas**. Ejemplo correcto:
> ```
> OPENAI_API_KEY=sk-proj-abc123xyz456...
> ```
> Ejemplo incorrecto:
> ```
> OPENAI_API_KEY="sk-proj-abc123xyz456..."   # ← NO usar comillas
> ```

> **Importante**: El archivo `.env` **nunca** se sube al repositorio (está en el `.gitignore`). Cada desarrollador tiene el suyo.

---

## CI/CD

El archivo `.github/workflows/ci.yml` define un pipeline que se ejecuta automáticamente en cada **push** y **pull request** a `main`.

| Job | Qué hace |
|---|---|
| **Backend** | Instala Python 3.13, instala dependencias, corre `ruff check` (linter) y `pytest` (tests) |
| **Frontend** | Instala Node 20, instala dependencias, corre `eslint` (linter), `prettier --check` (formato) y `npm run build` (compilación TypeScript + Vite) |

Ambos jobs corren **en paralelo**. Si alguno falla, el PR queda bloqueado hasta que se corrija.

---

## Testing

### Backend

```bash
cd backend
source .venv/bin/activate
pytest tests/ -v
```

Tests actuales:
- `test_health_check` — verifica que `GET /health` devuelve `{"status": "healthy"}`
- `test_readiness_check` — verifica que `GET /ready` devuelve `{"status": "ready"}`

### Frontend

```bash
cd frontend
npm run lint            # Errores de código
npm run format:check    # Verifica formato (sin modificar archivos)
npm run build           # Compila TypeScript + Vite (detecta errores de tipos/imports)
```

---

## Integración con Wukong

[Wukong](https://github.com/MillenniumDB/wukong-engine) es el motor que construye grafos de conocimiento a partir de documentos de texto. **Ya está incluido en el repositorio** como git submodule en `backend/wukong-engine/`.

Al clonar el repo, se descarga automáticamente con:

```bash
git clone --recurse-submodules https://github.com/renaa-m/TallerDeIntegracion_G10.git
```

Si ya tienes el repo clonado y la carpeta `backend/wukong-engine/` está vacía:

```bash
git submodule update --init --recursive
```

`requirements.txt` ya incluye la línea `./wukong-engine` que le dice a pip que instale Wukong como paquete Python local.

### Qué necesita Wukong para correr

1. **`OPENAI_API_KEY`** — la misma variable de entorno que usa el backend.
2. **Un directorio de datos** con esta estructura:

```
data-dir/
├── docs/
│   └── text/
│       └── nombre-coleccion/
│           ├── documento_1.txt
│           ├── documento_2.txt
│           └── ...
└── data_model.json
```

3. **El `data_model.json`** — generado desde el formulario del frontend. Define:
   - `parameters`: contexto, rol del LLM, idioma
   - `entities`: tipos de entidades a extraer (con propiedades, primary key, descripción)
   - `relations`: tipos de relaciones entre entidades

### Cómo se ejecuta Wukong

```bash
# Desde el directorio de wukong-engine:
python -m wukong_engine <path/to/data_dir>

# Con configuración custom:
python -m wukong_engine <path/to/data_dir> --config <path/to/config.toml>
```

### Qué produce Wukong

El output se guarda en `<data_dir>/exports/` y contiene:
- **`knowledge_graph.qm`** — el archivo que se carga en MillenniumDB
- Archivos JSON y CSV con las entidades y relaciones extraídas

El grafo incluye entidades especiales `Document` y `Chunk`, y relaciones `ChunkOf` y `ExtractedFrom` para trazabilidad.

---

## Integración con MillenniumDB

[MillenniumDB](https://github.com/MillenniumDB/MillenniumDB) es la base de datos de grafos del IMFD. Corre en **servidores del IMFD** (fuera de GCP). El backend se comunica con ella vía HTTP.

### Comandos principales de MillenniumDB

```bash
# 1. Importar un archivo .qm para crear la base de datos
mdb import knowledge_graph.qm /path/to/mi-db

# 2. Levantar el servidor para recibir consultas HTTP
mdb server /path/to/mi-db --port 1234 --timeout 3600
```

### Cómo consultar MillenniumDB desde el backend

Se usa el [driver oficial de Python](https://pypi.org/project/millenniumdb-driver/) que se conecta vía WebSocket:

```python
import millenniumdb_driver

driver = millenniumdb_driver.driver("ws://localhost:1234")
session = driver.session()

result = session.run(
    "MATCH (?person :Persona)-[:VotaEn]->(?sent :Sentencia) RETURN *"
)
data = result.data()   # lista de dicts
driver.close()
```

El servicio `backend/app/services/millenniumdb.py` ya tiene esto encapsulado. Solo hay que llamar:

```python
from app.services.millenniumdb import query_graph

resultados = query_graph(
    "MATCH (?p :Persona) WHERE ?p.nombre = ?nombre RETURN *",
    {"nombre": "Juan Pérez"},
)
```

### Formato del archivo .qm (Quad Model)

```
# Nodos (entidades) — id :Label propiedad:"valor"
a0 :Persona nombre:"Juan Pérez" edad:45
s0 :Sentencia rol:"13500-2025" fecha:"T20250115"

# Aristas (relaciones) — origen->destino :Label propiedad:"valor"
a0->s0 :VotaEn decision:"A Favor"
```

---

## Docker

### Desarrollo local (solo backend)

```bash
docker compose up --build
```

Esto levanta el backend en `http://localhost:8080` con hot reload. Si quieres probar el hosting del frontend integrado:

```bash
# Primero compilar el frontend
cd frontend && npm run build && cd ..

# Luego levantar con Docker (monta frontend/dist como static/)
docker compose up --build
```

### Build de producción (imagen completa para Cloud Run)

```bash
# Desde la raíz del proyecto
docker build -t imfd-explorer:latest .
```

Esto crea una sola imagen que incluye el frontend compilado + el backend, lista para Cloud Run.

```bash
# Probar localmente
docker run -p 8080:8080 --env-file backend/.env imfd-explorer:latest
```

---

## Equipo

Proyecto de Título 2025 — Pontificia Universidad Católica de Chile
En colaboración con el Instituto Milenio Fundamento de los Datos (IMFD)
