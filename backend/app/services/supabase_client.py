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

def create_collection(user_id: str, name: str, description: str | None = None,) -> dict:
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
        client.table("collections").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
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

def update_collection_name(collection_id: str,user_id: str,new_name: str,) -> dict | None:
    client = get_supabase_client()

    result = (client.table("collections").update({"name": new_name}).eq("id", collection_id).eq("user_id", user_id).execute()
    )

    if not result.data:
        return None

    return result.data[0]


def update_collection_processing_status(
    collection_id: str,
    processing_status: str,
    error_message: str | None = None,
    processed_at: str | None = None,
) -> dict | None:
    """
    Actualiza el estado de procesamiento de una colección.

    Estados válidos: idle, processing_text, processing_graph,
    graph_ready, partial_error, error.

    Cuando se llega a un estado terminal (graph_ready, partial_error, error)
    conviene pasar también processed_at con el timestamp ISO.
    """
    client = _get_service_client()
    payload: dict = {"processing_status": processing_status}
    if error_message is not None:
        payload["processing_error_message"] = error_message
    if processed_at is not None:
        payload["processed_at"] = processed_at

    response = (
        client.table("collections")
        .update(payload)
        .eq("id", collection_id)
        .execute()
    )
    return response.data[0] if response.data else None


# ── Documents — sync ───────────────────────────────────────────────────────────


def create_document(
    user_id: str,
    collection_id: str,
    filename: str,
    file_type: str,
    file_size_bytes: int | None,
    storage_path: str,
) -> dict:
    client = get_supabase_client()
    response = (
        client.table("documents")
        .insert(
            {
                "user_id": user_id,
                "collection_id": collection_id,
                "filename": filename,
                "file_type": file_type,
                "file_size_bytes": file_size_bytes,
                "storage_path": storage_path,
            }
        )
        .execute()
    )
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


def get_documents_by_collection(collection_id: str) -> list:
    """
    Devuelve todos los documentos de una colección sin filtrar por user
    (uso interno del backend, una vez ya se valida el ownership en el
    endpoint que llama).
    """
    client = _get_service_client()
    response = (
        client.table("documents")
        .select("*")
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


def get_document_texts_by_collection(collection_id: str) -> list[dict]:
    """
    Devuelve todos los textos extraídos para los documentos de una colección.
    Cada elemento tiene al menos: document_id, extracted_text, extraction_method.
    """
    client = _get_service_client()
    response = (
        client.table("document_texts")
        .select("document_id, extracted_text, extraction_method")
        .eq("collection_id", collection_id)
        .execute()
    )
    return response.data or []


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


# ── Documents — async (usados por las rutas async) ─────────────────────────────


def _upload_sync(path: str, content: bytes, content_type: str) -> None:
    _get_service_client().storage.from_(BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type}, ##se retiró upsert: False (tiraba error)
    )


async def upload_file(path: str, content: bytes, content_type: str) -> None:
    await asyncio.to_thread(_upload_sync, path, content, content_type)


async def insert_document(
    user_id: str,
    collection_id: str,
    filename: str,
    file_type: str,
    file_size_bytes: int | None,
    storage_path: str,
) -> dict:
    return await asyncio.to_thread(
        create_document,
        user_id,
        collection_id,
        filename,
        file_type,
        file_size_bytes,
        storage_path,
    )


async def list_documents(user_id: str, collection_id: str | None = None) -> list[dict]:
    return await asyncio.to_thread(_list_documents_sync, user_id, collection_id)


async def get_document(doc_id: str, user_id: str) -> dict | None:
    return await asyncio.to_thread(_get_document_sync, doc_id, user_id)
