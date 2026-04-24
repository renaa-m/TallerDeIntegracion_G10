from app.services.supabase_client import (
    get_supabase_client,
    save_document_text,
    update_document_status,
)


def download_file_from_storage(storage_path: str) -> bytes:
    """Descarga un archivo desde Supabase Storage (bucket 'documentos')."""
    client = get_supabase_client()
    return client.storage.from_("documentos").download(storage_path)


def extract_text_from_txt(file_content: bytes) -> str:
    """Lee el contenido de un archivo TXT como texto plano."""
    return file_content.decode("utf-8")


def process_txt_document(
    document_id: str,
    user_id: str,
    collection_id: str,
    storage_path: str,
) -> dict:
    """
    Pipeline completo para un archivo TXT:
    1. Marca el documento como 'extracting_text'
    2. Descarga el archivo desde Supabase Storage
    3. Lee el contenido como texto plano
    4. Guarda el texto en la tabla document_texts
    5. Marca el documento como 'text_extracted'

    Si algo falla, marca el documento como 'error' con el mensaje.
    """
    try:
        update_document_status(document_id, user_id, "extracting_text")

        file_content = download_file_from_storage(storage_path)
        extracted_text = extract_text_from_txt(file_content)

        save_document_text(
            document_id=document_id,
            user_id=user_id,
            collection_id=collection_id,
            extracted_text=extracted_text,
            extraction_method="direct_read",
        )

        update_document_status(document_id, user_id, "text_extracted")

        return {"status": "ok", "document_id": document_id}

    except Exception as e:
        update_document_status(
            document_id, user_id, "error", error_message=str(e)
        )
        return {"status": "error", "document_id": document_id, "error": str(e)}
