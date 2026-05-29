import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.middleware.auth import get_current_user
from app.models.search import SearchRequest, SearchResponse, SearchResult
from app.services import supabase_client
from app.services.embeddings_service import generate_embedding

router = APIRouter(prefix="/api", tags=["search"])

_READY_STATUSES = {"graph_ready", "partial_error"}


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    user_id: str = Depends(get_current_user),
):
    """Búsqueda semántica sobre los chunks de una colección procesada.

    Transforma la consulta a embedding, busca por similitud coseno en Supabase
    y aplica filtros opcionales de tipo de entidad y rango de años.
    """
    # Validar que la colección existe y pertenece al usuario
    collection = supabase_client.get_collection_by_id(str(request.coleccion_id))
    if not collection or collection["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    if collection.get("processing_status") not in _READY_STATUSES:
        return SearchResponse(
            resultados=[],
            total=0,
            ready=False,
            message=(
                "Aún no hay grafo generado. "
                "Genera el grafo desde la colección para habilitar la búsqueda semántica."
            ),
        )

    # Generar embedding de la consulta
    try:
        query_embedding: list[float] = await asyncio.to_thread(generate_embedding, request.query)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Error al generar el embedding de la consulta: {exc}",
        ) from exc

    # Extraer filtros
    filtros = request.filtros
    rango = filtros.rango_años if filtros else None
    year_min = rango[0] if rango and len(rango) >= 1 else None
    year_max = rango[1] if rango and len(rango) >= 2 else None
    entity_types = [filtros.tipo_entidad] if filtros and filtros.tipo_entidad else None

    # Buscar en Supabase pgvector
    raw = await asyncio.to_thread(
        supabase_client.search_chunks,
        query_embedding,
        str(request.coleccion_id),
        request.limit,
        entity_types,
        year_min,
        year_max,
    )

    resultados = []
    for r in raw:
        if float(r["similarity"]) < request.min_score:
            continue
        try:
            enlace = await asyncio.to_thread(
                supabase_client.create_signed_url, r["storage_path"]
            )
        except Exception:
            enlace = r["storage_path"]  # fallback: path interno si falla la URL firmada
        resultados.append(
            SearchResult(
                titulo=r["document_name"],
                fragmento=r["chunk_text"],
                id_chunk=r["chunk_id"],
                enlace=enlace,
                score=round(float(r["similarity"]), 4),
            )
        )

    return SearchResponse(resultados=resultados, total=len(resultados))
