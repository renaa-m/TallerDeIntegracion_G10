import asyncio
import logging
from functools import lru_cache
from uuid import uuid4

from supabase import Client, create_client

from app.config import settings

logger = logging.getLogger(__name__)

BUCKET = "documentos"
# Primer segmento del path: igual que en upload de documentos (Storage rechaza '|' en la clave).
# objeto = `{collection_id}.qm`. Ruta legacy (borrado): .../knowledge_graph.qm
LEGACY_QM_BASENAME = "knowledge_graph.qm"
UPLOAD_SEMAPHORE = asyncio.Semaphore(5)


def storage_path_user_folder(user_id: str) -> str:
    """Primer segmento de rutas en el bucket ``documentos`` (claves válidas en Storage).

    Auth0 / Google usan ``provider|numeric_id``; el pipe no es válido como object key
    (``InvalidKey``). Misma regla que ``documentos.py``: ``|`` → ``_``.
    """
    return str(user_id).strip().replace("|", "_")


def _norm_storage_user_id(user_id: str) -> str:
    return str(user_id).strip()


def _norm_collection_id(collection_id: str) -> str:
    return str(collection_id).strip()

@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


@lru_cache(maxsize=1)
def _get_service_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Collections ────────────────────────────────────────────────────────────────


def create_collection(
    user_id: str,
    name: str,
    description: str | None = None,
    language: str = "es",
) -> dict:
    client = get_supabase_client()
    data = {
        "id": str(uuid4()),
        "user_id": user_id,
        "name": name,
        "description": description,
        "status": "active",
        "language": language,
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
    return response.data or []


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


def collection_qm_storage_path(user_id: str, collection_id: str) -> str:
    """Ruta canónica del .qm: ``{storage_user_folder}/{collection_id}/{collection_id}.qm``."""
    folder = storage_path_user_folder(user_id)
    cid = _norm_collection_id(collection_id)
    return f"{folder}/{cid}/{cid}.qm"


def legacy_collection_qm_storage_path(user_id: str, collection_id: str) -> str:
    """Ruta antigua del .qm (solo para limpiar al borrar colección)."""
    folder = storage_path_user_folder(user_id)
    cid = _norm_collection_id(collection_id)
    return f"{folder}/{cid}/{LEGACY_QM_BASENAME}"


def delete_collection(collection_id: str, user_id: str) -> bool:
    client = get_supabase_client()
    collection_response = (
        client.table("collections")
        .select("id, qm_storage_path")
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not collection_response.data:
        return False
    row = collection_response.data[0]
    documents_response = (
        client.table("documents")
        .select("id, storage_path")
        .eq("collection_id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    documents = documents_response.data or []
    storage_paths = [
        doc["storage_path"]
        for doc in (documents)
        if doc.get("storage_path")
    ]
    uid = _norm_storage_user_id(user_id)
    cid = _norm_collection_id(collection_id)
    qm_candidates = [
        row.get("qm_storage_path"),
        collection_qm_storage_path(uid, cid),
        legacy_collection_qm_storage_path(uid, cid),
        # Intento histórico con '|' en el primer segmento (fallaba en Storage; por si quedó en DB).
        f"{uid}/{cid}/{cid}.qm",
        f"{uid}/{cid}/{LEGACY_QM_BASENAME}",
    ]
    qm_paths = [p for p in qm_candidates if p]
    paths_to_remove = list(dict.fromkeys([*storage_paths, *qm_paths]))
    if paths_to_remove:
        try:
            client.storage.from_(BUCKET).remove(paths_to_remove)
        except Exception:
            # Algunos objetos pueden no existir (p. ej. grafo nunca exportado).
            pass
    client.table("chunk_embeddings").delete().eq(
        "collection_id",
        collection_id,
    ).execute()

    client.table("document_texts").delete().eq(
        "collection_id",
        collection_id,
    ).eq(
        "user_id",
        user_id,
    ).execute()

    client.table("documents").delete().eq(
        "collection_id",
        collection_id,
    ).eq(
        "user_id",
        user_id,
    ).execute()

    delete_response = (
        client.table("collections")
        .delete()
        .eq("id", collection_id)
        .eq("user_id", user_id)
        .execute()
    )
    return len(delete_response.data) > 0


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


def update_collection_processing_status(
    collection_id: str,
    processing_status: str,
    error_message: str | None = None,
    processed_at: str | None = None,
) -> dict | None:
    """
    Actualiza el estado de procesamiento de una colección.

    Estados válidos: idle, queued, processing_text, processing_graph,
    awaiting_graph_confirmation, graph_ready, partial_error, error, cancelled.

    Cuando se llega a un estado terminal (graph_ready, partial_error, error, cancelled)
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


_ACTIVE_PROCESSING_STATUSES = (
    "processing_text",
    "processing_graph",
    "awaiting_graph_confirmation",
)


def user_has_active_processing(
    user_id: str,
    *,
    exclude_collection_id: str | None = None,
) -> bool:
    """True si el usuario ocupa el slot de pipeline (activo o esperando confirmación de grafo).

    ``exclude_collection_id`` permite ignorar una colección (p. ej. continuar grafo en la misma
    que está en ``awaiting_graph_confirmation``).
    """
    client = _get_service_client()
    query = (
        client.table("collections")
        .select("id")
        .eq("user_id", user_id)
        .in_("processing_status", list(_ACTIVE_PROCESSING_STATUSES))
    )
    if exclude_collection_id:
        query = query.neq("id", exclude_collection_id)
    response = query.limit(1).execute()
    return bool(response.data)


def get_next_queued_collection(user_id: str) -> dict | None:
    """Siguiente colección en cola (FIFO por ``updated_at``)."""
    client = _get_service_client()
    response = (
        client.table("collections")
        .select("*")
        .eq("user_id", user_id)
        .eq("processing_status", "queued")
        .order("updated_at")
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def list_collections_by_processing_statuses(
    statuses: tuple[str, ...] | list[str],
    *,
    user_id: str | None = None,
) -> list[dict]:
    if not statuses:
        return []
    client = _get_service_client()
    query = (
        client.table("collections")
        .select("id, user_id, name, processing_status")
        .in_("processing_status", list(statuses))
    )
    if user_id is not None:
        query = query.eq("user_id", user_id)
    response = query.execute()
    return response.data or []


def get_user_blocking_collection(
    user_id: str,
    *,
    exclude_collection_id: str | None = None,
) -> dict | None:
    """Colección que impide iniciar procesamiento en otra (activa o en pausa)."""
    client = _get_service_client()
    query = (
        client.table("collections")
        .select("id, name, processing_status")
        .eq("user_id", user_id)
        .in_("processing_status", list(_ACTIVE_PROCESSING_STATUSES))
    )
    if exclude_collection_id:
        query = query.neq("id", exclude_collection_id)
    response = query.limit(1).execute()
    return response.data[0] if response.data else None


def set_collection_queued(
    collection_id: str,
    queue_action: str,
    *,
    payload: dict | None = None,
) -> dict | None:
    client = _get_service_client()
    row: dict = {
        "processing_status": "queued",
        "queue_action": queue_action,
        "queue_payload": payload,
        "processing_error_message": None,
    }
    response = (
        client.table("collections")
        .update(row)
        .eq("id", collection_id)
        .execute()
    )
    return response.data[0] if response.data else None


def clear_collection_queue_metadata(collection_id: str) -> None:
    client = _get_service_client()
    client.table("collections").update(
        {"queue_action": None, "queue_payload": None}
    ).eq("id", collection_id).execute()


def update_collection_progress(
    collection_id: str,
    text_progress_total: int | None = None,
    text_progress_processed: int | None = None,
    graph_progress_total: int | None = None,
    graph_progress_processed: int | None = None,
    text_failed_documents: list[dict] | None = None,
    graph_failed_documents: list[dict] | None = None,
) -> dict | None:
    """
    Actualiza el progreso del procesamiento de una colección.

    Se usan None como valores por defecto para actualizar solo los campos
    enviados y no pisar el resto del progreso.
    """
    client = _get_service_client()

    payload: dict = {}

    if text_progress_total is not None:
        payload["text_progress_total"] = text_progress_total

    if text_progress_processed is not None:
        payload["text_progress_processed"] = text_progress_processed

    if graph_progress_total is not None:
        payload["graph_progress_total"] = graph_progress_total

    if graph_progress_processed is not None:
        payload["graph_progress_processed"] = graph_progress_processed

    if text_failed_documents is not None:
        payload["text_failed_documents"] = text_failed_documents

    if graph_failed_documents is not None:
        payload["graph_failed_documents"] = graph_failed_documents

    if not payload:
        return None

    response = (
        client.table("collections")
        .update(payload)
        .eq("id", collection_id)
        .execute()
    )

    return response.data[0] if response.data else None


def update_collection_qm_storage_path(collection_id: str, qm_storage_path: str | None) -> None:
    """Persiste la ruta del .qm en Storage (service role)."""
    client = _get_service_client()
    response = (
        client.table("collections")
        .update({"qm_storage_path": qm_storage_path})
        .eq("id", collection_id)
        .execute()
    )
    if response.data:
        logger.info(
            "qm_storage_path: update OK collection_id=%s path=%s (filas en respuesta: %d)",
            collection_id,
            qm_storage_path,
            len(response.data),
        )
        return
    verify = (
        client.table("collections")
        .select("id", "qm_storage_path")
        .eq("id", collection_id)
        .execute()
    )
    row = verify.data[0] if verify.data else None
    logger.warning(
        "qm_storage_path: respuesta vacía al UPDATE para collection_id=%s; "
        "verificación SELECT: %s",
        collection_id,
        row,
    )
    if row and row.get("qm_storage_path"):
        logger.info(
            "qm_storage_path: la columna sí tiene valor tras UPDATE (posible prefer minimal): %s",
            row.get("qm_storage_path"),
        )
    elif row:
        logger.warning(
            "qm_storage_path: sigue nulo/vacío en DB para id=%s — revisar migración 005 o que el UUID coincida con collections.id",
            collection_id,
        )


def download_collection_qm(user_id: str, collection_id: str) -> bytes:
    """Descarga el archivo .qm de Supabase Storage y devuelve sus bytes."""
    path = collection_qm_storage_path(user_id, collection_id)
    logger.info(
        "download_collection_qm: descargando bucket=%s path=%s",
        BUCKET,
        path,
    )
    return _get_service_client().storage.from_(BUCKET).download(path)


def upload_collection_qm(user_id: str, collection_id: str, content: bytes) -> str:
    """
    Sube el .qm bajo ``{storage_user_folder}/{collection_id}/{collection_id}.qm``
    (ver ``storage_path_user_folder``; coincide con rutas de documentos).
    Usa upsert para sobrescribir si se reprocesa la colección.
    """
    path = collection_qm_storage_path(user_id, collection_id)
    logger.info(
        "upload_collection_qm: subiendo a bucket=%s path=%s (%d bytes)",
        BUCKET,
        path,
        len(content),
    )
    try:
        _upload_sync(path, content, "application/octet-stream", upsert=True)
    except Exception:
        logger.exception("upload_collection_qm: falló el upload path=%s", path)
        raise
    logger.info("upload_collection_qm: upload terminado path=%s", path)
    return path


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
    return response.data[0] if response.data else None


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
    found = response.data[0] if response.data else None
    if not found:
        logger.debug(
            "get_collection_by_id: 0 filas para id=%r (tipo=%s)",
            collection_id,
            type(collection_id).__name__,
        )
    return found


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


def create_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Genera una URL firmada de Supabase Storage válida por `expires_in` segundos (default 1h)."""
    response = _get_service_client().storage.from_(BUCKET).create_signed_url(
        storage_path, expires_in
    )
    return response["signedURL"]


def _upload_sync(
    path: str, content: bytes, content_type: str, *, upsert: bool = False
) -> None:
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    opts: dict[str, str] = {"content-type": content_type}
    if upsert:
        opts["upsert"] = "true"
    client.storage.from_(BUCKET).upload(
        path=path,
        file=content,
        file_options=opts,
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
    last_exc: Exception = RuntimeError("Sin intentos disponibles")

    async with UPLOAD_SEMAPHORE:
        for attempt in range(settings.max_upload_retries):
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(_upload_sync, path, content, content_type),
                    timeout=300,
                )
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


# ── Chunk Embeddings ───────────────────────────────────────────────────────────


def save_chunk_embeddings(records: list[dict]) -> None:
    """Inserta embeddings de chunks en bulk en la tabla chunk_embeddings.

    Cada record debe tener: chunk_id, collection_id, document_id, document_name,
    chunk_index, chunk_text, embedding (list[float]), entity_types (list[str]).
    """
    client = _get_service_client()
    rows = [
        {
            "chunk_id": r["chunk_id"],
            "collection_id": r["collection_id"],
            "document_id": r["document_id"],
            "document_name": r["document_name"],
            "chunk_index": r["chunk_index"],
            "chunk_text": r["chunk_text"],
            "embedding": r["embedding"],
            "entity_types": r.get("entity_types", []),
        }
        for r in records
    ]
    client.table("chunk_embeddings").insert(rows).execute()


def search_chunks(
    query_embedding: list[float],
    collection_id: str,
    limit: int = 10,
    entity_types: list[str] | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
) -> list[dict]:
    """Búsqueda semántica sobre chunk_embeddings usando la función SQL search_chunks."""
    client = _get_service_client()
    result = client.rpc(
        "search_chunks",
        {
            "query_embedding": query_embedding,
            "p_collection_id": collection_id,
            "p_limit": limit,
            "p_entity_types": entity_types,
            "p_year_min": year_min,
            "p_year_max": year_max,
        },
    ).execute()
    return result.data or []
