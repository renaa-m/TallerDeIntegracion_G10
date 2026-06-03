"""
Consulta best-effort de cuotas de Cloud Vision vía Service Usage API (sin migraciones).

Requiere credenciales ADC con permisos para leer cuotas del proyecto, p. ej. rol
``roles/serviceusage.serviceUsageConsumer`` puede bastar para algunas lecturas;
si recibís 403, probá ``Viewer`` o ``Service Usage Admin`` en el service account.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from google.auth import default
from google.auth.transport.requests import Request

logger = logging.getLogger(__name__)

VISION_SERVICE = "vision.googleapis.com"
SERVICE_USAGE_BASE = "https://serviceusage.googleapis.com/v1beta1"
CLOUD_CONSOLE_QUOTAS = (
    "https://console.cloud.google.com/apis/api/vision.googleapis.com/quotas"
)


def fetch_vision_quota_summary(project_id: str) -> dict[str, Any]:
    """
    Devuelve un resumen legible de límites de cuota configurados para Vision en el proyecto.
    Los "usos" en tiempo real a veces no vienen en esta API; para uso exacto → Consola / Billing.
    """
    project_id = (project_id or "").strip()
    if not project_id:
        return {
            "ok": False,
            "error": "GCP_PROJECT_ID vacío en configuración.",
            "console": CLOUD_CONSOLE_QUOTAS,
        }

    try:
        credentials, _ = default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        credentials.refresh(Request())
    except Exception as exc:
        logger.warning("Vision quota: no ADC: %s", exc)
        return {
            "ok": False,
            "error": f"No se pudieron obtener credenciales (ADC / GOOGLE_APPLICATION_CREDENTIALS): {exc}",
            "console": CLOUD_CONSOLE_QUOTAS,
        }

    url = (
        f"{SERVICE_USAGE_BASE}/projects/{project_id}"
        f"/services/{VISION_SERVICE}/consumerQuotaMetrics"
    )
    headers = {"Authorization": f"Bearer {credentials.token}"}

    try:
        with httpx.Client(timeout=45.0) as client:
            response = client.get(url, headers=headers)
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Error de red al consultar Service Usage: {exc}",
            "console": CLOUD_CONSOLE_QUOTAS,
        }

    if response.status_code == 404:
        return {
            "ok": False,
            "error": "No se encontró el servicio vision.googleapis.com para este proyecto "
            "(¿API habilitada y GCP_PROJECT_ID correcto?).",
            "console": CLOUD_CONSOLE_QUOTAS,
            "detail": response.text[:800],
        }
    if response.status_code == 403:
        return {
            "ok": False,
            "error": "Permiso denegado (403). Al service account le faltan permisos para "
            "leer cuotas (Service Usage / Viewer en el proyecto).",
            "console": CLOUD_CONSOLE_QUOTAS,
            "detail": response.text[:800],
        }
    if response.status_code != 200:
        return {
            "ok": False,
            "error": f"Service Usage respondió HTTP {response.status_code}.",
            "console": CLOUD_CONSOLE_QUOTAS,
            "detail": response.text[:800],
        }

    try:
        payload = response.json()
    except Exception:
        return {
            "ok": False,
            "error": "Respuesta no es JSON.",
            "console": CLOUD_CONSOLE_QUOTAS,
            "detail": response.text[:800],
        }

    metrics = payload.get("metrics") or []
    quotas: list[dict[str, Any]] = []

    for m in metrics:
        name = m.get("name") or ""
        short = name.rsplit("/", maxsplit=1)[-1] if name else "unknown"
        row: dict[str, Any] = {"metric": short, "limits": []}
        for lim in m.get("consumerQuotaLimits") or []:
            limit_row: dict[str, Any] = {}
            for bucket in lim.get("quotaBuckets") or []:
                if "effectiveLimit" in bucket:
                    limit_row["effectiveLimit"] = bucket.get("effectiveLimit")
                if "defaultLimit" in bucket and bucket.get("defaultLimit") is not None:
                    limit_row["defaultLimit"] = bucket.get("defaultLimit")
            if limit_row:
                row["limits"].append(limit_row)
        if row["limits"] or short != "unknown":
            quotas.append(row)

    return {
        "ok": True,
        "project_id": project_id,
        "service": VISION_SERVICE,
        "quotas": quotas,
        "metrics_returned": len(metrics),
        "nota": (
            "Son límites de cuota configurados en el proyecto. El consumo en curso "
            "se ve en Google Cloud Console → Vision API → Cuotas, o en Facturación."
        ),
        "console": CLOUD_CONSOLE_QUOTAS,
    }
