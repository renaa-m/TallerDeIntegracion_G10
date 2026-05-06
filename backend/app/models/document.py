from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CollectionCreate(BaseModel):
    name: str
    description: str | None = None


class CollectionResponse(BaseModel):
    id: UUID
    user_id: str
    name: str
    description: str | None
    status: str
    processing_status: str = "idle"
    processing_error_message: str | None = None
    processed_at: datetime | None = None
    created_at: datetime


class DocumentResponse(BaseModel):
    id: UUID
    user_id: str
    collection_id: UUID
    filename: str
    file_type: str
    file_size_bytes: int | None
    storage_path: str
    status: str
    error_message: str | None
    created_at: datetime


class DocumentStatusUpdate(BaseModel):
    status: str
    error_message: str | None = None
