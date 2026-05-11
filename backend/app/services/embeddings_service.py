"""Generación de embeddings semánticos con sentence-transformers (local, sin API key)."""

import logging
from functools import lru_cache

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    """Carga el modelo una sola vez y lo reutiliza. Primera carga descarga ~470MB."""
    logger.info("Cargando modelo de embeddings '%s'...", MODEL_NAME)
    return SentenceTransformer(MODEL_NAME)


def generate_embedding(text: str) -> list[float]:
    """Genera el embedding de un texto. Lanza excepción si el modelo falla."""
    return _get_model().encode(text, show_progress_bar=False).tolist()


def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Genera embeddings para una lista de textos en un solo pase del modelo.

    Devuelve una lista del mismo largo que `texts`, en el mismo orden.
    """
    if not texts:
        return []
    embeddings = _get_model().encode(texts, batch_size=32, show_progress_bar=False)
    return embeddings.tolist()
