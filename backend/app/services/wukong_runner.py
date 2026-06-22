"""

Esta es la función que se invoca cuando la usuaria presiona "Generar Grafo".
Encadena todo el procesamiento:

    Pipeline 1 (extracción de texto):
        - TXT      → lectura directa
        - PDF dig. → PyMuPDF
        - PDF esc. → OCR (PDT10-116, pendiente)

    Pipeline 2 (Wukong):
        - Arma carpeta temporal con todos los .txt + data_model.json
        - Corre Wukong como subprocess → genera .qm
        - Opcional: con WUKONG_ARTIFACTS_DIR copia el workdir a disco (pruebas locales)

    Pipeline 3:
        - Sube el .qm a Supabase Storage (mismo primer path segment que documentos: ``|``→``_``).
        - Embeddings de chunks en pgvector.
        - TODO PDT10-121: carga opcional en MillenniumDB.

Toda la función está pensada para correr en background (FastAPI
BackgroundTasks o Cloud Tasks). NO debe propagar excepciones — cualquier
fallo queda registrado en la propia colección o en cada documento.
"""

import copy # para clonar el data model antes de mutarlo
import json # para leer el archivo de configuración de Wukong
import logging # para registrar errores
import os # para manejar el entorno
import shutil # para copiar el workdir de Wukong a disco
import subprocess # para ejecutar Wukong
import sys # para ejecutar Wukong
import tempfile # para crear un directorio temporal para el workdir de Wukong
import time # para el polling del subprocess de Wukong
from datetime import datetime, timezone # para manejar fechas y horas en UTC
from pathlib import Path # para manejar rutas de archivos   

from app.config import (
    WUKONG_DATA_MODEL_LANGUAGES,
    language_to_ocr_hints,
    settings,
)
# importamos el cliente de Supabase para interactuar con la base de datos
from app.services import supabase_client, graph_transformer
from app.services.ai_models import ModelUnavailableError, OcrServiceUnavailableError
from app.services.qm_storage import export_qm_to_supabase
from app.services.text_extraction import (
    process_pdf_document,
    process_txt_document,
)

logger = logging.getLogger(__name__) # para registrar errores


class ProcessingCancelled(Exception):
    """El cliente pidió cancelar; el estado en DB ya es ``cancelled``."""


def _check_cancelled(collection_id: str) -> None:
    row = supabase_client.get_collection_by_id(collection_id)
    if row is None:
        raise ProcessingCancelled()
    if row.get("processing_status") == "cancelled":
        raise ProcessingCancelled()


def _skip_if_user_cancelled(collection_id: str, where: str) -> bool:
    """Si ya está ``cancelled`` o borrada, no sobrescribir estado. Devuelve True si hay que salir."""
    row = supabase_client.get_collection_by_id(collection_id)
    if row is None:
        logger.info(
            "Omitiendo %s: colección %s ya no existe.", where, collection_id
        )
        return True
    if row.get("processing_status") == "cancelled":
        logger.info(
            "Omitiendo %s: colección %s cancelada por la usuaria.", where, collection_id
        )
        return True
    return False


BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent 
# para manejar rutas de archivos del backend (identifica la raiz de la rita de éste archivo)la raíz)


def _wukong_python_executable() -> str:
    """Intérprete para ``python -m wukong_engine`` (wukong-engine exige Python >= 3.13).

    Si el proceso FastAPI corre con 3.12 por error, Wukong seguía usando ese binario y fallaba
    con ``No module named wukong_engine``. Preferimos ``.venv/bin/python3.13`` cuando exista.
    """
    if sys.version_info >= (3, 13):
        return sys.executable
    v313 = BACKEND_ROOT / ".venv" / "bin" / "python3.13"
    if v313.is_file():
        logger.info(
            "Wukong: el servidor usa Python %s; ejecutando Wukong con %s",
            sys.version.split()[0],
            v313,
        )
        return str(v313)
    return sys.executable

# Debe coincidir con parameters.included_documents en default_data_model_*.json
WUKONG_DOCUMENT_SET = "preview"

_DATA_MODEL_DIR = Path(__file__).resolve().parent
WUKONG_DEFAULT_CONFIG = (
    Path(__file__).resolve().parent.parent.parent
    / "wukong-engine"
    / "config"
    / "default.toml"
)


def _load_data_model(lang: str) -> dict:
    """Carga el data_model por defecto para el idioma indicado.

    Busca ``default_data_model_<lang>.json``. Si no existe (idioma sin JSON propio)
    cae al español como idioma base de la aplicación.
    """
    candidates = [
        _DATA_MODEL_DIR / f"default_data_model_{lang}.json",
        _DATA_MODEL_DIR / "default_data_model_es.json",
        _DATA_MODEL_DIR / "default_data_model.json",  # compatibilidad con nombre legacy
    ]
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                logger.exception("Error leyendo data model desde %s", path)
    logger.error("No se encontró ningún default_data_model para lang=%s", lang)
    return {"parameters": {}, "entities": {}, "relations": {}}


# Cache en memoria: un dict por código de idioma soportado
_DATA_MODEL_CACHE: dict[str, dict] = {
    lang: _load_data_model(lang) for lang in WUKONG_DATA_MODEL_LANGUAGES
}
# Fallback legacy para compatibilidad con código que usa _DEFAULT_DATA_MODEL directamente
_DEFAULT_DATA_MODEL: dict = _DATA_MODEL_CACHE.get("es", {})


def process_collection(collection_id: str, custom_data_model: dict | None = None) -> None:
    """
    Punto de entrada del procesamiento. Orquesta los 3 pipelines y
    actualiza el estado de la colección y de cada documento.

    Estados de colección que pueden quedar al terminar:
        - graph_ready    → todos los docs OK, grafo listo
        - partial_error  → algunos docs fallaron, grafo se generó igual
        - error          → falla total: ningún doc o Wukong se cayó
        - cancelled      → la usuaria solicitó detener (cooperativo; ver POST /process/cancel)
    """
    try:
        collection = supabase_client.get_collection_by_id(collection_id)
        if collection is None:
            logger.error("Colección %s no encontrada", collection_id)
            return

        if collection.get("processing_status") == "cancelled":
            logger.info(
                "process_collection: colección %s ya en estado cancelled; tarea obsoleta o duplicada.",
                collection_id,
            )
            return

        documents = supabase_client.get_documents_by_collection(collection_id)
        if not documents:
            if _skip_if_user_cancelled(collection_id, "marcar error sin documentos"):
                return
            _mark_collection_error(
                collection_id,
                "La colección no tiene documentos para procesar.",
            )
            return

        collection_language = collection.get("language") or "es"
        ocr_hints = language_to_ocr_hints(collection_language)
        logger.info(
            "Colección %s: idioma='%s', OCR hints=%s",
            collection_id,
            collection_language,
            ocr_hints,
        )

        try:
            _check_cancelled(collection_id)
            n_extracted, n_errored, failed_doc_labels = _extract_texts(
                documents, collection_id, language_hints=ocr_hints
            )
        except ProcessingCancelled:
            logger.info("Extracción interrumpida por cancelación: %s", collection_id)
            return

        if n_extracted == 0:
            if _skip_if_user_cancelled(collection_id, "marcar error sin extracción"):
                return
            failed_part = (
                f" Archivos: {', '.join(failed_doc_labels)}."
                if failed_doc_labels
                else ""
            )
            _mark_collection_error(
                collection_id,
                f"Ningún documento pudo extraerse ({n_errored} error(es)). "
                f"Sube otros archivos (TXT o PDF con texto seleccionable) e intenta de nuevo."
                f"{failed_part}",
            )
            return

        if n_errored > 0:
            logger.info(
                "Colección %s: %d documento(s) no se extrajeron; "
                "continuando grafo con %d documento(s) válidos",
                collection_id,
                n_errored,
                n_extracted,
            )

        if _skip_if_user_cancelled(collection_id, "iniciar grafo tras extracción"):
            return
        logger.info(
            "Colección %s: extracción completada (%d doc(s)); iniciando Wukong",
            collection_id,
            n_extracted,
        )
        process_graph_collection(
            collection_id,
            custom_data_model=custom_data_model,
            final_status_on_success="partial_error" if n_errored > 0 else "graph_ready",
        )
        return

    except ProcessingCancelled:
        logger.info("Procesamiento cancelado (colección %s)", collection_id)
        return
    except OcrServiceUnavailableError:
        # Se cayó el SERVICIO de OCR (Cloud Vision), no un documento puntual.
        logger.error(
            "Servicio de OCR (Cloud Vision) no disponible procesando colección %s",
            collection_id,
        )
        if not _skip_if_user_cancelled(collection_id, "servicio de OCR caído"):
            _mark_collection_error(
                collection_id,
                "Hubo un fallo general del servicio de OCR (Google Cloud Vision). "
                "Por favor, contacta a soporte.",
            )
        return
    except Exception as exc:
        logger.exception("Error inesperado procesando colección %s", collection_id)
        if not _skip_if_user_cancelled(collection_id, "error inesperado"):
            _mark_collection_error(
                collection_id,
                _friendly_error_message(exc),
            )
        
    
def _model_failure_message(modelo: str) -> str:
    """Mensaje simple y uniforme cuando se cae un modelo de IA al generar el grafo.

    Se usa tanto si se cae el modelo de Wukong (LLM/OpenAI) como el de
    embeddings. El detalle técnico queda en los logs; al usuario solo se le
    muestra un fallo general y se le pide contactar a soporte.
    """
    return (
        f"Hubo un fallo general del modelo de {modelo}. "
        "Por favor, contacta a soporte."
    )


def process_graph_collection(collection_id: str, custom_data_model: dict | None = None,
    final_status_on_success: str = "graph_ready",) -> None:
    try:
        collection = supabase_client.get_collection_by_id(collection_id)
        if collection is None:
            logger.error("Colección %s no encontrada", collection_id)
            return

        rows = supabase_client.get_document_texts_by_collection(collection_id)
        if not rows:
            _mark_collection_error(
                collection_id,
                "No hay textos extraídos para construir el grafo.",
            )
            return
        
        try:
            _check_cancelled(collection_id)
        except ProcessingCancelled:
            logger.info("Cancelación antes de Wukong: %s", collection_id)
            return

        supabase_client.update_collection_processing_status(
            collection_id, "processing_graph"
        )
        supabase_client.update_collection_progress(
            collection_id=collection_id,
            graph_progress_total=1,
            graph_progress_processed=0,
            graph_failed_documents=[],
        )

        collection_language = collection.get("language") or "es"
        with tempfile.TemporaryDirectory(prefix=f"wukong-{collection_id}-") as tmp:
            workdir = Path(tmp)
            _build_wukong_workdir(
                workdir,
                collection_id,
                custom_data_model=custom_data_model,
                collection_language=collection_language,
            )

            try:
                _check_cancelled(collection_id)
            except ProcessingCancelled:
                logger.info("Cancelación antes de lanzar Wukong: %s", collection_id)
                return

            wukong_error = _run_wukong(workdir, collection_id=collection_id) #con al carpeta temporal lista, corro wukong como subprocess.
            _persist_wukong_artifacts(workdir, collection_id, wukong_ok=wukong_error is None) #si wukong terminó OK, copiamos el workdir a disco para inspección local (.qm, textos, etc.).
            
            if wukong_error is None:
                supabase_client.update_collection_progress(
                    collection_id=collection_id,
                    graph_progress_processed=1,
                )
            
            if wukong_error is not None:
                if _skip_if_user_cancelled(collection_id, "error de Wukong tras cancelación"):
                    return
                supabase_client.update_collection_progress(
                    collection_id=collection_id,
                    graph_failed_documents=[
                        {
                            "filename": "Wukong",
                            "reason": wukong_error,
                        }
                    ],
                )
                _mark_collection_error(collection_id, wukong_error)
                return

            try:
                _check_cancelled(collection_id)
            except ProcessingCancelled:
                logger.info(
                    "Cancelación tras Wukong OK (omitimos embeddings/final): %s",
                    collection_id,
                )
                return

            try:
                logger.info(
                    "Wukong OK: iniciando export .qm a Supabase (colección %s, workdir=%s)",
                    collection_id,
                    workdir,
                )
                qm_storage = export_qm_to_supabase(workdir, collection_id)
                if qm_storage:
                    logger.info(
                        "Archivo .qm almacenado en Supabase: %s",
                        qm_storage,
                    )
                else:
                    logger.warning(
                        "No se encontró .qm bajo exports/ para colección %s.",
                        collection_id,
                    )
            except Exception:
                logger.exception(
                    "Error exportando .qm a Supabase para colección %s — continúa pipeline.",
                    collection_id,
                )

            # Pipeline 3a: Generar y guardar embeddings de chunks en Supabase pgvector.
            # Falla silenciosa: un error aquí no bloquea el grafo ya generado.
            try:
                n_chunks = _generate_and_store_embeddings(workdir, collection_id)
                logger.info("Embeddings generados y guardados: %d chunks (colección %s)", n_chunks, collection_id)
            except ModelUnavailableError:
                # Se cayó el modelo de embeddings: se reporta como fallo de
                # modelo (manejado abajo). Otros errores (red, BDD, archivos) no.
                raise
            except Exception:
                logger.exception(
                    "Error generando embeddings para colección %s — grafo sigue disponible.",
                    collection_id,
                )

            # TODO PDT10-121: cargar el .qm de workdir/exports/ en MillenniumDB.
            # Bloqueado hasta confirmar el método con Alejandro
            # (mdb import vs queries vía driver vs endpoint del IMFD).

        if _skip_if_user_cancelled(collection_id, "marcar graph_ready"):
            return

        final_status, completion_message = _resolve_graph_completion(
            collection_id,
            prefer_partial=(final_status_on_success == "partial_error"),
        )
        supabase_client.update_collection_processing_status(
            collection_id,
            final_status,
            error_message=completion_message,
            processed_at=_now_iso(),
        )
        graph_transformer.invalidate_facets_cache(collection_id)
    except ProcessingCancelled:
        logger.info("Construcción de grafo cancelada colección %s", collection_id)
        return

    except ModelUnavailableError as exc:
        # Se cayó un modelo de IA (Wukong/LLM o embeddings): mensaje simple
        # "fallo general del modelo X, contactar a soporte".
        logger.error(
            "Modelo de IA caído (%s) construyendo grafo %s",
            exc.model_label,
            collection_id,
        )
        if not _skip_if_user_cancelled(collection_id, "fallo de modelo de IA"):
            _mark_collection_error(
                collection_id,
                _model_failure_message(exc.model_label),
            )
        return

    except Exception as exc:
        logger.exception(
            "Error inesperado construyendo grafo %s",
            collection_id,
        )

        if not _skip_if_user_cancelled(
            collection_id,
            "error inesperado grafo",
        ):
            _mark_collection_error(
                collection_id,
                _friendly_error_message(exc),
            )
    return



def _doc_display_name(doc: dict) -> str:
    """Nombre legible para mensajes (filename de Storage / UI; si no, id)."""
    fn = doc.get("filename")
    if fn:
        return str(fn)
    return str(doc.get("id", "desconocido"))


def _extract_texts(
    documents: list[dict],
    collection_id: str | None = None,
    language_hints: list[str] | None = None,
) -> tuple[int, int, list[str]]:
    """
    Pipeline 1. Itera los documentos y extrae el texto de cada uno
    según su tipo. Devuelve (n_extracted_ok, n_errored, failed_display_names).

    Un fallo en un documento NO interrumpe el resto: queda con
    status='error' y se sigue con el siguiente. PDFs escaneados usan
    Cloud Vision OCR con DPI adaptativo.
    ``language_hints`` son códigos BCP-47 que se pasan a Cloud Vision cuando
    el documento es un PDF escaneado. Si es None, Vision elige el idioma.

    Si ``collection_id`` está definido, se consulta cancelación entre documentos.
    """
    n_extracted = 0
    n_errored = 0
    failed_doc_labels: list[str] = []
    total_docs = len(documents)

    existing_text_document_ids: set[str] = set()
    if collection_id is not None:
        existing_text_rows = supabase_client.get_document_texts_by_collection(
            collection_id,
        )
        existing_text_document_ids = {
            str(row["document_id"])
            for row in existing_text_rows
        }

        supabase_client.update_collection_progress(
            collection_id=collection_id,
            text_progress_total=total_docs,
            text_progress_processed=len(existing_text_document_ids),
            text_failed_documents=[],
        )

    n_extracted = len(existing_text_document_ids)

    for doc in documents:
        if collection_id is not None:
            _check_cancelled(collection_id)

        doc_id = str(doc["id"])
        if doc_id in existing_text_document_ids:
            continue

        try:
            if doc["file_type"] == "txt":
                result = process_txt_document(
                    document_id=doc["id"],
                    user_id=doc["user_id"],
                    collection_id=doc["collection_id"],
                    storage_path=doc["storage_path"],
                    language_hints=language_hints,
                )
            elif doc["file_type"] == "pdf":
                result = process_pdf_document(
                    document_id=doc["id"],
                    user_id=doc["user_id"],
                    collection_id=doc["collection_id"],
                    storage_path=doc["storage_path"],
                    language_hints=language_hints,
                )
            else:
                raise ValueError(f"file_type desconocido: {doc['file_type']!r}")

            if result.get("status") == "ok":
                n_extracted += 1
                if collection_id is not None:
                    supabase_client.update_collection_progress(
                        collection_id=collection_id,
                        text_progress_processed=n_extracted,
                    )
            else:
                n_errored += 1
                failed_doc_labels.append(_doc_display_name(doc))
                if collection_id is not None:
                    supabase_client.update_collection_progress(
                        collection_id=collection_id,
                        text_failed_documents=[
                            {
                                "filename": label,
                                "reason": "Error de extracción",
                            }
                            for label in failed_doc_labels
                        ],
                    )

        except OcrServiceUnavailableError:
            # El servicio de OCR se cayó: no es culpa de este documento. Se
            # propaga para avisar a nivel de colección, sin marcar el doc como
            # ilegible ni continuar con el resto (todos fallarían igual).
            raise
        except Exception as exc:
            logger.exception("Falló extracción del documento %s", doc["id"])
            if collection_id is not None and _skip_if_user_cancelled(
                collection_id,
                "actualizar error de documento tras cancelación",
            ):
                return n_extracted, n_errored, failed_doc_labels
            supabase_client.update_document_status(
                document_id=doc["id"],
                user_id=doc["user_id"],
                status="error",
                error_message=f"{type(exc).__name__}: {exc}",
            )
            n_errored += 1
            failed_doc_labels.append(_doc_display_name(doc))
            if collection_id is not None:
                supabase_client.update_collection_progress(
                    collection_id=collection_id,
                    text_progress_processed=n_extracted,
                    text_failed_documents=[
                        {
                            "filename": label,
                            "reason": "Error de extracción",
                        }
                        for label in failed_doc_labels
                    ],
                )

    return n_extracted, n_errored, failed_doc_labels


def _build_wukong_workdir(
    workdir: Path,
    collection_id: str,
    *,
    custom_data_model: dict | None = None,
    collection_language: str | None = None,
) -> int:
    """
    Arma la estructura que espera Wukong:

        workdir/
        ├── docs/text/<WUKONG_DOCUMENT_SET>/*.txt
        └── data_model.json

    Si se provee ``custom_data_model``, se usa ese dict en lugar del default.
    En ambos casos se sobreescribe ``parameters.included_documents`` para que
    coincida con WUKONG_DOCUMENT_SET y evitar desincronización con el workdir.

    ``collection_language`` es un código BCP-47 (ej. 'en', 'es').
    Cuando se usa el data_model por defecto y no hay ``custom_data_model``,
    se parchean ``input_language`` y ``output_language`` con el idioma de la
    colección para que Wukong procese el texto en el idioma correcto.
    """
    text_dir = workdir / "docs" / "text" / WUKONG_DOCUMENT_SET
    text_dir.mkdir(parents=True, exist_ok=True)

    rows = supabase_client.get_document_texts_by_collection(collection_id)

    n_files = 0
    for row in rows:
        file_path = text_dir / f"{row['document_id']}.txt"
        file_path.write_text(row["extracted_text"], encoding="utf-8")
        n_files += 1

    if custom_data_model is not None:
        # El usuario pasó un data_model propio: respetarlo íntegro.
        data_model = copy.deepcopy(custom_data_model)
    else:
        # Elegir el JSON por defecto correcto según el idioma de la colección.
        # Si el idioma no tiene JSON propio, se usa el español como fallback.
        lang_key = collection_language or "es"
        default = _DATA_MODEL_CACHE.get(lang_key) or _DATA_MODEL_CACHE.get("es") or _DEFAULT_DATA_MODEL
        data_model = copy.deepcopy(default)
        logger.info(
            "Wukong data_model: usando esquema '%s' para colección con idioma '%s'",
            lang_key if lang_key in _DATA_MODEL_CACHE else "es (fallback)",
            collection_language,
        )

    # Garantiza que Wukong lea desde la misma carpeta que acabamos de poblar.
    data_model.setdefault("parameters", {})["included_documents"] = [WUKONG_DOCUMENT_SET]

    collection = supabase_client.get_collection_by_id(collection_id)
    included_entities = (
        collection.get("included_entities")
        if collection is not None
        else None
    )

    if included_entities:
        data_model["parameters"]["included_entities"] = included_entities
        data_model["entities"] = {
            name: entity
            for name, entity in data_model.get("entities", {}).items()
            if name in included_entities
        }

    (workdir / "data_model.json").write_text(
        json.dumps(data_model, indent=2),
        encoding="utf-8",
    )

    return n_files


def _artifacts_dest_root() -> Path | None:
    """
    Si WUKONG_ARTIFACTS_DIR está definida, devuelve la ruta base donde copiar
    el workdir de Wukong (relativa a backend/ si no es absoluta). Si no, None.

    ACa se crea el directorio de artefactos de Wukong (vamos a ver la carpeta local que crea wukong en el workdir temporal), 
    si no existe, se crea.
    """
    raw = (
        os.environ.get("WUKONG_ARTIFACTS_DIR") or settings.wukong_artifacts_dir or ""
    ).strip()
    if not raw:
        return None
    p = Path(raw)
    return p if p.is_absolute() else BACKEND_ROOT / p


def _persist_wukong_artifacts(
    workdir: Path, collection_id: str, *, wukong_ok: bool
) -> None:
    """Copia el workdir temporal a disco para inspección local (.qm, textos, etc.)."""
    root = _artifacts_dest_root()
    if root is None:
        return
    slug = "ok" if wukong_ok else "fail"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = root / f"{collection_id}_{stamp}_{slug}"
    try:
        root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(workdir, dest, dirs_exist_ok=False)
        logger.info("Workdir Wukong guardado en %s", dest)
    except Exception:
        logger.exception(
            "No se pudo copiar el workdir de Wukong a %s; el procesamiento sigue igual.",
            dest,
        )


# Firmas en la salida de Wukong que indican que se cayó el modelo (LLM/OpenAI),
# vs. otros errores (config, datos, subproceso). Se comparan en minúsculas.
_WUKONG_MODEL_FAILURE_SIGNATURES = (
    "model_not_found",
    "does not have access to model",
    "the model `",
    "openai",
    "rate limit",
    "ratelimiterror",
    "insufficient_quota",
    "authenticationerror",
    "incorrect api key",
    "invalid api key",
    "apiconnectionerror",
    "apitimeouterror",
    "service unavailable",
)


def _looks_like_model_failure(output: str) -> bool:
    """True si la salida de Wukong parece un fallo del modelo de IA (LLM/OpenAI).

    Ej.: ``model_not_found`` / "does not have access to model `gpt-4.1-mini`".
    """
    low = output.lower()
    return any(sig in low for sig in _WUKONG_MODEL_FAILURE_SIGNATURES)


class _FatalLlmError(Exception):
    """Señal interna: se detectó un error irrecuperable del LLM en la salida de Wukong."""


def _tail_wukong_log(
    log_path: Path, read_pos: int, collection_id: str | None,
) -> int:
    """Lee líneas nuevas del log de Wukong, las logea, y detecta errores fatales.

    Devuelve la nueva posición de lectura.
    Lanza ``_FatalLlmError`` si se detecta un error irrecuperable del LLM.
    """
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(read_pos)
            new_content = f.read()
            new_pos = f.tell()
    except FileNotFoundError:
        return read_pos

    if not new_content:
        return read_pos

    for line in new_content.splitlines():
        if line.strip():
            logger.info("Wukong [%s]: %s", collection_id, line.rstrip())

    if _looks_like_model_failure(new_content):
        raise _FatalLlmError()

    return new_pos


def _run_wukong(workdir: Path, collection_id: str | None = None, timeout_seconds: int = 3600) -> str | None:
    """
    Pipeline 2. Ejecuta Wukong sobre la carpeta de trabajo.

    Devuelve None si Wukong terminó OK, o un mensaje de error si falló.
    Lanza ``ModelUnavailableError`` si la salida indica que se cayó el modelo
    de IA que usa Wukong (LLM/OpenAI), para reportarlo como fallo de modelo.
    """
    if not WUKONG_DEFAULT_CONFIG.is_file():
        return f"No existe la config de Wukong: {WUKONG_DEFAULT_CONFIG}"
    # La salida (stdout+stderr) se captura a un archivo para poder inspeccionarla
    # y distinguir un fallo del modelo de otros errores, sin riesgo de bloquear
    # el subproceso por un pipe lleno (no lo drenamos durante el polling).
    log_path = workdir / "wukong_output.log"
    try:
        with open(log_path, "w", encoding="utf-8") as log_file:
            process = subprocess.Popen(
                [
                    _wukong_python_executable(),
                    "-m",
                    "wukong_engine",
                    str(workdir),
                    "--config",
                    str(WUKONG_DEFAULT_CONFIG),
                ],
                stdout=log_file,
                stderr=subprocess.STDOUT,
            )

            started_at = datetime.now(timezone.utc)

            log_read_pos = 0

            while process.poll() is None:
                if collection_id is not None and _skip_if_user_cancelled(collection_id, "detener subprocess Wukong"):
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise ProcessingCancelled()

                elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
                if elapsed > timeout_seconds:
                    process.kill()
                    process.wait()
                    return f"Wukong superó el timeout de {timeout_seconds}s."

                try:
                    log_read_pos = _tail_wukong_log(
                        log_path, log_read_pos, collection_id,
                    )
                except _FatalLlmError:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise ModelUnavailableError("construcción del grafo")

                time.sleep(1)

        if process.returncode != 0:
            output = ""
            try:
                output = log_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass
            # El detalle completo va a los logs para depuración.
            if output.strip():
                logger.error(
                    "Salida de Wukong (exit %s):\n%s",
                    process.returncode,
                    output[-4000:],
                )
            if _looks_like_model_failure(output):
                raise ModelUnavailableError("construcción del grafo")
            return f"Wukong falló (exit {process.returncode})"
        return None
    except subprocess.TimeoutExpired:
        return f"Wukong superó el timeout de {timeout_seconds}s."
    except FileNotFoundError:
        return (
            "wukong_engine no está instalado en el entorno. "
            "Correr: pip install -e ./wukong-engine"
        )


def _resolve_graph_completion(
    collection_id: str,
    *,
    prefer_partial: bool = False,
) -> tuple[str, str]:
    """Estado y mensaje final tras construir el grafo. Mensaje vacío limpia el anterior."""
    row = supabase_client.get_collection_by_id(collection_id) or {}
    text_failed = row.get("text_failed_documents") or []
    n_ok = int(row.get("text_progress_processed") or 0)

    if text_failed:
        names = ", ".join(str(d.get("filename", "?")) for d in text_failed)
        return (
            "partial_error",
            (
                f"Grafo generado exitosamente con {n_ok} documento(s). "
                f"{len(text_failed)} documento(s) no se incluyeron por fallo "
                f"en extracción: {names}."
            ),
        )
    if prefer_partial:
        return ("partial_error", "")
    return ("graph_ready", "")


def _mark_collection_error(collection_id: str, message: str) -> None:
    row = supabase_client.get_collection_by_id(collection_id)
    if row is None:
        logger.info(
            "Colección %s ya no existe; omitimos marcar error.", collection_id
        )
        return
    if row.get("processing_status") == "cancelled":
        logger.info(
            "Colección %s cancelada; omitimos marcar error.", collection_id
        )
        return
    supabase_client.update_collection_processing_status(
        collection_id,
        "error",
        error_message=message,
        processed_at=_now_iso(),
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Nombres de excepciones (httpx / h2 / httpcore) que indican que la conexión a
# Supabase se cortó o agotó. Se comparan por nombre para no acoplar este módulo
# a httpx ni a su jerarquía de clases.
_CONNECTION_ERROR_NAMES = {
    "RemoteProtocolError",
    "ConnectionTerminated",
    "ConnectError",
    "ConnectTimeout",
    "ReadTimeout",
    "ReadError",
    "WriteError",
    "PoolTimeout",
    "ConnectionResetError",
}


def _friendly_error_message(exc: Exception) -> str:
    """Mensaje legible para la usuaria.

    Traduce los errores de conexión a la base de datos (cortes/intermitencias
    de HTTP/2 contra Supabase) a un texto entendible. El detalle técnico ya
    queda registrado vía ``logger.exception`` en el llamador.
    """
    names = {type(exc).__name__}
    if exc.__cause__ is not None:
        names.add(type(exc.__cause__).__name__)
    if exc.__context__ is not None:
        names.add(type(exc.__context__).__name__)

    if names & _CONNECTION_ERROR_NAMES:
        return (
            "La base de datos dejó de responder o está presentando "
            "intermitencias. Vuelve a intentarlo en unos minutos."
        )
    return f"Error inesperado: {type(exc).__name__}: {exc}"


# ── Pipeline 3a: Embeddings ────────────────────────────────────────────────────

_SUBCHUNK_MAX_WORDS = 100
_SUBCHUNK_OVERLAP = 15


def _split_into_subchunks(
    text: str,
    max_words: int = _SUBCHUNK_MAX_WORDS,
    overlap: int = _SUBCHUNK_OVERLAP,
) -> list[str]:
    """Divide un texto en sub-chunks de tamaño máximo `max_words` palabras con solapamiento.

    Si el texto cabe en un solo sub-chunk lo devuelve sin dividir.
    El solapamiento evita cortar frases relevantes en los bordes.
    """
    words = text.split()
    if len(words) <= max_words:
        return [text]
    step = max(1, max_words - overlap)
    subchunks: list[str] = []
    i = 0
    while i < len(words):
        subchunks.append(" ".join(words[i : i + max_words]))
        i += step
    return subchunks


def _build_entity_types_map(results_dir: Path) -> dict[str, list[str]]:
    """Construye {chunk_id: [EntityType, ...]} desde la relación ExtractedFrom.

    Si el archivo no existe (p.ej. no se extrajo ninguna entidad), devuelve {}.
    """
    path = results_dir / "relations" / "ExtractedFrom.json"
    if not path.exists():
        return {}
    relations = json.loads(path.read_text(encoding="utf-8"))
    chunk_types: dict[str, set[str]] = {}
    for rel in relations:
        target = rel.get("_TargetId", "")
        if not target.startswith("Chunk_"):
            continue
        # "_OriginId" tiene formato "Persona_1", "Organizacion_2", etc.
        entity_type = rel.get("_OriginId", "").rsplit("_", 1)[0]
        chunk_types.setdefault(target, set()).add(entity_type)
    return {k: sorted(v) for k, v in chunk_types.items()}


def _generate_and_store_embeddings(workdir: Path, collection_id: str) -> int:
    """Lee los artefactos de Wukong, genera embeddings y los guarda en Supabase.

    Devuelve el número de chunks procesados.
    Lanza excepción si algún paso falla (el llamador la captura con falla silenciosa).
    """
    results_dir = workdir / "results"

    # 1. Mapeo Document_N → UUID del documento en Supabase
    doc_entities_path = results_dir / "entities" / "Document.json"
    if not doc_entities_path.exists():
        logger.warning("Document.json no encontrado en %s — omitiendo embeddings.", results_dir)
        return 0
    doc_entities = json.loads(doc_entities_path.read_text(encoding="utf-8"))
    # "name" es el stem del archivo (= document_id UUID en Supabase)
    doc_obj_to_uuid: dict[str, str] = {e["_ObjectId"]: e["name"] for e in doc_entities}

    # 2. Chunks con su texto
    chunk_path = results_dir / "entities" / "Chunk.json"
    if not chunk_path.exists():
        logger.warning("Chunk.json no encontrado en %s — omitiendo embeddings.", results_dir)
        return 0
    chunk_entities = json.loads(chunk_path.read_text(encoding="utf-8"))
    chunk_text_map: dict[str, str] = {e["_ObjectId"]: e["text"] for e in chunk_entities}

    # 3. Relación Chunk → Document (posición dentro del documento)
    chunk_of_path = results_dir / "relations" / "ChunkOf.json"
    if not chunk_of_path.exists():
        logger.warning("ChunkOf.json no encontrado en %s — omitiendo embeddings.", results_dir)
        return 0
    chunk_of = json.loads(chunk_of_path.read_text(encoding="utf-8"))
    if chunk_of and "chunk_number" not in chunk_of[0]:
        raise KeyError(
            f"ChunkOf.json no tiene el campo 'chunk_number' (campos presentes: {list(chunk_of[0].keys())}). "
            "¿Cambió el schema de wukong-engine?"
        )
    chunk_to_doc_obj: dict[str, str] = {r["_OriginId"]: r["_TargetId"] for r in chunk_of}
    chunk_index_map: dict[str, int] = {r["_OriginId"]: r["chunk_number"] for r in chunk_of}

    # 4. Tipos de entidad por chunk (para filtros)
    entity_types_map = _build_entity_types_map(results_dir)

    # 5. Nombre de archivo original (para el campo "titulo" en resultados)
    docs = supabase_client.get_documents_by_collection(collection_id)
    doc_filename_map: dict[str, str] = {d["id"]: d["filename"] for d in docs}

    # 6. Construir registros — cada chunk Wukong se divide en sub-chunks de ~100 palabras
    # para mejorar la calidad del embedding (el modelo trunca a 128 tokens ≈ 100 palabras).
    # Los sub-chunks heredan el chunk_id del padre para mantener el vínculo con el grafo.
    records: list[dict] = []
    for chunk_id, chunk_text in chunk_text_map.items():
        doc_obj_id = chunk_to_doc_obj.get(chunk_id)
        if not doc_obj_id:
            continue
        doc_uuid = doc_obj_to_uuid.get(doc_obj_id)
        if not doc_uuid:
            continue
        base_index = chunk_index_map.get(chunk_id, 0)
        entity_types = entity_types_map.get(chunk_id, [])
        for sub_idx, sub_text in enumerate(_split_into_subchunks(chunk_text)):
            records.append({
                "chunk_id": chunk_id,
                "collection_id": collection_id,
                "document_id": doc_uuid,
                "document_name": doc_filename_map.get(doc_uuid, doc_uuid),
                "chunk_index": base_index * 1000 + sub_idx,
                "chunk_text": sub_text,
                "entity_types": entity_types,
            })

    if not records:
        logger.warning("No se encontraron chunks para embeddings en colección %s.", collection_id)
        return 0

    # 7. Generar embeddings en lote
    from app.services.embeddings_service import generate_embeddings_batch
    texts = [r["chunk_text"] for r in records]
    embeddings = generate_embeddings_batch(texts)
    for record, embedding in zip(records, embeddings):
        record["embedding"] = embedding

    # 8. Guardar en Supabase
    supabase_client.save_chunk_embeddings(records)
    return len(records)
