import traceback
from auth0.authentication import GetToken
from auth0.management import Auth0
from supabase import create_client, Client
from app.config import settings

def purge_complete_user(user_id: str):
    """
    Elimina un usuario de Auth0 y toda su infraestructura de datos en Supabase.
    Gracias a ON DELETE CASCADE en SQL, esto elimina:
    Collections -> Documents -> Chunk_Embeddings
    """
    # 1. Preparar Clientes
    try:
        # Obtener token M2M para Auth0 Management API
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
        print(f"Error inicializando clientes: {e}")
        raise e

    try:
        # 2. Eliminar de Supabase primero
        # Al usar service_key, saltamos RLS y ejecutamos la cascada completa.
        # Borramos las colecciones del usuario y por cascada caen documentos y chunks.
        supabase.table("collections").delete().eq("user_id", user_id).execute()
        
        # Opcional: Si manejas archivos físicos en Storage, podrías listar y borrar aquí
        # aunque usualmente los buckets se limpian periódicamente.

        # 3. Eliminar de Auth0
        # Lo hacemos al final para asegurar que si la DB falla, aún tengamos
        # la referencia del usuario para reintentar la limpieza.
        auth0.users.delete(user_id)

        print(f"Purga completa exitosa para el usuario: {user_id}")
        return {"status": "success", "user_id": user_id}

    except Exception as e:
        print(f"Error durante la purga del usuario {user_id}:")
        traceback.print_exc()
        # Aquí podrías implementar una lógica de rollback o log de errores críticos
        raise e