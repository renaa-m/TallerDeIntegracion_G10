FROM node:20-slim AS frontend

# Variables de entorno de Vite — deben estar presentes en tiempo de build
# porque Vite las embebe en el bundle estático.
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN
ENV VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID
ENV VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --prefer-offline
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS backend

WORKDIR /app
COPY backend/requirements.txt .
COPY backend/wukong-engine ./wukong-engine
ENV PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt && \
    pip install --no-cache-dir --prefix=/install ./wukong-engine

FROM python:3.13-slim

WORKDIR /app

COPY --from=backend /install /usr/local
COPY backend/app ./app
# wukong_runner.py busca la config en <app_root>/wukong-engine/config/default.toml.
# El paquete Python se instala vía pip en /install, pero el TOML no es parte del
# paquete instalado, por eso hay que copiarlo explícitamente desde el stage backend.
COPY --from=backend /app/wukong-engine/config ./wukong-engine/config
# Las credenciales de Cloud Vision se escriben en el runner de CI justo antes del build.
# Se copian a /app/gcp-vision-key.json para coincidir con la ruta que main.py
# construye a partir de GOOGLE_APPLICATION_CREDENTIALS=gcp-vision-key.json.
COPY backend/gcp-vision-key.json .
COPY --from=frontend /frontend/dist ./static

# El modelo de embeddings se descarga en el runner de CI con actions/cache
# y se copia aquí para evitar llamadas a HuggingFace en tiempo de build y
# de ejecución. embeddings_service.py lo carga desde esta ruta local.
COPY hf-model /app/models/paraphrase-multilingual-MiniLM-L12-v2

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
