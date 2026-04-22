from functools import lru_cache

from supabase import Client, create_client

from app.config import settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_key)


def create_collection(user_id: str, name: str, description: str | None = None) -> dict:
    client = get_supabase_client()
    response = (
        client.table("collections")
        .insert({"user_id": user_id, "name": name, "description": description})
        .execute()
    )
    return response.data[0]


def get_collections(user_id: str) -> list:
    client = get_supabase_client()
    response = (
        client.table("collections").select("*").eq("user_id", user_id).execute()
    )
    return response.data


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
