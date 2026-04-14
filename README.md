# Plataforma de Exploración Documental para Humanidades Digitales

> Proyecto de Título — Ingeniería Civil Industrial · Diploma en Tecnologías de Información
> Pontificia Universidad Católica de Chile · En colaboración con el **Instituto Milenio Fundamento de los Datos (IMFD)**

---

## Descripción General

Plataforma web que permite a investigadores del IMFD cargar documentos (PDF/TXT), procesarlos automáticamente (extracción de texto, entidades y relaciones), construir grafos de conocimiento por colección y realizar búsquedas semánticas — todo con aislamiento estricto por usuario y colección.

### Funcionalidades principales

- **Carga de documentos**: PDFs (digitales y escaneados) y archivos TXT, organizados en colecciones.
- **Extracción de texto**: Automática con PyMuPDF (PDF digital) y Gemini Flash 3.0 (OCR para escaneados).
- **Extracción de conocimiento**: Entidades y relaciones con Wukong (IMFD).
- **Grafo de conocimiento**: Construcción por colección en MillenniumDB, visualización con Cytoscape.js.
- **Búsqueda semántica**: Por lenguaje natural con embeddings de OpenAI y filtros de contexto.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript + Vite · Firebase Hosting |
| Backend | FastAPI (Python 3.11) · Cloud Run (GCP) |
| Autenticación | Auth0 (JWT / OAuth2) |
| Base de datos + Storage | Supabase (PostgreSQL + pgvector + Storage) |
| Extracción de texto | PyMuPDF + Gemini Flash 3.0 (OCR) |
| Pipeline NLP | Wukong (IMFD) |
| Grafo de conocimiento | MillenniumDB (IMFD) |
| Embeddings | OpenAI API (text-embedding-3-small) |
| Visualización de grafo | Cytoscape.js (react-cytoscapejs) |
| CI/CD | GitHub Actions → Cloud Run + Firebase Hosting |

---

## Estructura del Proyecto

```
TallerDeIntegracion_G10/
├── .github/workflows/       # Pipelines de CI/CD
├── backend/                 # API REST con FastAPI (Python)
├── frontend/                # Aplicación web con React (TypeScript)
├── docker-compose.yml       # Levantar backend en local con Docker
├── .gitignore               # Archivos excluidos del repositorio
└── README.md                # Este archivo
```

---

### `.github/workflows/`

Contiene los pipelines de integración continua que corren automáticamente en cada push y pull request a `main`.

| Archivo | Qué hace |
|---|---|
| `ci.yml` | Ejecuta dos jobs en paralelo: (1) **Backend**: instala Python 3.11, corre el linter Ruff y los tests con pytest. (2) **Frontend**: instala Node 20, corre ESLint, verifica el formato con Prettier y compila el proyecto con TypeScript + Vite. |

---

### `backend/`

API REST construida con FastAPI. Recibe las peticiones del frontend, gestiona documentos, ejecuta los pipelines de procesamiento y consulta las bases de datos.

```
backend/
├── app/                     # Código fuente de la aplicación
│   ├── __init__.py
│   ├── main.py              # Punto de entrada: crea la app FastAPI, configura CORS y registra rutas
│   ├── config.py            # Variables de entorno centralizadas con Pydantic Settings
│   ├── api/
│   │   └── routes/
│   │       └── health.py    # Endpoints GET /health y GET /ready (requeridos por Cloud Run)
│   ├── models/              # Schemas Pydantic para validación de requests/responses (por crear)
│   ├── services/            # Lógica de negocio: llamadas a Wukong, Gemini, OpenAI, etc. (por crear)
│   └── middleware/          # Middleware de autenticación JWT con Auth0 (por crear)
├── tests/
│   └── test_health.py       # Tests de los endpoints /health y /ready
├── requirements.txt         # Dependencias Python con versiones fijas
├── Dockerfile               # Imagen Docker multi-stage optimizada para Cloud Run
└── .env.example             # Plantilla de variables de entorno (sin secretos reales)
```

#### Archivos clave del backend

**`app/main.py`** — Punto de entrada de la aplicación. Aquí se:
- Crea la instancia de FastAPI.
- Configura el middleware CORS para que el frontend (puerto 5173) pueda comunicarse con el backend.
- Registra los routers (grupos de endpoints).

**`app/config.py`** — Centraliza todas las variables de entorno en un objeto tipado. Si falta una variable obligatoria, la app falla al arrancar con un error claro (no en medio de una request). Incluye configuración para Supabase, Auth0, OpenAI y MillenniumDB.

**`app/api/routes/health.py`** — Dos endpoints simples:
- `GET /health`: indica que el servidor está vivo.
- `GET /ready`: indica que el servidor está listo para recibir tráfico.
Cloud Run los usa para decidir si enviar tráfico al contenedor o reiniciarlo.

**`requirements.txt`** — Lista de dependencias con versiones exactas para garantizar que todos los miembros del equipo y el CI usen las mismas versiones. Solo incluye lo necesario para el Sprint 1; cada sprint agrega las suyas.

**`Dockerfile`** — Usa un build en dos etapas (multi-stage):
1. Etapa `builder`: instala las dependencias de Python.
2. Etapa final: copia solo las dependencias instaladas y el código fuente.
Esto produce una imagen más liviana, lo que significa cold starts más rápidos en Cloud Run. Expone el puerto 8080 (el que Cloud Run espera por defecto).

**`.env.example`** — Plantilla que documenta qué variables de entorno necesita el proyecto, sin incluir valores reales. Cada desarrollador copia este archivo como `.env` y llena sus propias credenciales. El `.env` real nunca se sube al repositorio (está en el `.gitignore`).

---

### `frontend/`

Aplicación web single-page (SPA) construida con React, TypeScript y Vite. Es lo que el usuario ve en el navegador.

```
frontend/
├── src/
│   ├── main.tsx             # Punto de entrada: monta React en el DOM
│   ├── App.tsx              # Componente raíz de la aplicación
│   ├── App.css              # Estilos del componente App
│   ├── index.css            # Estilos globales
│   └── assets/              # Imágenes y recursos estáticos
├── public/                  # Archivos estáticos servidos directamente (favicon, etc.)
├── index.html               # HTML base donde se monta la app React
├── package.json             # Dependencias, scripts y metadatos del proyecto
├── package-lock.json        # Lockfile: versiones exactas de todas las dependencias
├── tsconfig.json            # Configuración base de TypeScript
├── tsconfig.app.json        # Configuración de TypeScript para el código de la app
├── tsconfig.node.json       # Configuración de TypeScript para archivos de config (vite.config.ts)
├── vite.config.ts           # Configuración de Vite (bundler y dev server)
├── eslint.config.js         # Configuración de ESLint (linter) con integración Prettier
├── .prettierrc              # Reglas de formato: sin punto y coma, comillas simples, 2 espacios
└── .gitignore               # Ignora node_modules y dist
```

#### Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el servidor de desarrollo en `localhost:5173` con hot reload |
| `npm run build` | Compila TypeScript y genera el bundle de producción en `dist/` |
| `npm run lint` | Corre ESLint para detectar errores y malas prácticas en el código |
| `npm run format` | Formatea todos los archivos con Prettier (correr en local antes de commit) |
| `npm run format:check` | Verifica el formato sin modificar archivos (lo corre el CI) |
| `npm run preview` | Sirve el build de producción localmente para probar antes de deploy |

---

### Archivos raíz

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` | Levanta el backend en un contenedor Docker con hot reload. Útil para desarrollo local sin instalar Python. El frontend se corre aparte con `npm run dev`. |
| `.gitignore` | Define qué archivos no deben subirse al repositorio: `__pycache__`, `.venv`, `node_modules`, archivos `.env` (secretos), caches de IDEs, artifacts de build. |
| `README.md` | Este archivo. |

---

## Desarrollo Local

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # completar con tus credenciales
uvicorn app.main:app --reload --port 8080
```

El backend queda disponible en `http://localhost:8080`. La documentación interactiva de la API se genera automáticamente en `http://localhost:8080/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

El frontend queda disponible en `http://localhost:5173`.

### Con Docker (solo backend)

```bash
docker compose up --build
```

---

## Testing

```bash
# Backend
cd backend
pytest tests/ -v

# Frontend
cd frontend
npm run lint
npm run format:check
npm run build
```

---

## Equipo

Proyecto de Título 2025 — Pontificia Universidad Católica de Chile
En colaboración con el Instituto Milenio Fundamento de los Datos (IMFD)
