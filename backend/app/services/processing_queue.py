"""Cola de procesamiento con Google Cloud Tasks.

Modelo
──────
- La cola de ejecución vive en **Cloud Tasks** (GCP).
- Supabase guarda ``processing_status`` y filas ``queued`` pendientes de despacho.
- Límites de negocio:
  - MAX_CONCURRENT_JOBS global (también reflejado en la cola de Cloud Tasks).
  - 1 job activo por usuario.
  - MAX_QUEUED_PER_USER colecciones en espera por usuario.

Flujo
─────
  POST /process
      ├─ hay capacidad → processing_* + encolar Cloud Task
      └─ sin capacidad   → estado ``queued`` en Supabase (sin task aún)

  Al terminar un job (worker / fallback local)
      └─ _try_dispatch_queued_from_db() encola el siguiente candidato FIFO
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Literal

import requests

from app.config import settings
from app.services import cloud_tasks_client, supabase_client, wukong_runner

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)

MAX_CONCURRENT_JOBS: int = 2
MAX_QUEUED_PER_USER: int = 5
# Sin actualizaciones en DB durante este intervalo → job probablemente huérfano.
STALE_PROCESSING_SECONDS: int = 120

ACTIVE_STATUSES = frozenset({"processing_text", "processing_graph"})
QueueAction = Literal["process", "continue_graph"]


class ProcessingSlotBusyError(Exception):
    """Cola llena: el usuario superó MAX_QUEUED_PER_USER colecciones en espera."""

    def __init__(self, blocking: dict[str, Any]):
        self.blocking = blocking
        super().__init__(blocking.get("name") or blocking.get("id"))


# ──────────────────────────────────────────────────────────────────────────────
# Capacidad / despacho
# ──────────────────────────────────────────────────────────────────────────────

def _can_dispatch(user_id: str, collection_id: str) -> bool:
    blocking = supabase_client.get_user_blocking_collection(
        user_id, exclude_collection_id=collection_id
    )
    if blocking is not None:
        return False
    active = supabase_client.count_active_processing_jobs()
    if active >= MAX_CONCURRENT_JOBS:
        row = supabase_client.get_collection_by_id(collection_id)
        if row and row.get("processing_status") in ACTIVE_STATUSES:
            return True
        return False
    return True


def _next_processing_status(action: QueueAction) -> str:
    return "processing_graph" if action == "continue_graph" else "processing_text"


def _post_dev_worker_job(
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    url = f"{settings.dev_worker_http_url.rstrip('/')}/internal/tasks/run"
    payload = {
        "collection_id": collection_id,
        "user_id": user_id,
        "action": action,
        "custom_data_model": custom_data_model,
    }
    try:
        response = requests.post(url, json=payload, timeout=3600)
        response.raise_for_status()
        logger.info(
            "Dev worker completó job action=%s collection=%s status=%s",
            action,
            collection_id,
            response.status_code,
        )
    except Exception as exc:
        logger.exception(
            "Dev worker HTTP falló action=%s collection=%s: %s",
            action,
            collection_id,
            exc,
        )


def _enqueue_cloud_task(
    *,
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    logger.info(
        "_enqueue_cloud_task: action=%s collection=%s cloud_tasks_configured=%s dev_worker=%s",
        action, collection_id, cloud_tasks_client.is_configured(),
        bool(settings.dev_worker_http_url.strip()),
    )
    if cloud_tasks_client.is_configured():
        cloud_tasks_client.enqueue_processing_task(
            collection_id=collection_id,
            user_id=user_id,
            action=action,
            custom_data_model=custom_data_model,
        )
        return

    if settings.dev_worker_http_url.strip():
        thread = threading.Thread(
            target=_post_dev_worker_job,
            args=(collection_id, user_id, action, custom_data_model),
            daemon=True,
            name=f"dev-worker-{action}-{collection_id}",
        )
        thread.start()
        return

    logger.info("_enqueue_cloud_task: fallback a hilo local para %s", collection_id)
    thread = threading.Thread(
        target=_run_job_sync,
        args=(collection_id, user_id, action, custom_data_model),
        daemon=True,
        name=f"local-{action}-{collection_id}",
    )
    thread.start()


def _dispatch_job(
    *,
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    supabase_client.clear_collection_queue_metadata(collection_id)
    supabase_client.update_collection_processing_status(
        collection_id, _next_processing_status(action)
    )
    _enqueue_cloud_task(
        collection_id=collection_id,
        user_id=user_id,
        action=action,
        custom_data_model=custom_data_model,
    )


def _try_dispatch_queued_from_db() -> None:
    """Despacha jobs ``queued`` en Supabase cuando hay capacidad."""
    busy_users: set[str] = set()
    active = supabase_client.count_active_processing_jobs()

    for candidate in supabase_client.get_next_queued_jobs(
        limit=MAX_CONCURRENT_JOBS + MAX_QUEUED_PER_USER
    ):
        if active >= MAX_CONCURRENT_JOBS:
            break

        user_id = candidate["user_id"]
        collection_id = candidate["id"]

        if user_id in busy_users:
            continue
        if supabase_client.get_user_blocking_collection(
            user_id, exclude_collection_id=collection_id
        ):
            busy_users.add(user_id)
            continue

        queue_action: QueueAction = candidate.get("queue_action") or "process"
        queue_payload = candidate.get("queue_payload") or {}
        custom_model = (
            queue_payload.get("custom_data_model")
            if isinstance(queue_payload, dict)
            else None
        )

        try:
            _dispatch_job(
                collection_id=collection_id,
                user_id=user_id,
                action=queue_action,
                custom_data_model=custom_model,
            )
        except Exception as exc:
            logger.warning(
                "No se pudo despachar colección encolada %s: %s",
                collection_id,
                exc,
            )
            continue

        busy_users.add(user_id)
        active += 1


def _queue_in_db(
    *,
    collection_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    payload = {"custom_data_model": custom_data_model} if custom_data_model else None
    supabase_client.set_collection_queued(collection_id, action, payload=payload)


# ──────────────────────────────────────────────────────────────────────────────
# API pública
# ──────────────────────────────────────────────────────────────────────────────

def request_process(
    collection_id: str,
    user_id: str,
    background_tasks: "BackgroundTasks",
    *,
    custom_data_model: dict | None = None,
) -> str:
    del background_tasks

    queued_count = supabase_client.count_user_queued_collections(user_id)
    if queued_count >= MAX_QUEUED_PER_USER:
        raise ProcessingSlotBusyError(
            {"name": f"Ya tienes {MAX_QUEUED_PER_USER} colecciones esperando en cola."}
        )

    if _can_dispatch(user_id, collection_id):
        _dispatch_job(
            collection_id=collection_id,
            user_id=user_id,
            action="process",
            custom_data_model=custom_data_model,
        )
        return "processing_text"

    _queue_in_db(
        collection_id=collection_id,
        action="process",
        custom_data_model=custom_data_model,
    )
    logger.info(
        "Colección %s encolada en Supabase (usuario %s, queued=%d)",
        collection_id,
        user_id,
        queued_count + 1,
    )
    return "queued"


def request_continue_graph(
    collection_id: str,
    user_id: str,
    background_tasks: "BackgroundTasks",
    custom_data_model: dict | None = None,
) -> str:
    del background_tasks

    queued_count = supabase_client.count_user_queued_collections(user_id)
    if queued_count >= MAX_QUEUED_PER_USER:
        raise ProcessingSlotBusyError(
            {"name": f"Ya tienes {MAX_QUEUED_PER_USER} colecciones esperando en cola."}
        )

    if _can_dispatch(user_id, collection_id):
        _dispatch_job(
            collection_id=collection_id,
            user_id=user_id,
            action="continue_graph",
            custom_data_model=custom_data_model,
        )
        return "processing_graph"

    _queue_in_db(
        collection_id=collection_id,
        action="continue_graph",
        custom_data_model=custom_data_model,
    )
    return "queued"


# ──────────────────────────────────────────────────────────────────────────────
# Worker (Cloud Tasks HTTP o hilo local en dev)
# ──────────────────────────────────────────────────────────────────────────────

def _custom_model_from_row(row: dict) -> dict | None:
    payload = row.get("queue_payload") or {}
    if isinstance(payload, dict):
        return payload.get("custom_data_model")
    return None


def execute_job(
    *,
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None = None,
) -> dict[str, str]:
    """Ejecuta un job de procesamiento. Invocado por Cloud Tasks o fallback local."""
    row = supabase_client.get_collection(collection_id, user_id)
    if not row:
        return {"status": "skipped", "detail": "Colección no encontrada."}

    status = row.get("processing_status")
    if status == "cancelled":
        return {"status": "skipped", "detail": "Colección cancelada."}

    blocking = supabase_client.get_user_blocking_collection(
        user_id, exclude_collection_id=collection_id
    )
    if blocking is not None:
        return {
            "status": "skipped",
            "detail": "Usuario con otra colección activa.",
        }

    active = supabase_client.count_active_processing_jobs()
    if active >= MAX_CONCURRENT_JOBS and status not in ACTIVE_STATUSES:
        return {"status": "skipped", "detail": "Capacidad global llena."}

    model = custom_data_model or _custom_model_from_row(row)

    if action == "continue_graph" and not _text_extraction_complete(collection_id):
        return {
            "status": "skipped",
            "detail": "Extracción de textos aún en curso.",
        }

    supabase_client.clear_collection_queue_metadata(collection_id)

    try:
        if action == "continue_graph":
            supabase_client.update_collection_processing_status(
                collection_id, "processing_graph"
            )
            wukong_runner.process_graph_collection(
                collection_id,
                custom_data_model=model,
                final_status_on_success="partial_error",
            )
        else:
            if status == "processing_graph":
                wukong_runner.process_graph_collection(
                    collection_id,
                    custom_data_model=model,
                    final_status_on_success="partial_error",
                )
            elif status == "processing_text":
                if _text_extraction_complete(collection_id):
                    supabase_client.update_collection_processing_status(
                        collection_id, "processing_graph"
                    )
                    wukong_runner.process_graph_collection(
                        collection_id,
                        custom_data_model=model,
                        final_status_on_success="partial_error",
                    )
                else:
                    wukong_runner.process_collection(collection_id, model)
            else:
                supabase_client.update_collection_processing_status(
                    collection_id, "processing_text"
                )
                wukong_runner.process_collection(collection_id, model)
    finally:
        try:
            _try_dispatch_queued_from_db()
        except Exception as exc:
            logger.warning(
                "Error al despachar cola tras job %s: %s", collection_id, exc
            )

    final_row = supabase_client.get_collection(collection_id, user_id)
    if final_row and final_row.get("processing_status") in ACTIVE_STATUSES:
        logger.warning(
            "Job %s terminó pero colección %s sigue en %s",
            action,
            collection_id,
            final_row.get("processing_status"),
        )
        return {"status": "incomplete", "detail": "Pipeline no finalizó."}

    return {"status": "completed", "detail": ""}


def should_retry_cloud_task(result: dict[str, str]) -> bool:
    """True si Cloud Tasks debe reintentar (HTTP 503)."""
    status = result.get("status")
    if status == "incomplete":
        return True
    if status != "skipped":
        return False
    detail = result.get("detail", "")
    return detail in (
        "Capacidad global llena.",
        "Usuario con otra colección activa.",
        "Extracción de textos aún en curso.",
    )


def _run_job_sync(
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    try:
        execute_job(
            collection_id=collection_id,
            user_id=user_id,
            action=action,
            custom_data_model=custom_data_model,
        )
    except Exception as exc:
        logger.exception("Job local falló para %s: %s", collection_id, exc)


# ──────────────────────────────────────────────────────────────────────────────
# Recuperación y utilidades
# ──────────────────────────────────────────────────────────────────────────────

def recover_orphaned_processing() -> None:
    """Tras reinicio: re-encola jobs huérfanos y despacha filas ``queued``."""
    try:
        stale = supabase_client.list_collections_by_processing_statuses(
            ("processing_text", "processing_graph", "queued")
        )
    except Exception as exc:
        logger.warning(
            "Recuperación de pipeline omitida al arrancar (sin acceso a DB): %s", exc
        )
        return

    for row in stale:
        collection_id = row["id"]
        status = row.get("processing_status")
        user_id = row.get("user_id")
        if not user_id:
            continue

        if status == "queued":
            continue

        if status in ACTIVE_STATUSES:
            logger.warning(
                "Recuperación: re-encolando Cloud Task para %s (%s)",
                collection_id,
                status,
            )
            try:
                try_resume_stale_job(
                    collection_id, user_id, from_startup_recovery=True
                )
            except Exception as exc:
                logger.warning(
                    "No se pudo re-encolar colección %s: %s", collection_id, exc
                )

    try:
        _try_dispatch_queued_from_db()
    except Exception as exc:
        logger.warning("No se pudo despachar cola tras reinicio: %s", exc)


def _text_extraction_complete(collection_id: str) -> bool:
    """True si todos los documentos de la colección ya tienen fila en document_texts."""
    documents = supabase_client.get_documents_by_collection(collection_id)
    if not documents:
        return False
    texts = supabase_client.get_document_texts_by_collection(collection_id)
    text_doc_ids = {str(row["document_id"]) for row in texts}
    return all(str(doc["id"]) in text_doc_ids for doc in documents)


def _processing_job_stale(row: dict) -> bool:
    """True si la fila no se actualizó recientemente (worker probablemente caído)."""
    raw = row.get("updated_at")
    if not raw:
        # Sin timestamp no podemos saber si hay un job activo; no reencolar por polling.
        return False
    try:
        if isinstance(raw, str):
            updated = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        else:
            updated = raw
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        return age >= STALE_PROCESSING_SECONDS
    except (TypeError, ValueError):
        return True


def try_resume_stale_job(
    collection_id: str,
    user_id: str,
    *,
    from_startup_recovery: bool = False,
) -> bool:
    """Re-encola un job en ``processing_*`` si quedó huérfano.

    ``from_startup_recovery=True`` (arranque del API): reencola agresivamente.
    En polling del frontend (``False``): no compite con un Cloud Task ya en vuelo.
    """
    row = supabase_client.get_collection(collection_id, user_id)
    if not row:
        return False

    status = row.get("processing_status")
    if status == "queued" and row.get("queue_action"):
        _try_dispatch_queued_from_db()
        return True

    if status not in ACTIVE_STATUSES:
        return False

    if not from_startup_recovery:
        # El task ``process`` hace extracción + grafo en la misma petición HTTP.
        if status == "processing_text":
            return False
        if status == "processing_graph" and not _processing_job_stale(row):
            return False

    if not _can_dispatch(user_id, collection_id):
        return False

    custom_model = _custom_model_from_row(row)
    action: QueueAction = (
        "continue_graph" if status == "processing_graph" else "process"
    )
    if from_startup_recovery and action == "process" and status == "processing_text":
        if _text_extraction_complete(collection_id):
            action = "continue_graph"

    _enqueue_cloud_task(
        collection_id=collection_id,
        user_id=user_id,
        action=action,
        custom_data_model=custom_model,
    )
    return True


def ensure_collection_processing(collection_id: str, user_id: str) -> None:
    """Despacha filas ``queued`` en Supabase. No reencola Cloud Tasks en polling.

    Reencolar ``processing_*`` desde el GET del frontend duplicaba tasks
    (``continue_graph`` mientras ``process`` seguía corriendo). La recuperación
    de jobs huérfanos queda solo en ``recover_orphaned_processing`` al arrancar.
    """
    del collection_id, user_id
    try:
        _try_dispatch_queued_from_db()
    except Exception as exc:
        logger.warning(
            "ensure_collection_processing falló al despachar cola: %s", exc
        )


def nudge_processing_queue() -> None:
    try:
        _try_dispatch_queued_from_db()
    except Exception as exc:
        logger.warning("Nudge de cola falló: %s", exc)


def drain_user_queue(user_id: str) -> None:
    clear_legacy_queued_collections(user_id)


def drain_for_collection(completed_collection_id: str) -> None:
    del completed_collection_id


def clear_legacy_queued_collections(user_id: str) -> None:
    try:
        rows = supabase_client.list_collections_by_processing_statuses(
            ("queued",),
            user_id=user_id,
        )
    except Exception as exc:
        logger.warning("No se pudo limpiar cola legacy: %s", exc)
        return
    for row in rows:
        if not row.get("queue_action"):
            supabase_client.clear_collection_queue_metadata(row["id"])
            supabase_client.update_collection_processing_status(
                row["id"], "idle", error_message=""
            )


def busy_detail_message(blocking: dict[str, Any]) -> str:
    return blocking.get("name") or "Cola llena"


def is_job_running(collection_id: str) -> bool:
    row = supabase_client.get_collection_by_id(collection_id)
    return bool(row and row.get("processing_status") in ACTIVE_STATUSES)
