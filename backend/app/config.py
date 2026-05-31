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
    google_application_credentials: str = ""
    cloud_tasks_queue: str = ""
    cloud_tasks_location: str = ""

    # HU-13: Upload resilience — configurable via .env, sensible defaults apply
    max_upload_retries: int = 3
    upload_retry_delay_seconds: float = 1.0

    # OCR (Cloud Vision): DPI base y elevado para páginas complejas / reintento
    ocr_dpi_default: int = 300
    ocr_dpi_complex: int = 400
    ocr_language_hints: str = "es,en"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
