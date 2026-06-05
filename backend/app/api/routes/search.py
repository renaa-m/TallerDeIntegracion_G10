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

    Devuelve resultados paginados (10 por página). El filtro de min_score y la
    paginación se ejecutan en SQL; cada fila incluye total_count para evitar
    un segundo query. Los resultados incluyen storage_path; para obtener una URL
    abierta del documento usar GET /api/documentos/signed-url?path=<storage_path>.
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
