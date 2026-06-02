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
    """Búsqueda semántica sobre los chunks de una colección procesada.

    Devuelve resultados paginados (10 por página). El total refleja todos los
    chunks que superan el umbral de similitud, independiente de la página actual.
    Los resultados incluyen storage_path; para obtener una URL abierta del
    documento, usar GET /api/documentos/signed-url?path=<storage_path>.
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

    try:
        query_embedding: list[float] = await asyncio.to_thread(generate_embedding, request.query)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Error al generar el embedding de la consulta: {exc}",
        ) from exc

    filtros = request.filtros
    rango = filtros.rango_años if filtros else None
    year_min = rango[0] if rango and len(rango) >= 1 else None
    year_max = rango[1] if rango and len(rango) >= 2 else None
    entity_types = [filtros.tipo_entidad] if filtros and filtros.tipo_entidad else None

    raw = await asyncio.to_thread(
        supabase_client.search_chunks,
        query_embedding,
        str(request.coleccion_id),
        10_000,
        entity_types,
        year_min,
        year_max,
    )

    filtered = [r for r in raw if float(r["similarity"]) >= request.min_score]
    total = len(filtered)

    offset = (request.page - 1) * _PAGE_SIZE
    page_results = filtered[offset : offset + _PAGE_SIZE]

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
