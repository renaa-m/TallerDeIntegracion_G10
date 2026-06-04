from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    language: str = "es"


class FailedProcessingDocument(BaseModel):
    filename: str
    reason: str | None = None


class CollectionResponse(BaseModel):
    id: UUID
    user_id: str
    name: str
    description: str | None
    status: str
    language: str = "es"
    processing_status: str = "idle"
    processing_error_message: str | None = None
    processed_at: datetime | None = None
    text_progress_total: int = 0
    text_progress_processed: int = 0
    graph_progress_total: int = 0
    graph_progress_processed: int = 0

    text_failed_documents: list[FailedProcessingDocument] = Field(default_factory=list)
    graph_failed_documents: list[FailedProcessingDocument] = Field(default_factory=list)
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
