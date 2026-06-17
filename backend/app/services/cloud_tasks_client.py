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


def _task_handler_url() -> str:
    base = settings.cloud_tasks_service_url.rstrip("/")
    return f"{base}/internal/tasks/run"


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
    if not is_configured():
        raise RuntimeError("Cloud Tasks no está configurado.")

    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = _queue_path(client)
    task_name = f"{parent}/tasks/{_task_id(action, collection_id)}"
    payload = {
        "collection_id": collection_id,
        "user_id": user_id,
        "action": action,
        "custom_data_model": custom_data_model,
    }
    handler_url = _task_handler_url()
    task: dict[str, Any] = {
        "name": task_name,
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": handler_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode("utf-8"),
            "oidc_token": {
                "service_account_email": settings.cloud_tasks_invoker_sa,
                "audience": handler_url,
            },
        },
    }
    try:
        client.create_task(request={"parent": parent, "task": task})
        logger.info(
            "Cloud Task encolada: action=%s collection=%s user=%s",
            action,
            collection_id,
            user_id,
        )
    except Exception as exc:
        if "AlreadyExists" in type(exc).__name__ or "ALREADY_EXISTS" in str(exc):
            logger.info(
                "Cloud Task ya existía (idempotente): action=%s collection=%s",
                action,
                collection_id,
            )
            return
        raise
