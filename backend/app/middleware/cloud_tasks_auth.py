"""Verificación de peticiones entrantes desde Google Cloud Tasks (OIDC)."""

from __future__ import annotations

import logging

from fastapi import HTTPException, Request

from app.config import settings
from app.services.cloud_tasks_client import is_configured

logger = logging.getLogger(__name__)


async def verify_cloud_tasks_caller(request: Request) -> None:
    """Valida que la petición venga de Google Cloud Tasks."""
    if not is_configured():
        if settings.debug:
            return
        raise HTTPException(
            status_code=503,
            detail="Cloud Tasks no configurado en este entorno.",
        )

    user_agent = request.headers.get("User-Agent", "")
    if "Google-Cloud-Tasks" not in user_agent:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
