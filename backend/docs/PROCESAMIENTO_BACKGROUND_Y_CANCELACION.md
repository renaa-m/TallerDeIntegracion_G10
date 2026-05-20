# Procesamiento en background, cancelación y extensiones futuras

## Qué hay hoy

- **`POST /api/collections/{id}/process`**  
  Marca `processing_text` y encola `wukong_runner.process_collection` (FastAPI `BackgroundTasks`). No hay cola distribuida: el trabajo corre en el mismo proceso que el servidor.

- **`POST /api/collections/{id}/process/cancel`**  
  Marca la fila en `collections` como **`cancelled`** si el estado es `processing_text` o `processing_graph`. El worker **no se mata**: solo deja de avanzar cuando lee el estado en los **puntos seguros** (entre documentos en extracción, antes y después de Wukong).

- **Durante `_run_wukong` (subproceso)**  
  No hay comprobación hasta que el proceso termina. Si necesitás cortar ahí, habría que pasar a `Popen` + `terminate()`/`kill()` y definir limpieza de temporales y estado.

## Migración

- Aplicar `supabase/migrations/006_collection_processing_cancelled.sql` para permitir `processing_status = 'cancelled'`.

## Reintentar después de cancelar

- **`cancelled` no está en** `_PROCESSING_STATUSES` del route de `process`, así que **`POST .../process` vuelve a ser válido** después de una cancelación (misma colección y documentos).
- El segundo run debe partir de datos consistentes: textos ya guardados en `document_texts` si la extracción avanzó; documentos sin extraer siguen en su estado previo.

## Si pasan el pipeline a “verdadero” segundo plano (Cloud Tasks, Celery, RQ, otro worker)

Para que **no haya conflictos** con esta cancelación:

1. **Un solo consumidor por colección**  
   Encolar un job “process collection X” debe ser **idempotente** o usar **deduplicación** (p. ej. no encolar otro si ya hay `processing_*` para esa fila, salvo política explícita de reemplazo).

2. **Misma semántica de `cancelled`**  
   El worker debe leer `collections.processing_status` (o un flag dedicado) en los mismos puntos que `wukong_runner` y salir sin pisar `cancelled` con `error`/`graph_ready` salvo que el diseño lo permita (hoy `_skip_if_user_cancelled` evita sobrescribir tras cancel).

3. **Orden respecto a `POST /process`**  
   Quien encola debería, como ahora, poner **`processing_text` antes** de que arranque el job, para que el front vea estado inmediato y el cancel tenga efecto.

4. **Reinicios del servidor**  
   `BackgroundTasks` se pierde al reiniciar el proceso. Un sistema externo de colas debería **re-encolar** o marcar colecciones en `processing_*` como `error`/`idle` según política de recuperación (documentar explícitamente).

5. **Front**  
   Tras `process/cancel`, el cliente puede seguir polleando `GET /collections/{id}` hasta ver `cancelled`; no borrar la colección por defecto si solo se canceló el pipeline.

## Archivos relevantes

- `app/api/routes/collections.py` — `process`, `process/cancel`
- `app/services/wukong_runner.py` — `ProcessingCancelled`, `_check_cancelled`, `_skip_if_user_cancelled`
- `app/services/supabase_client.py` — `update_collection_processing_status`
