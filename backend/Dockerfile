# ETAPA 1: Builder
FROM python:3.13-slim AS builder

WORKDIR /app

# Instalamos dependencias de sistema necesarias para compilar torch/numpy
# y las dependencias nativas que pueda tener wukong-engine
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copiamos archivos de dependencias
COPY requirements.txt .
COPY wukong-engine ./wukong-engine

# Instalamos las dependencias en una ruta temporal
# Agregamos --extra-index-url por si acaso para torch
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt && \
    pip install --no-cache-dir --prefix=/install ./wukong-engine

# ETAPA 2: Runtime
FROM python:3.13-slim

WORKDIR /app

# Instalamos dependencias de ejecución (runtime) que no se copian del builder
# libpq-dev es común si usas PostgreSQL/Supabase
RUN apt-get update && apt-get install -y \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copiamos lo instalado desde el builder
COPY --from=builder /install /usr/local
# Copiamos el código y archivos estáticos
COPY ./app ./app
#COPY ./static ./static
# IMPORTANTE: Copia el .env si no lo vas a pasar por comando (aunque es mejor pasarlo por comando)
# COPY .env .env 

EXPOSE 8080

# Variable de entorno para que Python no guarde .pyc y muestre logs rápido
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]