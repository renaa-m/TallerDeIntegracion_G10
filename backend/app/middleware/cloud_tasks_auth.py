"""Verificación de peticiones entrantes desde Google Cloud Tasks (OIDC)."""

from __future__ import annotations

import logging

from fastapi import HTTPException, Request

from app.config import settings
from app.services.cloud_tasks_client import is_configured

logger = logging.getLogger(__name__)


async def verify_cloud_tasks_caller(request: Request) -> None:
    """Exige un ID token OIDC válido cuando Cloud Tasks está configurado."""
    if not is_configured():
        if settings.debug:
            return
        raise HTTPException(
            status_code=503,
            detail="Cloud Tasks no configurado en este entorno.",
        )

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Token OIDC requerido.")

    token = auth.removeprefix("Bearer ").strip()
    audience = f"{settings.cloud_tasks_service_url.rstrip('/')}/internal/tasks/run"

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=audience,
        )
    except Exception as exc:
        logger.warning("Token Cloud Tasks inválido: %s", exc)
        raise HTTPException(status_code=403, detail="Token OIDC inválido.") from exc
