from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.middleware.auth import get_current_user
from app.models.document import DocumentResponse
from app.services import supabase_client

router = APIRouter(prefix="/api/documentos", tags=["documentos"])

_FORMATOS_ACEPTADOS = {".pdf", ".txt"}
_TAMANO_MAXIMO_MB = 50
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


@router.post("/upload", response_model=DocumentResponse, status_code=201)
async def upload_documento(
    file: UploadFile,
    coleccion_id: UUID,
    user_id: str = Depends(get_current_user),
):
    # --- NUEVO: VALIDACIÓN DE AISLAMIENTO (SEGURIDAD) ---
    coleccion = supabase_client.get_collection_by_id(str(coleccion_id))
    
    if not coleccion:
        raise HTTPException(status_code=404, detail="La colección no existe.")
        
    if coleccion["user_id"] != user_id:
        raise HTTPException(
            status_code=403, 
            detail="Acceso denegado. Esta colección no te pertenece."
        )
    # ----------------------------------------------------
    if file.size is not None and file.size > _TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"El archivo supera el tamaño máximo permitido de {_TAMANO_MAXIMO_MB} MB.",
        )

    contenido = await file.read()
    extension = _validar_archivo(file.filename, contenido)

    doc_id = uuid4()
    ruta = f"{user_id}/{coleccion_id}/{doc_id}"

    try:
        await supabase_client.upload_file(ruta, contenido, _CONTENT_TYPES[extension])
    except Exception as exc:
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
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="El archivo se subió pero no se pudo registrar en la base de datos.",
        ) from exc

    return documento


@router.get("", response_model=list[DocumentResponse])
async def listar_documentos(
    coleccion_id: UUID | None = None,
    user_id: str = Depends(get_current_user),
):
    try:
        return await supabase_client.list_documents(
            user_id, str(coleccion_id) if coleccion_id is not None else None
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Error al obtener la lista de documentos.",
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
    return documento
