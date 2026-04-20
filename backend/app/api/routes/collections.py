from fastapi import APIRouter, HTTPException

from app.models.document import CollectionCreate, CollectionResponse

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.get("", response_model=list[CollectionResponse])
async def list_collections():
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("", response_model=CollectionResponse, status_code=201)
async def create_collection(body: CollectionCreate):
    raise HTTPException(status_code=501, detail="Not implemented")
