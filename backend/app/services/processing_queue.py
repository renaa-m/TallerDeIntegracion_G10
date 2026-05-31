"""Pipeline de procesamiento: una colección activa por usuario (sin cola)."""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, Any

from app.services import supabase_client, wukong_runner

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = frozenset({"processing_text", "processing_graph"})
_SLOT_HELD = frozenset(
    {
        "processing_text",
        "processing_graph",
        "awaiting_graph_confirmation",
    }
)

_running_jobs: set[str] = set()
_running_jobs_guard = threading.Lock()


class ProcessingSlotBusyError(Exception):
    """Otra colección del usuario ocupa el slot de procesamiento."""

    def __init__(self, blocking: dict[str, Any]):
        self.blocking = blocking
        super().__init__(blocking.get("name") or blocking.get("id"))


def _mark_job_running(collection_id: str) -> None:
    with _running_jobs_guard:
        _running_jobs.add(collection_id)


def _mark_job_finished(collection_id: str) -> None:
    with _running_jobs_guard:
        _running_jobs.discard(collection_id)


def _find_in_memory_blocker(
    user_id: str,
    *,
    exclude_collection_id: str | None = None,
) -> dict[str, Any] | None:
    with _running_jobs_guard:
        for running_id in _running_jobs:
            if exclude_collection_id and running_id == exclude_collection_id:
                continue
            row = supabase_client.get_collection_by_id(running_id)
            if row is not None and row.get("user_id") == user_id:
                return {
                    "id": running_id,
                    "name": row.get("name") or "Colección",
                    "processing_status": row.get("processing_status"),
                }
    return None


def _assert_slot_available(
    user_id: str,
    collection_id: str,
    *,
    exclude_self: bool = False,
) -> None:
    exclude = collection_id if exclude_self else None
    blocking = supabase_client.get_user_blocking_collection(
        user_id,
        exclude_collection_id=exclude,
    )
    if blocking is None:
        blocking = _find_in_memory_blocker(
            user_id,
            exclude_collection_id=exclude,
        )
    if blocking is not None:
        raise ProcessingSlotBusyError(blocking)


def _dispatch_process_job(
    collection_id: str,
    custom_data_model: dict | None = None,
) -> None:
    thread = threading.Thread(
        target=_run_process_job,
        args=(collection_id, custom_data_model),
        daemon=True,
        name=f"process-job-{collection_id}",
    )
    thread.start()


def _dispatch_continue_graph_job(collection_id: str) -> None:
    thread = threading.Thread(
        target=_run_continue_graph_job,
        args=(collection_id,),
        daemon=True,
        name=f"continue-graph-{collection_id}",
    )
    thread.start()


def request_process(
    collection_id: str,
    user_id: str,
    background_tasks: BackgroundTasks,
    *,
    custom_data_model: dict | None = None,
) -> str:
    """Inicia extracción + grafo, o lanza ``ProcessingSlotBusyError``."""
    del background_tasks
    _assert_slot_available(user_id, collection_id)
    supabase_client.update_collection_processing_status(
        collection_id, "processing_text"
    )
    _dispatch_process_job(collection_id, custom_data_model)
    return "processing_text"


def request_continue_graph(
    collection_id: str,
    user_id: str,
    background_tasks: BackgroundTasks,
) -> str:
    """Inicia solo la fase de grafo, o lanza ``ProcessingSlotBusyError``."""
    del background_tasks
    _assert_slot_available(user_id, collection_id, exclude_self=True)
    supabase_client.update_collection_processing_status(
        collection_id, "processing_graph"
    )
    _dispatch_continue_graph_job(collection_id)
    return "processing_graph"


def drain_user_queue(user_id: str) -> None:
    """Compatibilidad: limpia filas ``queued`` legacy (sin auto-iniciar jobs)."""
    clear_legacy_queued_collections(user_id)


def drain_for_collection(completed_collection_id: str) -> None:
    """Sin cola: no-op (compatibilidad con llamadas existentes)."""
    del completed_collection_id


def clear_legacy_queued_collections(user_id: str) -> None:
    """Estado ``queued`` ya no se usa; dejar colecciones en idle."""
    try:
        rows = supabase_client.list_collections_by_processing_statuses(
            ("queued",),
            user_id=user_id,
        )
    except Exception as exc:
        logger.warning("No se pudo limpiar cola legacy: %s", exc)
        return
    for row in rows:
        supabase_client.clear_collection_queue_metadata(row["id"])
        supabase_client.update_collection_processing_status(
            row["id"],
            "idle",
            error_message="",
        )


def recover_orphaned_processing() -> None:
    """Tras reinicio: resetear jobs huérfanos y cola legacy."""
    try:
        stale = supabase_client.list_collections_by_processing_statuses(
            ("processing_text", "processing_graph", "queued")
        )
    except Exception as exc:
        logger.warning(
            "Recuperación de pipeline omitida al arrancar (sin acceso a DB): %s",
            exc,
        )
        return

    for row in stale:
        collection_id = row["id"]
        status = row.get("processing_status")
        logger.warning(
            "Recuperación: colección %s en %s tras reinicio; marcando idle",
            collection_id,
            status,
        )
        supabase_client.clear_collection_queue_metadata(collection_id)
        message = (
            "Procesamiento interrumpido al reiniciar el servidor. "
            "Puedes generar el grafo de nuevo."
            if status in ACTIVE_STATUSES
            else ""
        )
        supabase_client.update_collection_processing_status(
            collection_id,
            "idle",
            error_message=message,
        )


def _run_process_job(
    collection_id: str,
    custom_data_model: dict | None = None,
) -> None:
    _mark_job_running(collection_id)
    try:
        wukong_runner.process_collection(collection_id, custom_data_model)
    finally:
        _mark_job_finished(collection_id)


def _run_continue_graph_job(collection_id: str) -> None:
    _mark_job_running(collection_id)
    try:
        wukong_runner.process_graph_collection(
            collection_id,
            None,
            "partial_error",
        )
    finally:
        _mark_job_finished(collection_id)


def busy_detail_message(blocking: dict[str, Any]) -> str:
    name = blocking.get("name") or "Otra colección"
    return (
        f"Se está procesando «{name}». "
        "Espera a que termine antes de generar el grafo en otra colección."
    )
