import asyncio
import hashlib
from pathlib import Path
from uuid import UUID, uuid4
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.middleware.auth import get_current_user
from app.models.document import (
    ArchivoExitoso,
    ArchivoDuplicado,
    ArchivoFallido,
    BatchUploadResponse,
    DocumentResponse,
    DocumentSignedUrlResponse,
)
from app.services import supabase_client

router = APIRouter(prefix="/api/documentos", tags=["documentos"])

_FORMATOS_ACEPTADOS = {".pdf", ".txt"}
# Cloud Run rechaza cuerpos HTTP > ~32 MiB antes de que lleguen a FastAPI.
# Limitar a 30 MB deja margen para headers y multipart overhead.
_TAMANO_MAXIMO_MB = 30
_TAMANO_MAXIMO_BYTES = _TAMANO_MAXIMO_MB * 1024 * 1024
_CONTENT_TYPES = {".pdf": "application/pdf", ".txt": "text/plain"}


def _validar_archivo(filename: str | None, contenido: bytes) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension not in _FORMATOS_ACEPTADOS:
        formatos = " y ".join(
            f.upper().lstrip(".") for f in sorted(_FORMATOS_ACEPTADOS)
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"Formato de archivo no aceptado: "
                f"'{extension or 'sin extensión'}'. "
                f"Los formatos aceptados son: {formatos}."
            ),
        )
    if len(contenido) > _TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"El archivo supera el tamaño máximo permitido de {_TAMANO_MAXIMO_MB} MB.",
        )
    return extension


def _validar_coleccion(coleccion_id: UUID, user_id: str) -> None:
    coleccion = supabase_client.get_collection_by_id(str(coleccion_id))
    if not coleccion:
        raise HTTPException(status_code=404, detail="La colección no existe.")
    if coleccion["user_id"] != user_id:
        raise HTTPException(
            status_code=403, detail="Acceso denegado. Esta colección no te pertenece."
        )


@router.post("/upload", response_model=DocumentResponse, status_code=201)
async def upload_documento(
    file: UploadFile,
    coleccion_id: UUID,
    user_id: str = Depends(get_current_user),
):
    _validar_coleccion(coleccion_id, user_id)

    if file.size is not None and file.size > _TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"El archivo supera el tamaño máximo permitido de {_TAMANO_MAXIMO_MB} MB.",
        )

    contenido = await file.read()
    extension = _validar_archivo(file.filename, contenido)
    sha256_hash = hashlib.sha256(contenido).hexdigest()

    # Duplicate check: return 409 if same file already exists in this collection
    doc_existente = await supabase_client.find_document_by_hash(
        user_id, str(coleccion_id), sha256_hash
    )
    if doc_existente:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El archivo ya existe en esta colección "
                f"(id: {doc_existente['id']}, nombre: {doc_existente['filename']})."
            ),
        )

    safe_user_id = supabase_client.storage_path_user_folder(user_id)
    doc_id = uuid4()
    ruta = f"{safe_user_id}/{coleccion_id}/{doc_id}"

    try:
        await supabase_client.upload_file(ruta, contenido, _CONTENT_TYPES[extension])
    except Exception as exc:
        print("ERROR STORAGE:", repr(exc))
        raise HTTPException(
            status_code=502,
            detail="Error al subir el archivo al almacenamiento.",
        ) from exc

    try:
        documento = await supabase_client.insert_document(
            user_id=user_id,
            collection_id=str(coleccion_id),
            filename=file.filename,
            file_type=extension.lstrip("."),
            file_size_bytes=len(contenido),
            storage_path=ruta,
            sha256_hash=sha256_hash,
        )
    except Exception as exc:
        print("ERROR DB:", repr(exc))
        raise HTTPException(
            status_code=502,
            detail="El archivo se subió pero no se pudo registrar en la base de datos.",
        ) from exc

    return documento


@router.post("/upload/batch", response_model=BatchUploadResponse, status_code=200)
async def batch_upload_documentos(
    files: list[UploadFile],
    coleccion_id: UUID,
    user_id: str = Depends(get_current_user),
):
    """
    Sube múltiples archivos a una colección con detección de duplicados y reintentos.
    Retorna una respuesta parcial detallada: exitos, duplicados y fallidos.
    """
    _validar_coleccion(coleccion_id, user_id)

    exitos: list[ArchivoExitoso] = []
    duplicados: list[ArchivoDuplicado] = []
    fallidos: list[ArchivoFallido] = []

    for file in files:
        filename = file.filename or "archivo_sin_nombre"
        try:
            # Tamaño pre-check sin leer el contenido aún
            if file.size is not None and file.size > _TAMANO_MAXIMO_BYTES:
                fallidos.append(
                    ArchivoFallido(
                        filename=filename,
                        motivo=f"El archivo supera el tamaño máximo de {_TAMANO_MAXIMO_MB} MB",
                    )
                )
                continue

            contenido = await file.read()

            try:
                extension = _validar_archivo(filename, contenido)
            except HTTPException as exc:
                fallidos.append(ArchivoFallido(filename=filename, motivo=exc.detail))
                continue

            sha256_hash = hashlib.sha256(contenido).hexdigest()

            # Duplicate detection
            doc_existente = await supabase_client.find_document_by_hash(
                user_id, str(coleccion_id), sha256_hash
            )
            if doc_existente:
                duplicados.append(
                    ArchivoDuplicado(
                        filename=filename,
                        documento_existente=DocumentResponse(**doc_existente),
                    )
                )
                continue

            safe_user_id = supabase_client.storage_path_user_folder(user_id)
            doc_id = uuid4()
            ruta = f"{safe_user_id}/{coleccion_id}/{doc_id}"

            try:
                await supabase_client.upload_file(
                    ruta, contenido, _CONTENT_TYPES[extension]
                )
            except Exception as exc:
                fallidos.append(
                    ArchivoFallido(
                        filename=filename,
                        motivo=supabase_client.classify_upload_error(exc),
                    )
                )
                continue

            try:
                documento = await supabase_client.insert_document(
                    user_id=user_id,
                    collection_id=str(coleccion_id),
                    filename=filename,
                    file_type=extension.lstrip("."),
                    file_size_bytes=len(contenido),
                    storage_path=ruta,
                    sha256_hash=sha256_hash,
                )
                exitos.append(
                    ArchivoExitoso(
                        filename=filename,
                        documento=DocumentResponse(**documento),
                    )
                )
            except Exception:
                fallidos.append(
                    ArchivoFallido(
                        filename=filename,
                        motivo="El archivo se subió pero no se pudo registrar en la base de datos",
                    )
                )

        except Exception:
            fallidos.append(
                ArchivoFallido(
                    filename=filename,
                    motivo="Error inesperado al procesar el archivo",
                )
            )

    return BatchUploadResponse(exitos=exitos, duplicados=duplicados, fallidos=fallidos)


@router.get("", response_model=list[DocumentResponse])
async def listar_documentos(
    coleccion_id: UUID | None = None,
    user_id: str = Depends(get_current_user),
):
    documentos = await supabase_client.list_documents(
        user_id, str(coleccion_id) if coleccion_id is not None else None
    )
    
    # Agregar la URL a cada documento antes de retornar
    for doc in documentos:
        storage_path = doc.get("storage_path")
        if storage_path:
            try:
                signed = await asyncio.to_thread(
                    supabase_client.create_signed_url, storage_path
                )
                if isinstance(signed, str) and signed.strip().startswith("http"):
                    doc["url"] = signed.strip()
                else:
                    doc["url"] = None
            except Exception:
                doc["url"] = None
        else:
            doc["url"] = None

    return documentos



@router.get("/signed-url")
async def get_signed_url(
    path: str,
    user_id: str = Depends(get_current_user),
):
    """
    Genera una URL firmada temporal para acceder a un documento en Supabase Storage.
    La URL expira en 5 minutos y solo funciona para este usuario específico.
    """
    safe_user_id = supabase_client.storage_path_user_folder(user_id)
    if not path.startswith(safe_user_id + "/"):
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    
    try:
        # Supabase genera URL firmada que expira en 5 minutos (300 segundos)
        url = await asyncio.to_thread(
            supabase_client.create_signed_url, 
            path,
            expires_in=30  # ← 5 minutos de expiración
        )
        
        # Calcular cuándo expira (aproximadamente)
        expires_at = datetime.utcnow() + timedelta(minutes=5)
        
        return {
            "url": url,
            "expires_at": expires_at.isoformat(),
            "expires_in_seconds": 300
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="No se pudo generar el enlace de descarga.",
        ) from exc

@router.get("/{doc_id}", response_model=DocumentResponse)
async def obtener_documento(
    doc_id: UUID,
    user_id: str = Depends(get_current_user),
):
    try:
        documento = await supabase_client.get_document(str(doc_id), user_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al obtener el documento.",
        ) from exc

    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    # Añadir URL firmada válida si es posible
    try:
        signed = await asyncio.to_thread(
            supabase_client.create_signed_url, documento.get("storage_path")
        )
        if isinstance(signed, str) and signed.strip().startswith("http"):
            documento["url"] = signed.strip()
        else:
            documento["url"] = None
    except Exception:
        documento["url"] = None

    return documento


@router.get("/{doc_id}/signed-url", response_model=DocumentSignedUrlResponse)
async def obtener_documento_signed_url(
    doc_id: UUID,
    user_id: str = Depends(get_current_user),
):
    try:
        documento = await supabase_client.get_document(str(doc_id), user_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al obtener el documento.",
        ) from exc

    if documento is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")

    try:
        signed_url = await asyncio.to_thread(
            supabase_client.create_signed_url, documento.get("storage_path")
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al generar la URL firmada del documento.",
        ) from exc

    if not (isinstance(signed_url, str) and signed_url.strip().startswith("http")):
        raise HTTPException(
            status_code=502,
            detail="URL firmada inválida del documento.",
        )

    return DocumentSignedUrlResponse(url=signed_url.strip())
