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
from typing import TYPE_CHECKING, Any, Literal

from app.services import cloud_tasks_client, supabase_client, wukong_runner

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)

MAX_CONCURRENT_JOBS: int = 2
MAX_QUEUED_PER_USER: int = 5

ACTIVE_STATUSES = frozenset({"processing_text", "processing_graph"})
QueueAction = Literal["process", "continue_graph"]


class ProcessingSlotBusyError(Exception):
    """Cola llena: el usuario superó MAX_QUEUED_PER_USER colecciones en espera."""

    def __init__(self, blocking: dict[str, Any]):
        self.blocking = blocking
        super().__init__(blocking.get("name") or blocking.get("id"))


class ProcessingDispatchError(Exception):
    """No se pudo encolar el procesamiento (p. ej. Cloud Tasks/GCP no disponible)."""


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


def _enqueue_cloud_task(
    *,
    collection_id: str,
    user_id: str,
    action: QueueAction,
    custom_data_model: dict | None,
) -> None:
    if cloud_tasks_client.is_configured():
        cloud_tasks_client.enqueue_processing_task(
            collection_id=collection_id,
            user_id=user_id,
            action=action,
            custom_data_model=custom_data_model,
        )
        return

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
    try:
        _enqueue_cloud_task(
            collection_id=collection_id,
            user_id=user_id,
            action=action,
            custom_data_model=custom_data_model,
        )
    except Exception as exc:
        # No se pudo encolar (Cloud Tasks/GCP caído). Se revierte el estado para
        # que la colección no quede colgada en "processing_*" sin tarea, y se
        # señala un error de despacho para que el endpoint responda 503.
        logger.exception(
            "No se pudo encolar el procesamiento de la colección %s", collection_id
        )
        try:
            supabase_client.update_collection_processing_status(
                collection_id,
                "error",
                error_message=(
                    "No se pudo iniciar el procesamiento. "
                    "Intenta de nuevo en unos minutos."
                ),
            )
        except Exception:
            logger.exception(
                "Tampoco se pudo revertir el estado de la colección %s", collection_id
            )
        raise ProcessingDispatchError() from exc


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
                texts = supabase_client.get_document_texts_by_collection(collection_id)
                if texts:
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

    return {"status": "completed", "detail": ""}


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
                try_resume_stale_job(collection_id, user_id)
            except Exception as exc:
                logger.warning(
                    "No se pudo re-encolar colección %s: %s", collection_id, exc
                )

    try:
        _try_dispatch_queued_from_db()
    except Exception as exc:
        logger.warning("No se pudo despachar cola tras reinicio: %s", exc)


def try_resume_stale_job(collection_id: str, user_id: str) -> bool:
    """Re-encola un job en ``processing_*`` tras reinicio del servidor."""
    row = supabase_client.get_collection(collection_id, user_id)
    if not row:
        return False

    status = row.get("processing_status")
    if status == "queued" and row.get("queue_action"):
        _try_dispatch_queued_from_db()
        return True

    if status not in ACTIVE_STATUSES:
        return False

    if not _can_dispatch(user_id, collection_id):
        return False

    custom_model = _custom_model_from_row(row)
    action: QueueAction = (
        "continue_graph" if status == "processing_graph" else "process"
    )
    if action == "process" and status == "processing_text":
        texts = supabase_client.get_document_texts_by_collection(collection_id)
        if texts:
            action = "continue_graph"

    _enqueue_cloud_task(
        collection_id=collection_id,
        user_id=user_id,
        action=action,
        custom_data_model=custom_model,
    )
    return True


def ensure_collection_processing(collection_id: str, user_id: str) -> None:
    try:
        try_resume_stale_job(collection_id, user_id)
        _try_dispatch_queued_from_db()
    except Exception as exc:
        logger.warning(
            "ensure_collection_processing falló para %s: %s", collection_id, exc
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
