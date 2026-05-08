import asyncio
from functools import lru_cache
from uuid import uuid4

from supabase import Client, create_client

from app.config import settings

BUCKET = "documentos"


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


@lru_cache(maxsize=1)
def _get_service_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Collections ────────────────────────────────────────────────────────────────


def create_collection(user_id: str, name: str, description: str | None = None) -> dict:
    client = get_supabase_client()
    data = {
        "id": str(uuid4()),
        "user_id": user_id,
        "name": name,
        "description": description,
        "status": "active",
    }
    response = client.table("collections").insert(data).execute()
    return response.data[0]


def get_collections(user_id: str) -> list:
    client = get_supabase_client()
    response = (
        client.table("collections")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return response.data


def get_collection(collection_id: str, user_id: str) -> dict | None:
    client = get_supabase_client()
    response = (
        client.table("collections")
        .select("*")
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not response.data:
        return None
    return response.data[0]


def delete_collection(collection_id: str, user_id: str) -> bool:
    client = get_supabase_client()
    response = (
        client.table("collections")
        .delete()
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    return len(response.data) > 0


def update_collection_name(collection_id: str, user_id: str, new_name: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client.table("collections")
        .update({"name": new_name})
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        return None
    return result.data[0]


# ── Documents — sync ───────────────────────────────────────────────────────────


def create_document(
    user_id: str,
    collection_id: str,
    filename: str,
    file_type: str,
    file_size_bytes: int | None,
    storage_path: str,
    sha256_hash: str | None = None,
) -> dict:
    client = get_supabase_client()
    payload: dict = {
        "user_id": user_id,
        "collection_id": collection_id,
        "filename": filename,
        "file_type": file_type,
        "file_size_bytes": file_size_bytes,
        "storage_path": storage_path,
    }
    if sha256_hash is not None:
        payload["sha256_hash"] = sha256_hash
    response = client.table("documents").insert(payload).execute()
    return response.data[0]


def get_documents(user_id: str, collection_id: str) -> list:
    client = get_supabase_client()
    response = (
        client.table("documents")
        .select("*")
        .eq("user_id", user_id)
        .eq("collection_id", collection_id)
        .execute()
    )
    return response.data


def update_document_status(
    document_id: str,
    user_id: str,
    status: str,
    error_message: str | None = None,
) -> dict:
    client = get_supabase_client()
    payload: dict = {"status": status}
    if error_message is not None:
        payload["error_message"] = error_message
    response = (
        client.table("documents")
        .update(payload)
        .eq("id", document_id)
        .eq("user_id", user_id)
        .execute()
    )
    return response.data[0]


def save_document_text(
    document_id: str,
    user_id: str,
    collection_id: str,
    extracted_text: str,
    extraction_method: str,
) -> dict:
    client = get_supabase_client()
    response = (
        client.table("document_texts")
        .insert(
            {
                "document_id": document_id,
                "user_id": user_id,
                "collection_id": collection_id,
                "extracted_text": extracted_text,
                "extraction_method": extraction_method,
            }
        )
        .execute()
    )
    return response.data[0]


def _get_document_sync(doc_id: str, user_id: str) -> dict | None:
    result = (
        get_supabase_client()
        .table("documents")
        .select("*")
        .eq("id", doc_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data[0] if result.data else None


def _list_documents_sync(user_id: str, collection_id: str | None) -> list[dict]:
    query = get_supabase_client().table("documents").select("*").eq("user_id", user_id)
    if collection_id is not None:
        query = query.eq("collection_id", collection_id)
    return query.order("created_at", desc=True).execute().data


def get_collection_by_id(collection_id: str) -> dict | None:
    """Busca una colección por su ID para verificar su propietario."""
    client = get_supabase_client()
    response = client.table("collections").select("*").eq("id", collection_id).execute()
    return response.data[0] if response.data else None


def _find_document_by_hash_sync(
    user_id: str, collection_id: str, sha256_hash: str
) -> dict | None:
    result = (
        get_supabase_client()
        .table("documents")
        .select("*")
        .eq("user_id", user_id)
        .eq("collection_id", collection_id)
        .eq("sha256_hash", sha256_hash)
        .execute()
    )
    return result.data[0] if result.data else None


# ── Documents — async (usados por las rutas async) ─────────────────────────────


def _upload_sync(path: str, content: bytes, content_type: str) -> None:
    _get_service_client().storage.from_(BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type},  # upsert omitido: causaba error
    )


def classify_upload_error(exc: Exception) -> str:
    """Traduce una excepción de storage a un mensaje amigable en español."""
    msg = str(exc).lower()
    if "timeout" in msg or "timed out" in msg:
        return "Tiempo de espera agotado al conectar con el almacenamiento"
    if any(k in msg for k in ("connection", "network", "refused", "unreachable")):
        return "Error de conexión con el almacenamiento"
    if "already exists" in msg or "duplicate" in msg:
        return "El archivo ya existe en el almacenamiento"
    if "too large" in msg or "size" in msg:
        return "El archivo supera el tamaño máximo permitido"
    if "corrupt" in msg or "invalid" in msg:
        return "Archivo corrupto o ilegible"
    return "Error interno del servidor al subir el archivo"


async def upload_file(path: str, content: bytes, content_type: str) -> None:
    """Sube un archivo con reintentos automáticos y backoff exponencial (HU-13)."""
    last_exc: Exception = RuntimeError("Sin intentos disponibles")
    for attempt in range(settings.max_upload_retries):
        try:
            await asyncio.to_thread(_upload_sync, path, content, content_type)
            return
        except Exception as exc:
            last_exc = exc
            if attempt < settings.max_upload_retries - 1:
                delay = settings.upload_retry_delay_seconds * (2 ** attempt)
                await asyncio.sleep(delay)
    raise last_exc


async def insert_document(
    user_id: str,
    collection_id: str,
    filename: str,
    file_type: str,
    file_size_bytes: int | None,
    storage_path: str,
    sha256_hash: str | None = None,
) -> dict:
    return await asyncio.to_thread(
        create_document,
        user_id,
        collection_id,
        filename,
        file_type,
        file_size_bytes,
        storage_path,
        sha256_hash,
    )


async def find_document_by_hash(
    user_id: str, collection_id: str, sha256_hash: str
) -> dict | None:
    return await asyncio.to_thread(
        _find_document_by_hash_sync, user_id, collection_id, sha256_hash
    )


async def list_documents(user_id: str, collection_id: str | None = None) -> list[dict]:
    return await asyncio.to_thread(_list_documents_sync, user_id, collection_id)


async def get_document(doc_id: str, user_id: str) -> dict | None:
    return await asyncio.to_thread(_get_document_sync, doc_id, user_id)
