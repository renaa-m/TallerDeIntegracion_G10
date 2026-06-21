import logging
import sys

from pydantic_settings import BaseSettings

_log = logging.getLogger(__name__)

REQUIRED_CREDENTIALS: dict[str, str] = {
    "supabase_url": "Supabase URL",
    "supabase_key": "Supabase Key",
    "supabase_service_key": "Supabase Service Key",
    "auth0_domain": "Auth0 Domain",
    "auth0_api_audience": "Auth0 API Audience",
    "auth0_m2m_client_id": "Auth0 M2M Client ID",
    "auth0_m2m_client_secret": "Auth0 M2M Client Secret",
    "openai_api_key": "OpenAI API Key",
    "gcp_project_id": "GCP Project ID",
    "google_application_credentials": "Google Application Credentials (Cloud Vision)",
    "cloud_tasks_queue": "Cloud Tasks Queue",
    "cloud_tasks_location": "Cloud Tasks Location",
    "cloud_tasks_service_url": "Cloud Tasks Service URL",
    "cloud_tasks_invoker_sa": "Cloud Tasks Invoker Service Account",
}

_PLACEHOLDER_VALUES = frozenset({
    "your-project.supabase.co",
    "https://your-project.supabase.co",
    "your-anon-key",
    "your-service-role-key",
    "your-tenant.auth0.com",
    "https://your-api-identifier",
    "tu_client_id_de_la_app_machine_to_machine",
    "tu_client_secret",
    "your-gcp-project",
    "your-gcp-project-id",
    "imfd-tasks-invoker@your-gcp-project.iam.gserviceaccount.com",
})


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
    # Service account que Cloud Tasks usa para firmar el OIDC token del worker.
    cloud_tasks_invoker_sa: str = ""

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


def validate_required_credentials() -> None:
    """Verifica que todas las credenciales requeridas estén configuradas.

    Si faltan credenciales, loguea un error detallado y termina el proceso.
    En modo DEBUG, solo emite warnings para Cloud Tasks (dev usa hilos locales).
    """
    missing: list[str] = []
    cloud_tasks_fields = {
        "cloud_tasks_queue",
        "cloud_tasks_location",
        "cloud_tasks_service_url",
        "cloud_tasks_invoker_sa",
    }

    for field, label in REQUIRED_CREDENTIALS.items():
        value = getattr(settings, field, "").strip()
        if not value or value in _PLACEHOLDER_VALUES:
            if settings.debug and field in cloud_tasks_fields:
                _log.warning(
                    "Credencial '%s' no configurada — en DEBUG se usarán hilos locales.",
                    label,
                )
                continue
            missing.append(label)

    if missing:
        names = ", ".join(f"'{n}'" for n in missing)
        msg = (
            "\n\n"
            "══════════════════════════════════════════════════════════════\n"
            "  ERROR: Credenciales faltantes o no configuradas\n"
            "══════════════════════════════════════════════════════════════\n"
            f"  Las credenciales de {names} no están disponibles.\n\n"
            "  Por favor, contacte a soporte para obtener las credenciales\n"
            "  necesarias y configúrelas en el archivo .env\n"
            "══════════════════════════════════════════════════════════════\n"
        )
        if "pytest" in sys.modules:
            _log.warning(msg)
        else:
            _log.critical(msg)
            sys.exit(1)


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
