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
# Es un conjunto con los valores de processing_status que significan “ya hay un job en curso”:

# processing_text — extracción de texto (TXT, PDF digital PyMuPDF, PDF escaneado OCR/Vision).
# processing_graph — ya pasó la extracción (o parte) y Wukong está generando el grafo.

# La ruta POST .../process usa esto para no permitir re-disparar el botón "Generar Grafo" mientras esté en estos.


class ProcessCollectionResponse(BaseModel):
    collection_id: UUID # id de la colección que se está procesando
    processing_status: str # estado de procesamiento de la colección
    detail: str # mensaje de detalle para el usuario: Un mensaje en texto plano para el usuario o el front; 
    # por ejemplo que el trabajo quedó encolado y que puede hacer GET para ver el avance.
# declarar la estructura de lo que el endpoint devuelve para que el framework y el front sepan qué esperar. 
# En resumen: no es la lógica del negocio; es el contrato de la respuesta HTTP

@router.post(
    "/{collection_id}/process", # ruta del endpoint, es un parámetro de path: FastAPI lo lee de la URL 
    # y lo pasa a la función como collection_id: UUID
    response_model=ProcessCollectionResponse, # el framework sabe qué estructura tiene que tener la respuesta HTTP
    status_code=202, # 202 Accepted: el trabajo quedó encolado y se puede hacer GET para ver el avance.
)
async def process_collection( # función asíncrona que se ejecuta en background.
    collection_id: UUID, # id de la colección que se está procesando, FastAPI lo saca del path /{collection_id}/process y lo convierte a UUID.
    background_tasks: BackgroundTasks, # se usa para encolar la tarea en background, es un paquete de fastapi, lo importamos. FastAPI guarda “cuando termine de responder, llamo a process_collection con ese id”.
    user_id: str = Depends(get_current_user), # se usa para validar que el usuario es el dueño de la colección.
):
    """
    Dispara el procesamiento de una colección (HU-04 — botón "Generar Grafo").

    Encadena en background (`wukong_runner.process_collection`):
      1. Extracción de texto por documento: TXT (lectura directa), PDF digital (PyMuPDF),
         PDF escaneado (OCR con Google Cloud Vision; requiere credenciales GCP).
      2. Wukong genera el grafo en formato .qm.
      3. Pendiente carga en MillenniumDB. (PDT10-121)

    El POST no espera a que termine el trabajo. Responde 202 y el avance se consulta con
    GET /api/collections/{id} (`processing_status`, etc.).
    """
    collection = supabase_client.get_collection(
        collection_id=str(collection_id),
        user_id=user_id,
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Colección no encontrada.")

    current_status = collection.get("processing_status", "idle") # estado actual de la colección, si no está procesada, 
    # está idle (idle es un valor por defecto que significa: “la colección no está en medio de un procesamiento”.).
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

    # Pipeline 1 en wukong_runner: incluye OCR (Vision) para PDFs detectados como escaneados;
    # luego Wukong sobre los textos extraídos.
    background_tasks.add_task(wukong_runner.process_collection, str(collection_id))

    return ProcessCollectionResponse(
        collection_id=collection_id,
        processing_status="processing_text",
        detail=(
            "Procesamiento encolado. "
            "Hacé GET /api/collections/{id} para seguir el avance."
        ),
    )