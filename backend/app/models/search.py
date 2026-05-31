from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class FiltrosBusqueda(BaseModel):
    rango_años: Optional[list[int]] = Field(
        default=None,
        description="Par [año_min, año_max] para filtrar por año de creación del documento.",
    )
    tipo_entidad: Optional[str] = Field(
        default=None,
        description="Tipo de entidad a filtrar (Persona, Organizacion, Lugar, Evento).",
    )


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Consulta en lenguaje natural.")
    coleccion_id: UUID = Field(..., description="ID de la colección sobre la que buscar.")
    filtros: Optional[FiltrosBusqueda] = None
    limit: int = Field(default=10, ge=1, le=50, description="Número máximo de resultados.")
    min_score: float = Field(default=0.4, ge=0.0, le=1.0, description="Similitud mínima para incluir un resultado [0, 1].")


class SearchResult(BaseModel):
    titulo: str = Field(description="Nombre del documento fuente.")
    fragmento: str = Field(description="Texto del chunk más relevante.")
    id_chunk: str = Field(description="ID del chunk en el grafo (e.g. 'Chunk_1_2').")
    enlace: str = Field(description="Ruta de Storage del documento original.")
    score: float = Field(description="Similitud coseno [0, 1].")


class SearchResponse(BaseModel):
    resultados: list[SearchResult]
    total: int
    ready: bool = True
    message: str | None = None
