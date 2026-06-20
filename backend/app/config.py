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
    # URL pública del servicio Cloud Run (sin slash final). Target del HTTP task.
    cloud_tasks_service_url: str = ""
    cloud_tasks_worker_url: str = ""
    cloud_tasks_invoker_sa: str = ""
    imfd_service_role: str = "all"
    # Dev local: API encola jobs vía HTTP al worker (sin Cloud Tasks). Ej. http://127.0.0.1:8081
    dev_worker_http_url: str = ""
    cloud_tasks_dispatch_deadline_seconds: int = 1800
    # Docs por lote de extracción (todas las colecciones; si N ≤ batch → 1 sola task).
    pipeline_extraction_batch_size: int = 15

    # HU-13: Upload resilience — configurable via .env, sensible defaults apply
    max_upload_retries: int = 3
    upload_retry_delay_seconds: float = 1.0

    # OCR (Cloud Vision): DPI base y elevado para páginas complejas / reintento
    ocr_dpi_default: int = 300
    ocr_dpi_complex: int = 400
    # Hints globales de fallback cuando la colección no tiene idioma configurado.
    # Lista separada por comas de códigos BCP-47 (https://cloud.google.com/vision/docs/languages).
    ocr_language_hints: str = "es,en"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

# ---------------------------------------------------------------------------
# Constantes de idioma — no dependen de las variables de entorno
# ---------------------------------------------------------------------------

# Idiomas soportados como campo en colección → código BCP-47 para Cloud Vision.
OCR_SUPPORTED_LANGUAGES: frozenset[str] = frozenset(
    {"es", "en", "fr", "pt", "de", "it", "zh", "ar", "ja", "ko", "ru"}
)

# Idioma por defecto si no se especifica al crear la colección.
DEFAULT_COLLECTION_LANGUAGE = "es"


# Mapeo de códigos BCP-47 → archivo default_data_model_<code>.json.
# Sólo los idiomas que tienen su propio JSON se incluyen; el resto cae al fallback 'es'.
WUKONG_DATA_MODEL_LANGUAGES: frozenset[str] = frozenset({"es", "en"})

# Mapeo de códigos BCP-47 → nombres de idioma que entiende Wukong en data_model.json.
# Wukong usa nombres completos en inglés ("spanish", "english", …).
WUKONG_LANGUAGE_MAP: dict[str, str] = {
    "es": "spanish",
    "en": "english",
    "fr": "french",
    "pt": "portuguese",
    "de": "german",
    "it": "italian",
    "zh": "chinese",
    "ar": "arabic",
    "ja": "japanese",
    "ko": "korean",
    "ru": "russian",
}


def language_to_wukong_name(language: str | None) -> str:
    """Convierte un código BCP-47 al nombre de idioma que usa Wukong.

    Si el código no está en el mapa, devuelve 'spanish' como fallback
    (comportamiento previo al HU-09).
    """
    if not language:
        return "spanish"
    return WUKONG_LANGUAGE_MAP.get(language, "spanish")


def language_to_ocr_hints(language: str | None) -> list[str]:
    """Convierte el código de idioma de una colección a hints para Cloud Vision.

    - Si el idioma no es reconocido o es None, devuelve los hints globales del .env.
    - Para 'es' agrega 'en' como secundario (documentos en español suelen tener
      términos técnicos en inglés).
    - Para cualquier otro idioma soportado, usa solo ese código.
    """
    if not language or language not in OCR_SUPPORTED_LANGUAGES:
        return [h.strip() for h in settings.ocr_language_hints.split(",") if h.strip()]
    if language == "es":
        return ["es", "en"]
    return [language]
