from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel
from app.middleware.auth import get_current_user
from app.models.document import CollectionCreate, CollectionResponse
from app.services import supabase_client

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