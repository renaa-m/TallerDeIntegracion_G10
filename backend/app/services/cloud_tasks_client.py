"""Cliente de Google Cloud Tasks para el pipeline de procesamiento."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_TASK_ID_SAFE = re.compile(r"[^A-Za-z0-9_-]")


def is_configured() -> bool:
    return bool(
        settings.gcp_project_id.strip()
        and settings.cloud_tasks_queue.strip()
        and settings.cloud_tasks_location.strip()
        and settings.cloud_tasks_service_url.strip()
        and settings.cloud_tasks_invoker_sa.strip()
    )


def task_worker_base_url() -> str:
    """URL base del servicio que ejecuta jobs (worker dedicado o monolito)."""
    explicit = settings.cloud_tasks_worker_url.strip()
    if explicit:
        return explicit.rstrip("/")
    return settings.cloud_tasks_service_url.rstrip("/")


def _task_handler_url() -> str:
    return f"{task_worker_base_url()}/internal/tasks/run"


def _task_id(action: str, collection_id: str) -> str:
    safe = _TASK_ID_SAFE.sub("-", collection_id)
    return f"{action}-{safe}"[:500]


def _queue_path(client: Any) -> str:
    return client.queue_path(
        settings.gcp_project_id,
        settings.cloud_tasks_location,
        settings.cloud_tasks_queue,
    )


def enqueue_processing_task(
    *,
    collection_id: str,
    user_id: str,
    action: str,
    custom_data_model: dict | None = None,
) -> None:
    """Encola un HTTP task hacia el worker interno del backend."""
    logger.info(
        "enqueue_processing_task: action=%s collection=%s is_configured=%s",
        action, collection_id, is_configured(),
    )
    if not is_configured():
        raise RuntimeError("Cloud Tasks no está configurado.")

    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = _queue_path(client)
    payload = {
        "collection_id": collection_id,
        "user_id": user_id,
        "action": action,
        "custom_data_model": custom_data_model,
    }
    from google.protobuf import duration_pb2

    handler_url = _task_handler_url()
    deadline = max(15, min(settings.cloud_tasks_dispatch_deadline_seconds, 1800))
    logger.info(
        "Cloud Tasks: creando task → queue=%s url=%s deadline=%ds",
        parent, handler_url, deadline,
    )
    task: dict[str, Any] = {
        "dispatch_deadline": duration_pb2.Duration(seconds=deadline),
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": handler_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode("utf-8"),
        },
    }
    try:
        result = client.create_task(request={"parent": parent, "task": task})
        logger.info(
            "Cloud Task CREADA OK: action=%s collection=%s task_name=%s",
            action, collection_id, result.name,
        )
    except Exception as exc:
        logger.error(
            "Cloud Task FALLÓ: action=%s collection=%s error=%s",
            action, collection_id, exc,
        )
        raise
