import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    health,
    collections,
    documentos,
    usuarios,
    search,
    internal_tasks,
)
from app.config import settings
from app.services import processing_queue

# Clientes de Google Cloud leen credenciales solo desde os.environ.
_backend_root = Path(__file__).resolve().parent.parent
if settings.google_application_credentials.strip():
    _p = Path(settings.google_application_credentials.strip())
    if not _p.is_absolute():
        _p = _backend_root / _p
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(_p.resolve())

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",  # FIX: agregar esta variante
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# FIX: cada router incluido una sola vez
app.include_router(health.router)
app.include_router(collections.router)
app.include_router(documentos.router)
app.include_router(usuarios.router)
app.include_router(search.router)
app.include_router(internal_tasks.router)


@app.on_event("startup")
def _recover_processing_queue_on_startup() -> None:
    processing_queue.recover_orphaned_processing()
    _warn_if_wukong_missing()


def _warn_if_wukong_missing() -> None:
    import logging

    log = logging.getLogger(__name__)
    try:
        import wukong_engine  # noqa: F401
    except ImportError:
        log.error(
            "wukong_engine NO está instalado. "
            "Ejecuta: cd backend && pip install -e ./wukong-engine "
            "— el grafo no se podrá generar hasta instalarlo."
        )


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
