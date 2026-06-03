import logging
import traceback

from auth0.authentication import GetToken
from auth0.management import Auth0
from supabase import create_client, Client

from app.config import settings
from app.services.supabase_client import BUCKET, storage_path_user_folder

logger = logging.getLogger(__name__)


def _delete_user_storage(supabase: Client, user_id: str) -> None:
    """Elimina todos los archivos del usuario en el bucket 'documentos'.

    La carpeta raíz del usuario en Storage es storage_path_user_folder(user_id)
    (el '|' del auth0 sub se normaliza a '_' para evitar InvalidKey).
    Se pagina la lista con limit=1000 para no perder archivos en cuentas grandes.
    """
    folder = storage_path_user_folder(user_id)
    offset = 0
    limit = 1000
    deleted_total = 0

    while True:
        try:
            items = (
                supabase.storage.from_(BUCKET)
                .list(folder, {"limit": limit, "offset": offset})
            )
        except Exception as exc:
            logger.warning("No se pudo listar Storage para %s (offset=%d): %s", user_id, offset, exc)
            break

        if not items:
            break

        paths = [f"{folder}/{item['name']}" for item in items if item.get("name")]
        if paths:
            try:
                supabase.storage.from_(BUCKET).remove(paths)
                deleted_total += len(paths)
            except Exception as exc:
                logger.warning("Error borrando archivos de Storage para %s: %s", user_id, exc)

        if len(items) < limit:
            break
        offset += limit

    logger.info("Storage: %d objeto(s) eliminados para usuario %s", deleted_total, user_id)


def purge_complete_user(user_id: str):
    """
    Elimina un usuario de Auth0 y toda su infraestructura en Supabase,
    incluyendo los archivos físicos del bucket 'documentos'.

    Orden:
    1. Borrar archivos de Storage (antes de la cascada SQL para evitar huérfanos)
    2. Borrar filas en Supabase (cascada: collections → documents → chunk_embeddings)
    3. Borrar usuario de Auth0 (al final para poder reintentar si la DB falla)
    """
    try:
        get_token = GetToken(
            domain=settings.auth0_domain,
            client_id=settings.auth0_m2m_client_id,
            client_secret=settings.auth0_m2m_client_secret,
        )
        token = get_token.client_credentials(f"https://{settings.auth0_domain}/api/v2/")
        mgmt_api_token = token["access_token"]

        auth0 = Auth0(tenant_domain=settings.auth0_domain, token=mgmt_api_token)
        supabase: Client = create_client(
            settings.supabase_url, settings.supabase_service_key
        )
    except Exception as e:
        logger.error("Error inicializando clientes para purga de %s: %s", user_id, e)
        raise

    try:
        # 1. Borrar archivos físicos de Storage antes de la cascada SQL.
        _delete_user_storage(supabase, user_id)

        # 2. Borrar filas en Supabase (cascada: collections → documents → chunk_embeddings).
        supabase.table("collections").delete().eq("user_id", user_id).execute()

        # 3. Borrar de Auth0 al final para poder reintentar si la DB falla.
        auth0.users.delete(user_id)

        logger.info("Purga completa exitosa para el usuario: %s", user_id)
        return {"status": "success", "user_id": user_id}

    except Exception as e:
        logger.error("Error durante la purga del usuario %s:", user_id)
        traceback.print_exc()
        raise
