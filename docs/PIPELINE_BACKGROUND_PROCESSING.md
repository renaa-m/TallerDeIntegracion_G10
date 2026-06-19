# Procesamiento en segundo plano — modelo estándar para todas las colecciones

Rama: `feature/background-processing`.

Este documento define **cómo debe procesarse cualquier colección** (1 doc o 200): siempre en segundo plano, sin bloquear la API, con progreso visible y recuperación robusta. Las colecciones grandes no son un caso especial: son el peor escenario del **mismo** diseño.

## Principios (todas las colecciones)

| Principio | Implicación |
|-----------|-------------|
| **Siempre async** | `POST /generate-graph` → **202** + Cloud Task. Nunca pipeline completo en el request del usuario. |
| **API ≠ Worker** | En producción, dos servicios Cloud Run: la app responde; el workers procesa. |
| **Mismo pipeline, lotes adaptativos** | 3 docs → 1 lote; 94 docs → varios lotes. Misma lógica, distinto número de tasks. |
| **Estado en Supabase** | Fuente de verdad para UI, recovery y operación (no depender de memoria del proceso). |
| **Idempotente** | Reintentos y reinicios continúan donde quedó, sin saltar fases incompletas. |

---

## Problema actual

```
┌─────────────────────────────────────────────────────────────┐
│  imfd-backend (1 instancia)                                 │
│  SPA + API + /internal/tasks/run (extracción + Wukong + …)  │
└─────────────────────────────────────────────────────────────┘
         ↑ usuario                    ↑ Cloud Tasks (misma URL)
```

Afecta **cualquier** colección en procesamiento, no solo las grandes:

- 5 docs: la app ya se siente lenta si alguien navega durante el job.
- 94 docs: timeouts, 504, UI congelada, recovery incorrecta.

Causas técnicas:

- Un job monolítico compite con upload, search, delete y polling.
- Cloud Tasks HTTP: máximo **30 min** por task; un pipeline entero puede ser mucho más.
- Upload secuencial (independiente del grafo, pero empeora la UX global).

---

## Arquitectura objetivo

### Flujo unificado (1 doc o N docs)

```
Usuario: Generar grafo
    │
    ▼
imfd-backend (API) ──202──► encola fase 1 en Cloud Tasks
    │
    │  (usuario sigue usando la app)
    ▼
imfd-worker ejecuta fases encadenadas:

  [extract_batch]*  ──► 1..k lotes según N documentos
  [build_graph]     ──► Wukong (solo textos listos)
  [embed_chunks]    ──► búsqueda semántica

* Si N ≤ batch_size → un solo lote (sin penalizar colecciones pequeñas).
```

### Tamaño de lote adaptativo

Configuración única (`PIPELINE_EXTRACTION_BATCH_SIZE`, default 15):

| Docs en colección | Comportamiento |
|-------------------|----------------|
| 1–15 | **1 task** de extracción |
| 16–30 | 2 tasks |
| 94 | 7 tasks (~14 docs c/u) |

No hay rama `if docs > 90` en producto ni en código: solo `ceil(n / batch_size)`.

Tiempo orientativo por fase (varía por OCR/Wukong):

- Colección pequeña (3 PDFs texto): **minutos**.
- Colección mediana (20 PDFs): **decenas de min**.
- Colección grande (94 PDFs escaneados): **horas** — mismo mecanismo, más tasks.

---

## Fase 1 — Separar API y Worker (prod, todas las colecciones)

```
  Usuario ──► imfd-backend (API)     timeout ~60s, escala con tráfico
                    │
                    ▼ Cloud Tasks
              imfd-worker            timeout 3600s, 4 CPU, escala con jobs
```

| Variable | API | Worker |
|----------|-----|--------|
| `IMFD_SERVICE_ROLE` | `api` | `worker` |
| `CLOUD_TASKS_WORKER_URL` | URL del workers | — |

**Local dev:** `IMFD_SERVICE_ROLE=all` (monolito, como hoy).

Script: `infra/cloud_run/deploy-worker.sh`

---

## Fase 2 — Pipeline por fases (default del producto)

Acciones de cola (todas las colecciones):

| Acción | Cuándo |
|--------|--------|
| `extract_batch` | Siempre primero; payload con ids pendientes o offset/limit |
| `build_graph` | Cuando `text_progress_processed == text_progress_total` |
| `embed_chunks` | Tras Wukong OK |

Reglas:

- `dispatch_deadline=1800` (30 min max GCP) **por task**.
- Al terminar un lote: encolar siguiente lote o `build_graph`.
- Recovery: `processing_text` + extracción incompleta → `extract_batch`, nunca `continue_graph` hasta terminar textos.

Ventajas para **cualquier** tamaño:

- Reintento barato (un lote, no todo el pipeline).
- Progreso granular en UI (`text_progress_processed / total`).
- API siempre libre (Fase 1).

---

## Fase 3 — UX y operación (todas las colecciones)

**Frontend**

- Polling de progreso en **landing**, colección concreta y modal (no solo `/nueva`).
- Banner global: “Colección X: extracción 3/12” — mismo componente para 3 o 120 docs.
- Generar grafo siempre muestra estado; nunca bloquea la navegación.

**Upload**

- Paralelo o `/upload/batch` — beneficia 5 docs y 94 por igual.

**Delete**

- Async / por lotes — cualquier colección con muchos archivos.

---

## Cambios en esta rama (Fase 0 — cimientos)

| Archivo | Cambio |
|---------|--------|
| `app/config.py` | `imfd_service_role`, `cloud_tasks_worker_url`, `pipeline_extraction_batch_size` |
| `app/main.py` | Rutas según rol; recovery solo en API |
| `cloud_tasks_client.py` | Worker URL + `dispatch_deadline=1800s` |
| `internal_tasks.py` | `execute_job` en `asyncio.to_thread` |
| `processing_queue.py` | Recovery: grafo solo si extracción **completa** |
| `infra/cloud_run/deploy-worker.sh` | Deploy workers |
| Tests | Recovery parcial vs completo |

---

## Criterios de éxito (cualquier N)

1. Con **cualquier** job activo, `GET /health` y `GET /api/collections` en **API** responden en < 2 s.
2. `text_progress_processed` refleja avance real (1/3, 12/12, 47/94…).
3. Reinicio del workers no pierde progreso ni salta fases.
4. Colección de **1 doc** no paga overhead absurdo (1 task de extracción, no 5).
5. Colección de **94 docs** no supera 30 min por task sin trocear.

---

## Orden de PRs

1. **PR1** (esta rama): cimientos + fix recovery + doc + config de batch.
2. **PR2**: CD dual API/worker.
3. **PR3**: `extract_batch` + encadenamiento (pipeline default para todos).
4. **PR4**: UX polling global + upload paralelo.
5. **PR5**: delete async.
