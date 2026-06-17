from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel
from app.middleware.auth import get_current_user
from app.models.document import CollectionCreate, CollectionResponse, CollectionEntities
from app.schemas.graph import DataModelUpdate
from app.services import supabase_client, graph_transformer, processing_queue
from app.services.processing_queue import ProcessingSlotBusyError

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.get("", response_model=list[CollectionResponse])
async def list_collections(
    user_id: str = Depends(get_current_user),
):
    try:
        return supabase_client.get_collections(user_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al obtener colecciones.",
        ) from exc


@router.post("", response_model=CollectionResponse, status_code=201)
async def create_collection(
    body: CollectionCreate,
    user_id: str = Depends(get_current_user),
):
    try:
        collection = supabase_client.create_collection(
            user_id=user_id,
            name=body.name,
            description=body.description,
            language=body.language,
        )
        return collection

    except Exception as exc:
        err_str = str(exc).lower()
        if "unique" in err_str or "duplicate" in err_str or "23505" in err_str:
            raise HTTPException(
                status_code=409,
                detail=f'Ya tienes una colección llamada "{body.name}". Elige otro nombre.',
            ) from exc
        raise HTTPException(
            status_code=502,
            detail="Error al crear la colección.",
        ) from exc

@router.get("/{collection_id}", response_model=CollectionResponse)
async def get_collection(
    collection_id: UUID,
    user_id: str = Depends(get_current_user),
):
    try:
        collection = supabase_client.get_collection(
            collection_id=str(collection_id),
            user_id=user_id,
        )

        if collection is None:
            raise HTTPException(
                status_code=404,
                detail="Colección no encontrada.",
            )

        return collection

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al obtener la colección.",
        ) from exc


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(
    collection_id: UUID,
    user_id: str = Depends(get_current_user),
):
    try:
        collection = supabase_client.get_collection(
            collection_id=str(collection_id),
            user_id=user_id,
        )
        if collection is None:
            raise HTTPException(
                status_code=404,
                detail="Colección no encontrada.",
            )

        deleted = supabase_client.delete_collection(
            collection_id=str(collection_id),
            user_id=user_id,
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Colección no encontrada.",
            )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al eliminar la colección.",
        ) from exc

class CollectionUpdate(BaseModel):
    name: str


@router.patch("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: UUID,
    body: CollectionUpdate,
    user_id: str = Depends(get_current_user),
):
    try:
        updated = supabase_client.update_collection_name(
            collection_id=str(collection_id),
            user_id=user_id,
            new_name=body.name,
        )

        if updated is None:
            raise HTTPException(
                status_code=404,
                detail="Colección no encontrada.",
            )

        return updated

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al actualizar la colección.",
        ) from exc


# Estados en los que esta colección ya tiene un job en curso.
_ACTIVE_PIPELINE_STATUSES = {"processing_text", "processing_graph"}
# Worker en background: al borrar durante extracción/grafo, el job activo termina solo.
_GRAPH_AVAILABLE_STATUSES = frozenset({"graph_ready", "partial_error"})


def _graph_unavailable_detail(status: str) -> str:
    """Mensaje legible cuando el grafo aún no se puede servir."""
    messages = {
        "idle": (
            "Aún no hay grafo para visualizar. "
            "Genera el grafo desde la colección cuando los documentos estén cargados."
        ),
        "processing_text": (
            "El grafo se está generando (extracción de texto en curso). "
            "Vuelve a intentarlo en unos momentos."
        ),
        "processing_graph": (
            "El grafo se está generando. Vuelve a intentarlo en unos momentos."
        ),
        "awaiting_graph_confirmation": (
            "El grafo aún no está listo. "
            "Confirma la construcción del grafo desde la colección para visualizarlo."
        ),
        "cancelled": (
            "No hay grafo para visualizar. Genera el grafo de nuevo desde la colección."
        ),
        "error": (
            "No se pudo generar el grafo. Revisa el estado de la colección e inténtalo de nuevo."
        ),
    }
    return messages.get(
        status,
        "El grafo aún no está disponible para visualizar.",
    )


def _normalize_legacy_queued(collection_id: str, status: str) -> str:
    """Estado ``queued`` ya no se usa; restablecer a idle."""
    if status != "queued":
        return status
    supabase_client.clear_collection_queue_metadata(str(collection_id))
    supabase_client.update_collection_processing_status(
        str(collection_id),
        "idle",
        error_message="",
    )
    return "idle"


def _slot_busy_http_exception(exc: ProcessingSlotBusyError) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail=processing_queue.busy_detail_message(exc.blocking),
    )


class ProcessCollectionResponse(BaseModel):
    collection_id: UUID
    processing_status: str
    detail: str


class CancelProcessResponse(BaseModel):
    collection_id: UUID
    processing_status: str
    detail: str


@router.post(
    "/{collection_id}/process/cancel",
    response_model=CancelProcessResponse,
    status_code=200,
)
async def cancel_process_collection(
    collection_id: UUID,
    user_id: str = Depends(get_current_user),
):
    """
    Detiene el pipeline de forma cooperativa (marca ``cancelled`` en DB).

    El worker revisa el estado entre documentos y antes de Wukong.
    Mientras corre el subproceso Wukong no se puede interrumpir hasta que termine.
    """
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    st = collection.get("processing_status", "idle")
    if st == "cancelled":
        return CancelProcessResponse(
            collection_id=collection_id,
            processing_status="cancelled",
            detail="La colección ya estaba cancelada.",
        )
    if st == "queued":
        supabase_client.clear_collection_queue_metadata(str(collection_id))
        supabase_client.update_collection_processing_status(
            str(collection_id),
            "idle",
            error_message="",
        )
        return CancelProcessResponse(
            collection_id=collection_id,
            processing_status="idle",
            detail="Estado de cola obsoleto; colección restablecida.",
        )

    if st not in _ACTIVE_PIPELINE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=(
                "No hay procesamiento en curso para cancelar "
                f"(estado actual: {st})."
            ),
        )

    supabase_client.update_collection_processing_status(
        str(collection_id),
        "cancelled",
        error_message="Procesamiento cancelado.",
        processed_at=datetime.now(timezone.utc).isoformat(),
    )
    return CancelProcessResponse(
        collection_id=collection_id,
        processing_status="cancelled",
        detail=(
            "Cancelación registrada. El worker se detiene en el próximo punto seguro."
        ),
    )


@router.post(
    "/{collection_id}/process",
    response_model=ProcessCollectionResponse,
    status_code=202,
)
async def process_collection(
    collection_id: UUID,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """
    Dispara el procesamiento de una colección (HU-04 — botón "Generar Grafo").

    Encadena en background (`wukong_runner.process_collection`):
      1. Extracción de texto por documento: TXT, PDF digital (PyMuPDF), PDF escaneado
         (OCR con Google Cloud Vision si hay credenciales GCP).
      2. Wukong genera el grafo en formato .qm.
      3. (PDT10-121) Carga del grafo en MillenniumDB.

    El endpoint devuelve 202 Accepted inmediatamente. El frontend debe
    pollear GET /api/collections/{id} para ver cómo evoluciona
    `processing_status` y `processing_error_message`.
    """
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    current_status = _normalize_legacy_queued(
        str(collection_id),
        collection.get("processing_status", "idle"),
    )
    if current_status in _ACTIVE_PIPELINE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"La colección ya está siendo procesada "
                f"(estado actual: {current_status})."
            ),
        )
    if current_status == "awaiting_graph_confirmation":
        raise HTTPException(
            status_code=409,
            detail=(
                "La extracción terminó con errores parciales. "
                "Use POST /process/continue-graph para construir el grafo "
                "con los documentos que sí se extrajeron."
            ),
        )

    documents = supabase_client.get_documents(
        user_id=user_id,
        collection_id=str(collection_id),
    )
    if not documents:
        raise HTTPException(
            status_code=422,
            detail="La colección no tiene documentos para procesar.",
        )

    try:
        status = processing_queue.request_process(
            str(collection_id),
            user_id,
            background_tasks,
        )
    except ProcessingSlotBusyError as exc:
        raise _slot_busy_http_exception(exc) from exc

    detail = (
        "Colección encolada. Iniciará automáticamente cuando haya capacidad disponible. "
        "Consulte GET /api/collections/{id} para seguir el estado."
        if status == "queued"
        else "Procesamiento iniciado. Consulte GET /api/collections/{id} para seguir el avance."
    )
    return ProcessCollectionResponse(
        collection_id=collection_id,
        processing_status=status,
        detail=detail,
    )


class GenerateGraphResponse(BaseModel):
    collection_id: UUID
    processing_status: str
    detail: str

@router.post(
    "/{collection_id}/process/continue-graph",
    response_model=ProcessCollectionResponse,
    status_code=202,
)
async def continue_graph_collection(
    collection_id: UUID,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )

    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    current_status = _normalize_legacy_queued(
        str(collection_id),
        collection.get("processing_status", "idle"),
    )
    if current_status != "awaiting_graph_confirmation":
        raise HTTPException(
            status_code=409,
            detail="La colección no está esperando confirmación para grafo.",
        )

    try:
        status = processing_queue.request_continue_graph(
            str(collection_id),
            user_id,
            background_tasks,
        )
    except ProcessingSlotBusyError as exc:
        raise _slot_busy_http_exception(exc) from exc

    detail = (
        "Colección encolada. Iniciará automáticamente cuando haya capacidad disponible."
        if status == "queued"
        else "Construcción de grafo iniciada."
    )
    return ProcessCollectionResponse(
        collection_id=collection_id,
        processing_status=status,
        detail=detail,
    )

@router.post(
    "/{collection_id}/generate-graph/continue-graph",
    response_model=GenerateGraphResponse,
    status_code=202,
)
async def continue_graph_with_custom_model(
    collection_id: UUID,
    body: DataModelUpdate,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )

    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    current_status = _normalize_legacy_queued(
        str(collection_id),
        collection.get("processing_status", "idle"),
    )

    if current_status != "awaiting_graph_confirmation":
        raise HTTPException(
            status_code=409,
            detail="La colección no está esperando confirmación para grafo.",
        )

    custom_model = body.model_dump(exclude_none=True)

    try:
        status = processing_queue.request_continue_graph(
            str(collection_id),
            user_id,
            background_tasks,
            custom_data_model=custom_model,
        )
    except ProcessingSlotBusyError as exc:
        raise _slot_busy_http_exception(exc) from exc

    detail = (
        "Colección encolada. Iniciará automáticamente cuando haya capacidad disponible."
        if status == "queued"
        else "Construcción de grafo con modelo personalizado iniciada."
    )
    return GenerateGraphResponse(
        collection_id=collection_id,
        processing_status=status,
        detail=detail,
    )

@router.post(
    "/{collection_id}/generate-graph",
    response_model=GenerateGraphResponse,
    status_code=202,
)
async def generate_graph(
    collection_id: UUID,
    body: DataModelUpdate,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """
    Dispara la generación del grafo con un Data Model personalizado (HU Sprint 3).

    El body debe seguir la estructura de default_data_model.json:
    ``{ parameters, entities, relations }``.

    Devuelve 202 Accepted inmediatamente. El frontend debe pollear
    GET /api/collections/{id} para seguir el avance en ``processing_status``.
    """
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    current_status = _normalize_legacy_queued(
        str(collection_id),
        collection.get("processing_status", "idle"),
    )
    if current_status in _ACTIVE_PIPELINE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"La colección ya está siendo procesada "
                f"(estado actual: {current_status})."
            ),
        )

    documents = supabase_client.get_documents(
        user_id=user_id,
        collection_id=str(collection_id),
    )
    if not documents:
        raise HTTPException(
            status_code=422,
            detail="La colección no tiene documentos para procesar.",
        )

    custom_model = body.model_dump(exclude_none=True)
    try:
        status = processing_queue.request_process(
            str(collection_id),
            user_id,
            background_tasks,
            custom_data_model=custom_model,
        )
    except ProcessingSlotBusyError as exc:
        raise _slot_busy_http_exception(exc) from exc

    detail = (
        "Colección encolada. Iniciará automáticamente cuando haya capacidad disponible. "
        "Consulte GET /api/collections/{id} para seguir el estado."
        if status == "queued"
        else (
            "Procesamiento con modelo personalizado iniciado. "
            "Consulte GET /api/collections/{id} para seguir el avance."
        )
    )
    return GenerateGraphResponse(
        collection_id=collection_id,
        processing_status=status,
        detail=detail,
    )


class CytoscapeElement(BaseModel):
    data: dict[str, Any]


class CytoscapeElements(BaseModel):
    nodes: list[CytoscapeElement]
    edges: list[CytoscapeElement]


class CytoscapeGraph(BaseModel):
    ready: bool = True
    processing_status: str = "graph_ready"
    message: str | None = None
    elements: CytoscapeElements


@router.get("/{collection_id}/graph", response_model=CytoscapeGraph)
async def get_collection_graph(
    collection_id: UUID,
    user_id: str = Depends(get_current_user),
) -> CytoscapeGraph:
    """Devuelve el grafo de conocimiento de la colección en formato Cytoscape.js."""
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    status = collection.get("processing_status", "idle")
    if status not in _GRAPH_AVAILABLE_STATUSES:
        return CytoscapeGraph(
            ready=False,
            processing_status=status,
            message=_graph_unavailable_detail(status),
            elements=CytoscapeElements(nodes=[], edges=[]),
        )

    try:
        qm_bytes = supabase_client.download_collection_qm(
            user_id=user_id,
            collection_id=str(collection_id),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al descargar el grafo desde el almacenamiento.",
        ) from exc

    cytoscape = graph_transformer.qm_to_cytoscape(qm_bytes.decode("utf-8"))
    return CytoscapeGraph(
        ready=True,
        processing_status=status,
        message=None,
        elements=CytoscapeElements(**cytoscape["elements"]),
    )


@router.get("/{collection_id}/entities", response_model=CollectionEntities)
async def get_collection_entities(
    collection_id: UUID,
    user_id: str = Depends(get_current_user),
) -> CollectionEntities:
    """Devuelve las instancias de entidades del grafo de la colección.

    Usado por el frontend para poblar el dropdown de filtros avanzados antes
    de realizar una consulta semántica. El resultado se cachea en memoria para
    evitar descargar y parsear el .qm en cada request.
    """
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    status = collection.get("processing_status", "idle")
    if status not in _GRAPH_AVAILABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=_graph_unavailable_detail(status),
        )

    cached = graph_transformer.get_cached_facets(str(collection_id))
    if cached is not None:
        return CollectionEntities(**cached)

    try:
        qm_bytes = supabase_client.download_collection_qm(
            user_id=user_id,
            collection_id=str(collection_id),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al descargar el grafo desde el almacenamiento.",
        ) from exc

    facets = graph_transformer.extract_entity_facets(qm_bytes.decode("utf-8"))
    graph_transformer.set_cached_facets(str(collection_id), facets)
    return CollectionEntities(**facets)
