import traceback
from auth0.authentication import GetToken
from auth0.management import Auth0
from supabase import create_client, Client
from app.config import settings

def purge_complete_user(user_id: str):
    # Obtener token M2M
    get_token = GetToken(
        domain=settings.auth0_domain,
        client_id=settings.auth0_m2m_client_id,
        client_secret=settings.auth0_m2m_client_secret
    )
    token = get_token.client_credentials(f'https://{settings.auth0_domain}/api/v2/')
    mgmt_api_token = token['access_token']

    # Cliente Auth0 Management
    auth0 = Auth0(tenant_domain=settings.auth0_domain, token=mgmt_api_token)

    # Cliente Supabase
    supabase: Client = create_client(
        settings.supabase_url,
        settings.supabase_service_key
    )

    try:
        auth0.users.delete(user_id)
        supabase.table("collections").delete().eq("user_id", user_id).execute()
        return {"status": "success"}
    except Exception as e:
        traceback.print_exc()
        raise e