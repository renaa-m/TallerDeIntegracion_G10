from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel
from app.middleware.auth import get_current_user
from app.models.document import CollectionCreate, CollectionResponse
from app.services import supabase_client, wukong_runner

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
        )
        return collection

    except Exception as exc:
        print("ERROR CREATE COLLECTION:", repr(exc))
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


# Estados que indican que una colección ya está siendo procesada
# (no se permite re-disparar el botón "Generar Grafo" mientras esté en estos).
_PROCESSING_STATUSES = {"processing_text", "processing_graph"}


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
    if st not in _PROCESSING_STATUSES:
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
        error_message="Procesamiento cancelado por la usuaria.",
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

    current_status = collection.get("processing_status", "idle")
    if current_status in _PROCESSING_STATUSES:
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

    # Marca el estado inmediatamente para que el front lo vea en el siguiente
    # poll, sin tener que esperar a que arranque la BackgroundTask.
    supabase_client.update_collection_processing_status(
        str(collection_id), "processing_text"
    )

    background_tasks.add_task(wukong_runner.process_collection, str(collection_id))

    return ProcessCollectionResponse(
        collection_id=collection_id,
        processing_status="processing_text",
        detail=(
            "Procesamiento encolado. "
            "Hacé GET /api/collections/{id} para seguir el avance."
        ),
    )