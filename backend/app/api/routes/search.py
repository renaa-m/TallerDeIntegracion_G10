import asyncio
from math import ceil

from fastapi import APIRouter, Depends, HTTPException

from app.middleware.auth import get_current_user
from app.models.search import SearchRequest, SearchResponse, SearchResult
from app.services import supabase_client
from app.services.embeddings_service import generate_embedding

router = APIRouter(prefix="/api", tags=["search"])

_READY_STATUSES = {"graph_ready", "partial_error"}
_PAGE_SIZE = 10


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    user_id: str = Depends(get_current_user),
):
    """Búsqueda sobre los chunks de una colección procesada.

    Soporta dos modos combinables:
    - Semántica: query en lenguaje natural → embedding → ranking por similitud coseno.
    - Por entidad: nombres_entidades en filtros → pre-filtro ILIKE sobre chunk_text.

    Se puede usar uno solo o ambos. Sin query ni entidades devuelve lista vacía.
    Resultados paginados (10/página). El total_count viene de SQL window function.
    """
    collection = supabase_client.get_collection_by_id(str(request.coleccion_id))
    if not collection or collection["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    if collection.get("processing_status") not in _READY_STATUSES:
        return SearchResponse(
            resultados=[],
            total=0,
            page=1,
            total_pages=0,
            ready=False,
            message=(
                "Aún no hay grafo generado. "
                "Genera el grafo desde la colección para habilitar la búsqueda semántica."
            ),
        )

    filtros = request.filtros
    tiene_query = bool(request.query and request.query.strip())
    entity_names = filtros.nombres_entidades if filtros else None
    tiene_entidades = bool(entity_names)

    if not tiene_query and not tiene_entidades:
        return SearchResponse(resultados=[], total=0, page=request.page, total_pages=0)

    query_embedding: list[float] | None = None
    if tiene_query:
        try:
            query_embedding = await asyncio.to_thread(generate_embedding, request.query)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Error al generar el embedding de la consulta: {exc}",
            ) from exc

    rango = filtros.rango_años if filtros else None
    year_min = rango[0] if rango and len(rango) >= 1 else None
    year_max = rango[1] if rango and len(rango) >= 2 else None
    entity_types = [filtros.tipo_entidad] if filtros and filtros.tipo_entidad else None
    entity_logic = filtros.logica_entidades if filtros else "OR"

    page_results = await asyncio.to_thread(
        supabase_client.search_chunks,
        query_embedding,
        str(request.coleccion_id),
        _PAGE_SIZE,
        (request.page - 1) * _PAGE_SIZE,
        entity_types,
        year_min,
        year_max,
        request.min_score,
        entity_names,
        entity_logic,
    )

    total = int(page_results[0]["total_count"]) if page_results else 0

    resultados = [
        SearchResult(
            titulo=r["document_name"],
            fragmento=r["chunk_text"],
            id_chunk=r["chunk_id"],
            storage_path=r["storage_path"],
            score=round(float(r["similarity"]), 4),
        )
        for r in page_results
    ]

    return SearchResponse(
        resultados=resultados,
        total=total,
        page=request.page,
        total_pages=ceil(total / _PAGE_SIZE) if total else 0,
    )
