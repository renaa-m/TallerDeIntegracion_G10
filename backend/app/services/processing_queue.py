"""Cola de procesamiento: múltiples usuarios en paralelo, múltiples colecciones por usuario.

Modelo de concurrencia
──────────────────────
- MAX_CONCURRENT_JOBS : tope global de jobs activos simultáneamente (limitado por RAM y
                        rate limits de OpenAI compartidos entre todos los usuarios).
- MAX_QUEUED_PER_USER : máximo de colecciones que un usuario puede tener esperando en cola.
                        Si lo supera, la petición se rechaza con 429.
- 1 job activo por usuario: un usuario no puede tener dos colecciones procesando al mismo
                        tiempo, pero sí puede encolar las siguientes.

Ciclo de vida de un job
───────────────────────
  request_process() / request_continue_graph()
      ├─ slot disponible (usuario sin activo + global < MAX) → arranca inmediatamente
      └─ slot ocupado                                        → estado "queued" en DB

  cuando un job termina (_run_*_job → finally)
      └─ _try_dequeue_next() busca el próximo job encolado que pueda arrancar y lo despacha

Estado en memoria vs. DB
─────────────────────────
_running_jobs (dict collection_id → user_id) es la fuente de verdad en caliente.
La DB (processing_status) es la fuente de verdad persistente; se usa para:
  - Recuperar jobs huérfanos tras un reinicio (recover_orphaned_processing).
  - Contar activos globales cuando el dict en memoria no está disponible (inicio).
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, Any

from app.services import supabase_client, wukong_runner

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)

MAX_CONCURRENT_JOBS: int = 2
MAX_QUEUED_PER_USER: int = 5

ACTIVE_STATUSES = frozenset({"processing_text", "processing_graph"})
_SLOT_HELD = frozenset(
    {
        "processing_text",
        "processing_graph",
        "awaiting_graph_confirmation",
    }
)

# collection_id → user_id de los jobs que están corriendo ahora mismo
_running_jobs: dict[str, str] = {}
_job_threads: dict[str, threading.Thread] = {}
_running_jobs_guard = threading.Lock()


# ──────────────────────────────────────────────────────────────────────────────
# Gestión del estado en memoria
# ──────────────────────────────────────────────────────────────────────────────

def _mark_job_running(collection_id: str, user_id: str) -> None:
    with _running_jobs_guard:
        _running_jobs[collection_id] = user_id


def _mark_job_finished(collection_id: str) -> None:
    with _running_jobs_guard:
        _running_jobs.pop(collection_id, None)
        _job_threads.pop(collection_id, None)


def _is_job_alive(collection_id: str) -> bool:
    with _running_jobs_guard:
        thread = _job_threads.get(collection_id)
    return thread is not None and thread.is_alive()


def _active_job_count() -> int:
    with _running_jobs_guard:
        return len(_running_jobs)


def _users_with_active_jobs() -> set[str]:
    with _running_jobs_guard:
        return set(_running_jobs.values())


def _reserve_job_slot(collection_id: str, user_id: str) -> None:
    """Reserva el slot en memoria de forma síncrona, antes de arrancar el thread.

    Sin esto, dos peticiones consecutivas pueden pasar el chequeo de ``user_busy``
    antes de que el thread llame a ``_mark_job_running``.
    """
    _mark_job_running(collection_id, user_id)


def _release_job_slot(collection_id: str) -> None:
    _mark_job_finished(collection_id)


def _reconcile_running_jobs() -> None:
    """Libera slots en memoria cuyo job ya no está activo en DB o cuyo thread murió.

    Tras un reload de uvicorn, reinicio o crash, ``_running_jobs`` puede quedar
    con entradas fantasma que impiden desencolar colecciones en ``queued``.
    """
    with _running_jobs_guard:
        collection_ids = list(_running_jobs.keys())

    for collection_id in collection_ids:
        try:
            row = supabase_client.get_collection_by_id(collection_id)
        except Exception as exc:
            logger.warning(
                "Reconciliación omitida para colección %s: %s",
                collection_id,
                exc,
            )
            continue

        db_status = row.get("processing_status") if row else None
        with _running_jobs_guard:
            thread = _job_threads.get(collection_id)
        thread_alive = thread is not None and thread.is_alive()
        db_active = db_status in ACTIVE_STATUSES

        if row is None or not db_active:
            _release_job_slot(collection_id)
            logger.info(
                "Reconciliación: slot liberado para %s (DB=%s)",
                collection_id,
                db_status or "missing",
            )
        elif thread is not None and not thread_alive:
            _release_job_slot(collection_id)
            logger.warning(
                "Reconciliación: job huérfano %s (DB=%s, thread muerto)",
                collection_id,
                db_status,
            )


# ──────────────────────────────────────────────────────────────────────────────
# Excepciones públicas
# ──────────────────────────────────────────────────────────────────────────────

class ProcessingSlotBusyError(Exception):
    """Cola llena: el usuario superó MAX_QUEUED_PER_USER colecciones en espera."""

    def __init__(self, blocking: dict[str, Any]):
        self.blocking = blocking
        super().__init__(blocking.get("name") or blocking.get("id"))


# ──────────────────────────────────────────────────────────────────────────────
# Dequeue automático
# ──────────────────────────────────────────────────────────────────────────────

def _try_dequeue_next() -> None:
    """Intenta iniciar el siguiente job encolado si hay capacidad global.

    Respeta ambas restricciones:
      1. No superar MAX_CONCURRENT_JOBS globalmente.
      2. No tener dos jobs activos del mismo usuario al mismo tiempo.

    Itera los próximos candidatos en orden FIFO hasta encontrar uno cuyo
    usuario no tenga job activo. Si ninguno califica, no hace nada.
    """
    _reconcile_running_jobs()

    if _active_job_count() >= MAX_CONCURRENT_JOBS:
        return

    busy_users = _users_with_active_jobs()
    candidates = supabase_client.get_next_queued_jobs(limit=MAX_CONCURRENT_JOBS + 5)

    for candidate in candidates:
        user_id = candidate["user_id"]
        collection_id = candidate["id"]

        if user_id in busy_users:
            continue

        queue_action = candidate.get("queue_action") or "process"
        queue_payload = candidate.get("queue_payload") or {}
        custom_model = queue_payload.get("custom_data_model") if queue_payload else None

        supabase_client.clear_collection_queue_metadata(collection_id)
        next_status = (
            "processing_graph" if queue_action == "continue_graph" else "processing_text"
        )
        supabase_client.update_collection_processing_status(collection_id, next_status)

        _reserve_job_slot(collection_id, user_id)
        try:
            if queue_action == "continue_graph":
                _dispatch_continue_graph_job(
                    collection_id, custom_model, user_id=user_id
                )
            else:
                _dispatch_process_job(collection_id, custom_model, user_id=user_id)
        except Exception:
            _release_job_slot(collection_id)
            raise

        busy_users.add(user_id)

        if _active_job_count() >= MAX_CONCURRENT_JOBS:
            break


# ──────────────────────────────────────────────────────────────────────────────
# Despacho de threads
# ──────────────────────────────────────────────────────────────────────────────

def _dispatch_process_job(
    collection_id: str,
    custom_data_model: dict | None = None,
    *,
    user_id: str,
) -> None:
    thread = threading.Thread(
        target=_run_process_job,
        args=(collection_id, user_id, custom_data_model),
        daemon=True,
        name=f"process-job-{collection_id}",
    )
    with _running_jobs_guard:
        _job_threads[collection_id] = thread
    thread.start()


def _dispatch_continue_graph_job(
    collection_id: str,
    custom_data_model: dict | None = None,
    *,
    user_id: str,
) -> None:
    thread = threading.Thread(
        target=_run_continue_graph_job,
        args=(collection_id, user_id, custom_data_model),
        daemon=True,
        name=f"continue-graph-{collection_id}",
    )
    with _running_jobs_guard:
        _job_threads[collection_id] = thread
    thread.start()


# ──────────────────────────────────────────────────────────────────────────────
# API pública: request_process / request_continue_graph
# ──────────────────────────────────────────────────────────────────────────────

def request_process(
    collection_id: str,
    user_id: str,
    background_tasks: "BackgroundTasks",
    *,
    custom_data_model: dict | None = None,
) -> str:
    """Inicia o encola el procesamiento completo (extracción + grafo).

    Returns:
        "processing_text"  — job arrancó inmediatamente.
        "queued"           — job encolado; se iniciará cuando haya capacidad.

    Raises:
        ProcessingSlotBusyError — el usuario ya tiene MAX_QUEUED_PER_USER jobs en cola.
    """
    del background_tasks

    _reconcile_running_jobs()

    queued_count = supabase_client.count_user_queued_collections(user_id)
    if queued_count >= MAX_QUEUED_PER_USER:
        raise ProcessingSlotBusyError(
            {"name": f"Ya tienes {MAX_QUEUED_PER_USER} colecciones esperando en cola."}
        )

    user_busy = user_id in _users_with_active_jobs()
    global_full = _active_job_count() >= MAX_CONCURRENT_JOBS

    if not user_busy and not global_full:
        _reserve_job_slot(collection_id, user_id)
        try:
            supabase_client.update_collection_processing_status(
                collection_id, "processing_text"
            )
            _dispatch_process_job(collection_id, custom_data_model, user_id=user_id)
        except Exception:
            _release_job_slot(collection_id)
            raise
        return "processing_text"

    payload = {"custom_data_model": custom_data_model} if custom_data_model else None
    supabase_client.set_collection_queued(collection_id, "process", payload=payload)
    logger.info(
        "Colección %s encolada para usuario %s (activos=%d, queued_usuario=%d)",
        collection_id,
        user_id,
        _active_job_count(),
        queued_count + 1,
    )
    try:
        _try_dequeue_next()
    except Exception as exc:
        logger.warning("No se pudo desencolar tras encolar %s: %s", collection_id, exc)
    return "queued"


def request_continue_graph(
    collection_id: str,
    user_id: str,
    background_tasks: "BackgroundTasks",
    custom_data_model: dict | None = None,
) -> str:
    """Inicia o encola únicamente la fase de grafo (tras awaiting_graph_confirmation).

    Returns:
        "processing_graph" — job arrancó inmediatamente.
        "queued"           — job encolado.

    Raises:
        ProcessingSlotBusyError — el usuario ya tiene MAX_QUEUED_PER_USER jobs en cola.
    """
    del background_tasks

    _reconcile_running_jobs()

    queued_count = supabase_client.count_user_queued_collections(user_id)
    if queued_count >= MAX_QUEUED_PER_USER:
        raise ProcessingSlotBusyError(
            {"name": f"Ya tienes {MAX_QUEUED_PER_USER} colecciones esperando en cola."}
        )

    # La colección en awaiting_graph_confirmation no ocupa _running_jobs,
    # así que user_busy refleja si hay OTRA colección del usuario procesando.
    user_busy = user_id in _users_with_active_jobs()
    global_full = _active_job_count() >= MAX_CONCURRENT_JOBS

    if not user_busy and not global_full:
        _reserve_job_slot(collection_id, user_id)
        try:
            supabase_client.update_collection_processing_status(
                collection_id, "processing_graph"
            )
            _dispatch_continue_graph_job(
                collection_id, custom_data_model, user_id=user_id
            )
        except Exception:
            _release_job_slot(collection_id)
            raise
        return "processing_graph"

    payload = {"custom_data_model": custom_data_model} if custom_data_model else None
    supabase_client.set_collection_queued(
        collection_id, "continue_graph", payload=payload
    )
    try:
        _try_dequeue_next()
    except Exception as exc:
        logger.warning("No se pudo desencolar tras encolar %s: %s", collection_id, exc)
    return "queued"


# ──────────────────────────────────────────────────────────────────────────────
# Ejecución de jobs (target de los threads)
# ──────────────────────────────────────────────────────────────────────────────

def _run_process_job(
    collection_id: str,
    user_id: str,
    custom_data_model: dict | None = None,
) -> None:
    _mark_job_running(collection_id, user_id)
    try:
        wukong_runner.process_collection(collection_id, custom_data_model)
    finally:
        _mark_job_finished(collection_id)
        try:
            _try_dequeue_next()
        except Exception as exc:
            logger.warning("Error al despachar cola tras job %s: %s", collection_id, exc)


def _run_continue_graph_job(
    collection_id: str,
    user_id: str,
    custom_data_model: dict | None = None,
) -> None:
    _mark_job_running(collection_id, user_id)
    try:
        wukong_runner.process_graph_collection(
            collection_id,
            custom_data_model=custom_data_model,
            final_status_on_success="partial_error",
        )
    finally:
        _mark_job_finished(collection_id)
        try:
            _try_dequeue_next()
        except Exception as exc:
            logger.warning("Error al despachar cola tras job %s: %s", collection_id, exc)


# ──────────────────────────────────────────────────────────────────────────────
# Recuperación tras reinicio
# ──────────────────────────────────────────────────────────────────────────────

def recover_orphaned_processing() -> None:
    """Tras reinicio: reanuda jobs huérfanos en DB; despacha los encolados.

    - processing_text / processing_graph → reanuda el thread si no hay uno vivo
    - queued → se mantiene en queued y se intenta despachar el primero disponible
    """
    _reconcile_running_jobs()
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

        if status == "queued":
            logger.info(
                "Recuperación: colección %s quedó encolada; se intentará despachar.",
                collection_id,
            )
            continue

        if status in ACTIVE_STATUSES and user_id:
            logger.warning(
                "Recuperación: reanudando colección %s en %s tras reinicio",
                collection_id,
                status,
            )
            try:
                try_resume_stale_job(collection_id, user_id)
            except Exception as exc:
                logger.warning(
                    "No se pudo reanudar colección %s: %s", collection_id, exc
                )

    try:
        _try_dequeue_next()
    except Exception as exc:
        logger.warning("No se pudo despachar cola tras reinicio: %s", exc)


# ──────────────────────────────────────────────────────────────────────────────
# Compatibilidad / utilidades
# ──────────────────────────────────────────────────────────────────────────────

def drain_user_queue(user_id: str) -> None:
    """Compatibilidad: limpia filas legacy sin auto-iniciar jobs."""
    clear_legacy_queued_collections(user_id)


def drain_for_collection(completed_collection_id: str) -> None:
    """Compatibilidad: no-op (el dequeue ahora ocurre en _run_*_job → finally)."""
    del completed_collection_id


def clear_legacy_queued_collections(user_id: str) -> None:
    """Estado 'queued' sin queue_action (legacy) → resetear a idle."""
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
    name = blocking.get("name") or "Cola llena"
    return name


def is_job_running(collection_id: str) -> bool:
    """True si hay un thread de procesamiento vivo para esta colección."""
    return _is_job_alive(collection_id)


def nudge_processing_queue() -> None:
    """Reconcilia slots en memoria e intenta desencolar jobs pendientes.

    Útil cuando una colección quedó en ``queued`` sin worker activo que
    dispare el dequeue (p. ej. slots fantasma tras reload o al volver a la UI).
    """
    try:
        _reconcile_running_jobs()
        _try_dequeue_next()
    except Exception as exc:
        logger.warning("Nudge de cola de procesamiento falló: %s", exc)


def _custom_model_from_row(row: dict) -> dict | None:
    payload = row.get("queue_payload") or {}
    if isinstance(payload, dict):
        return payload.get("custom_data_model")
    return None


def _can_dispatch_for_user(user_id: str, collection_id: str) -> bool:
    with _running_jobs_guard:
        in_running = collection_id in _running_jobs
        busy_users = set(_running_jobs.values())
        active_count = len(_running_jobs)
    if user_id in busy_users and not in_running:
        return False
    if active_count >= MAX_CONCURRENT_JOBS and not in_running:
        return False
    return True


def try_resume_stale_job(collection_id: str, user_id: str) -> bool:
    """Reanuda un job en DB (processing_*) cuyo thread murió (reload, crash).

    Returns:
        True si se despachó un worker nuevo o se nudgió la cola.
    """
    _reconcile_running_jobs()
    if _is_job_alive(collection_id):
        return False

    row = supabase_client.get_collection(collection_id, user_id)
    if not row:
        return False

    status = row.get("processing_status")
    if status == "queued" and row.get("queue_action"):
        nudge_processing_queue()
        return True

    if status not in ACTIVE_STATUSES:
        return False

    if not _can_dispatch_for_user(user_id, collection_id):
        logger.info(
            "Reanudación omitida para %s: sin capacidad de slot ahora mismo",
            collection_id,
        )
        return False

    custom_model = _custom_model_from_row(row)
    _reserve_job_slot(collection_id, user_id)
    try:
        if status == "processing_graph":
            logger.info("Reanudando fase Wukong para colección %s", collection_id)
            _dispatch_continue_graph_job(
                collection_id, custom_model, user_id=user_id
            )
        elif status == "processing_text":
            texts = supabase_client.get_document_texts_by_collection(collection_id)
            if texts:
                logger.info(
                    "Reanudando Wukong (extracción ya hecha) para colección %s",
                    collection_id,
                )
                supabase_client.update_collection_processing_status(
                    collection_id, "processing_graph"
                )
                _dispatch_continue_graph_job(
                    collection_id, custom_model, user_id=user_id
                )
            else:
                logger.info(
                    "Reanudando pipeline completo para colección %s",
                    collection_id,
                )
                _dispatch_process_job(collection_id, custom_model, user_id=user_id)
        else:
            _dispatch_process_job(collection_id, custom_model, user_id=user_id)
        return True
    except Exception:
        _release_job_slot(collection_id)
        raise


def ensure_collection_processing(collection_id: str, user_id: str) -> None:
    """Desencola o reanuda el procesamiento de una colección si quedó colgada."""
    try:
        try_resume_stale_job(collection_id, user_id)
    except Exception as exc:
        logger.warning(
            "ensure_collection_processing falló para %s: %s", collection_id, exc
        )
