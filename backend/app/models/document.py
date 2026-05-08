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
    sha256_hash: str | None = None
    created_at: datetime


class DocumentStatusUpdate(BaseModel):
    status: str
    error_message: str | None = None


# ── HU-13: Batch upload response ──────────────────────────────────────────────


class ArchivoExitoso(BaseModel):
    filename: str
    documento: DocumentResponse


class ArchivoDuplicado(BaseModel):
    filename: str
    documento_existente: DocumentResponse


class ArchivoFallido(BaseModel):
    filename: str
    motivo: str


class BatchUploadResponse(BaseModel):
    exitos: list[ArchivoExitoso]
    duplicados: list[ArchivoDuplicado]
    fallidos: list[ArchivoFallido]
