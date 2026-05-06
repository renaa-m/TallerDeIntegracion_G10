from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "IMFD Document Explorer"
    debug: bool = False

    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_key: str = ""

    auth0_domain: str = ""
    auth0_api_audience: str = ""
    auth0_algorithms: str = "RS256"
    auth0_m2m_client_id: str = ""  # App Machine to Machine en Auth0
    auth0_m2m_client_secret: str = ""  # Secret de la app M2M

    openai_api_key: str = ""

    # Opcional: carpeta bajo backend/ o ruta absoluta (ver wukong_runner).
    wukong_artifacts_dir: str = ""

    millenniumdb_host: str = "localhost"
    millenniumdb_port: int = 1234

    gcp_project_id: str = ""
    cloud_tasks_queue: str = ""
    cloud_tasks_location: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
