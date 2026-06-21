import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {"status": "healthy"}


@router.get("/ready")
async def readiness_check():
    try:
        client = get_supabase_client()
        client.table("collections").select("id").limit(1).execute()
        return {"status": "ready"}
    except Exception as exc:
        logger.warning("Readiness check falló: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "detail": "No se puede conectar a la base de datos."},
        )
