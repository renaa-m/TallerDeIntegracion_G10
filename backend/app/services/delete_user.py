import os
from dotenv import load_dotenv
from auth0.management import Auth0  # <-- Si esto falla, es falta de 'pip install auth0-python'
from supabase import create_client, Client # <-- Si esto falla, es falta de 'pip install supabase'

# Carga las variables del .env
load_dotenv()

def purge_complete_user(user_id: str):
    # Configuración de Clientes
    auth0_domain = os.getenv("AUTH0_DOMAIN")
    auth0_client_id = os.getenv("AUTH0_M2M_CLIENT_ID")
    auth0_client_secret = os.getenv("AUTH0_M2M_CLIENT_SECRET")
    
    # Cliente de Auth0
    auth0 = Auth0(auth0_domain, auth0_client_id, auth0_client_secret)
    
    # Cliente de Supabase
    supabase: Client = create_client(
        os.getenv("SUPABASE_URL"), 
        os.getenv("SUPABASE_SERVICE_KEY")
    )

    try:
        # 1. Borrar en Auth0
        auth0.users.delete(user_id)

        # 2. Borrar en Supabase
        # CASCADE se encarga del resto
        supabase.table("collections").delete().eq("user_id", user_id).execute()
        
        return {"status": "success"}
    except Exception as e:
        print(f"Error: {e}")
        raise e