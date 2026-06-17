"""Endpoints internos invocados por Google Cloud Tasks."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.middleware.cloud_tasks_auth import verify_cloud_tasks_caller
from app.services import processing_queue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/tasks", tags=["internal-tasks"])


class TaskRunPayload(BaseModel):
    collection_id: str
    user_id: str
    action: Literal["process", "continue_graph"]
    custom_data_model: dict[str, Any] | None = None


class TaskRunResponse(BaseModel):
    status: str
    detail: str = ""


@router.post("/run", response_model=TaskRunResponse)
async def run_processing_task(
    body: TaskRunPayload,
    _: None = Depends(verify_cloud_tasks_caller),
) -> TaskRunResponse:
    """Worker HTTP: ejecuta extracción y/o grafo para una colección."""
    result = processing_queue.execute_job(
        collection_id=body.collection_id,
        user_id=body.user_id,
        action=body.action,
        custom_data_model=body.custom_data_model,
    )
    logger.info(
        "Task %s collection=%s → %s",
        body.action,
        body.collection_id,
        result["status"],
    )
    return TaskRunResponse(status=result["status"], detail=result.get("detail", ""))
