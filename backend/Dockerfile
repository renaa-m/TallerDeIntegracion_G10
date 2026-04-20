FROM python:3.13-slim AS builder

WORKDIR /app

COPY requirements.txt .
COPY wukong-engine ./wukong-engine
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt && \
    pip install --no-cache-dir --prefix=/install ./wukong-engine

FROM python:3.13-slim

WORKDIR /app

COPY --from=builder /install /usr/local
COPY ./app ./app
COPY ./static ./static

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
