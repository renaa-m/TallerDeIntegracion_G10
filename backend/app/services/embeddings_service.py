"""Generación de embeddings semánticos con sentence-transformers (local, sin API key)."""

import logging
from functools import lru_cache
from pathlib import Path

from sentence_transformers import SentenceTransformer

from app.services.ai_models import ModelUnavailableError

logger = logging.getLogger(__name__)

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384

# En producción el modelo se copia al imagen en /app/models/ (ver Dockerfile + cd.yml).
# En desarrollo, si la ruta local no existe, se descarga desde HuggingFace.
_LOCAL_MODEL_PATH = Path("/app/models") / MODEL_NAME


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    """Carga el modelo una sola vez y lo reutiliza.

    Si el modelo no se puede cargar (pesos faltantes/corruptos, descarga fallida,
    memoria insuficiente), lanza ``ModelUnavailableError`` para que el llamador
    lo reporte como "se cayó el modelo" y no como un error genérico.
    """
    source = str(_LOCAL_MODEL_PATH) if _LOCAL_MODEL_PATH.is_dir() else MODEL_NAME
    logger.info("Cargando modelo de embeddings desde '%s'...", source)
    try:
        return SentenceTransformer(source)
    except Exception as exc:
        raise ModelUnavailableError("embeddings") from exc


def generate_embedding(text: str) -> list[float]:
    """Genera el embedding de un texto.

    Lanza ``ModelUnavailableError`` si el modelo se cae (carga o inferencia).
    """
    try:
        return _get_model().encode(text, show_progress_bar=False).tolist()
    except ModelUnavailableError:
        raise
    except Exception as exc:
        raise ModelUnavailableError("embeddings") from exc


def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Genera embeddings para una lista de textos en un solo pase del modelo.

    Devuelve una lista del mismo largo que `texts`, en el mismo orden.
    Lanza ``ModelUnavailableError`` si el modelo se cae (carga o inferencia).
    """
    if not texts:
        return []
    try:
        embeddings = _get_model().encode(texts, batch_size=32, show_progress_bar=False)
    except ModelUnavailableError:
        raise
    except Exception as exc:
        raise ModelUnavailableError("embeddings") from exc
    return embeddings.tolist()
