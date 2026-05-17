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
        - Sube el .qm a Supabase Storage (``{user_id}/{collection_id}/knowledge_graph.qm``).
        - Embeddings de chunks en pgvector.
        - TODO PDT10-121: carga opcional en MillenniumDB.

Toda la función está pensada para correr en background (FastAPI
BackgroundTasks o Cloud Tasks). NO debe propagar excepciones — cualquier
fallo queda registrado en la propia colección o en cada documento.
"""

import json # para leer el archivo de configuración de Wukong
import logging # para registrar errores
import os # para manejar el entorno
import shutil # para copiar el workdir de Wukong a disco
import subprocess # para ejecutar Wukong
import sys # para ejecutar Wukong
import tempfile # para crear un directorio temporal para el workdir de Wukong
from datetime import datetime, timezone # para manejar fechas y horas en UTC
from pathlib import Path # para manejar rutas de archivos   

from app.config import settings
# importamos el cliente de Supabase para interactuar con la base de datos
from app.services import supabase_client
from app.services.qm_storage import export_qm_to_supabase
from app.services.text_extraction import (
    process_pdf_document,
    process_txt_document,
)

logger = logging.getLogger(__name__) # para registrar errores

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

# Debe coincidir con parameters.included_documents en default_data_model.json
WUKONG_DOCUMENT_SET = "preview" # para manejar el conjunto de documentos de Wukong

_DEFAULT_DATA_MODEL_PATH = Path(__file__).resolve().parent / "default_data_model.json" # para manejar el archivo de configuración de Wukong
WUKONG_DEFAULT_CONFIG = (
    Path(__file__).resolve().parent.parent.parent
    / "wukong-engine"
    / "config"
    / "default.toml"
)
try:
    _DEFAULT_DATA_MODEL: dict = json.loads(
        _DEFAULT_DATA_MODEL_PATH.read_text(encoding="utf-8")
    )
except FileNotFoundError:
    logger.error("No se encontró default_data_model.json en %s", _DEFAULT_DATA_MODEL_PATH)
    _DEFAULT_DATA_MODEL = {"entities": [], "relations": []}


def process_collection(collection_id: str) -> None:
    """
    Punto de entrada del procesamiento. Orquesta los 3 pipelines y
    actualiza el estado de la colección y de cada documento.

    Estados de colección que pueden quedar al terminar:
        - graph_ready    → todos los docs OK, grafo cargado
        - partial_error  → algunos docs fallaron, grafo se generó igual
        - error          → falla total: ningún doc o Wukong se cayó
    """
    try:
        collection = supabase_client.get_collection_by_id(collection_id)
        if collection is None:
            logger.error("Colección %s no encontrada", collection_id)
            return

        documents = supabase_client.get_documents_by_collection(collection_id)
        if not documents:
            _mark_collection_error(
                collection_id,
                "La colección no tiene documentos para procesar.",
            )
            return

        supabase_client.update_collection_processing_status(
            collection_id, "processing_text"
        )
        n_extracted, n_errored, failed_doc_labels = _extract_texts(documents)

        if n_extracted == 0:
            failed_part = (
                f" Archivos: {', '.join(failed_doc_labels)}."
                if failed_doc_labels
                else ""
            )
            _mark_collection_error(
                collection_id,
                f"Ningún documento pudo extraerse correctamente "
                f"({n_errored} errores). No se generó grafo.{failed_part}",
            )
            return

        supabase_client.update_collection_processing_status(
            collection_id, "processing_graph"
        )

        with tempfile.TemporaryDirectory(prefix=f"wukong-{collection_id}-") as tmp:
            workdir = Path(tmp)
            _build_wukong_workdir(workdir, collection_id)

            wukong_error = _run_wukong(workdir) #con al carpeta temporal lista, corro wukong como subprocess.
            _persist_wukong_artifacts(workdir, collection_id, wukong_ok=wukong_error is None) #si wukong terminó OK, copiamos el workdir a disco para inspección local (.qm, textos, etc.).
            
            
            if wukong_error is not None:
                _mark_collection_error(collection_id, wukong_error)
                return

            try:
                qm_storage = export_qm_to_supabase(
                    workdir,
                    str(collection["user_id"]),
                    collection_id,
                )
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
            except Exception:
                logger.exception(
                    "Error generando embeddings para colección %s — grafo sigue disponible.",
                    collection_id,
                )

            # TODO PDT10-121: cargar el .qm de workdir/exports/ en MillenniumDB.
            # Bloqueado hasta confirmar el método con Alejandro
            # (mdb import vs queries vía driver vs endpoint del IMFD).

        final_status = "partial_error" if n_errored > 0 else "graph_ready"
        final_message = (
            (
                f"{n_errored} documento(s) fallaron en la extracción "
                f"({', '.join(failed_doc_labels)}). "
                f"Grafo generado con {n_extracted} documento(s)."
            )
            if n_errored > 0
            else None
        )
        supabase_client.update_collection_processing_status(
            collection_id,
            final_status,
            error_message=final_message,
            processed_at=_now_iso(),
        )

    except Exception as exc:
        logger.exception("Error inesperado procesando colección %s", collection_id)
        _mark_collection_error(
            collection_id,
            f"Error inesperado: {type(exc).__name__}: {exc}",
        )


def _doc_display_name(doc: dict) -> str:
    """Nombre legible para mensajes (filename de Storage / UI; si no, id)."""
    fn = doc.get("filename")
    if fn:
        return str(fn)
    return str(doc.get("id", "desconocido"))


def _extract_texts(documents: list[dict]) -> tuple[int, int, list[str]]:
    """
    Pipeline 1. Itera los documentos y extrae el texto de cada uno
    según su tipo. Devuelve (n_extracted_ok, n_errored, failed_display_names).

    Un fallo en un documento NO interrumpe el resto: queda con
    status='error' y se sigue con el siguiente. PDFs escaneados quedan
    como error hasta que se implemente OCR (PDT10-116).
    """
    n_extracted = 0
    n_errored = 0
    failed_doc_labels: list[str] = []

    for doc in documents:
        try:
            if doc["file_type"] == "txt":
                result = process_txt_document(
                    document_id=doc["id"],
                    user_id=doc["user_id"],
                    collection_id=doc["collection_id"],
                    storage_path=doc["storage_path"],
                )
            elif doc["file_type"] == "pdf":
                result = process_pdf_document(
                    document_id=doc["id"],
                    user_id=doc["user_id"],
                    collection_id=doc["collection_id"],
                    storage_path=doc["storage_path"],
                )
            else:
                raise ValueError(f"file_type desconocido: {doc['file_type']!r}")

            if result.get("status") == "ok":
                n_extracted += 1
            else:
                n_errored += 1
                failed_doc_labels.append(_doc_display_name(doc))

        except Exception as exc:
            logger.exception("Falló extracción del documento %s", doc["id"])
            supabase_client.update_document_status(
                document_id=doc["id"],
                user_id=doc["user_id"],
                status="error",
                error_message=f"{type(exc).__name__}: {exc}",
            )
            n_errored += 1
            failed_doc_labels.append(_doc_display_name(doc))

    return n_extracted, n_errored, failed_doc_labels


def _build_wukong_workdir(workdir: Path, collection_id: str) -> int:
    """
    Arma la estructura que espera Wukong:

        workdir/
        ├── docs/text/<WUKONG_DOCUMENT_SET>/*.txt
        └── data_model.json

    WUKONG_DOCUMENT_SET debe coincidir con included_documents en data_model.json
    (por defecto "preview").
    """
    text_dir = workdir / "docs" / "text" / WUKONG_DOCUMENT_SET
    text_dir.mkdir(parents=True, exist_ok=True)

    rows = supabase_client.get_document_texts_by_collection(collection_id)

    n_files = 0
    for row in rows:
        file_path = text_dir / f"{row['document_id']}.txt"
        file_path.write_text(row["extracted_text"], encoding="utf-8")
        n_files += 1

    (workdir / "data_model.json").write_text(
        json.dumps(_DEFAULT_DATA_MODEL, indent=2),
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


def _run_wukong(workdir: Path, timeout_seconds: int = 3600) -> str | None:
    """
    Pipeline 2. Ejecuta Wukong sobre la carpeta de trabajo.

    Devuelve None si Wukong terminó OK, o un mensaje de error si falló.
    """
    if not WUKONG_DEFAULT_CONFIG.is_file():
        return f"No existe la config de Wukong: {WUKONG_DEFAULT_CONFIG}"
    try:
        subprocess.run(
            # Arma el comando equivalente a:
            # <tu python> -m wukong_engine <workdir> --config <ruta al default.toml>
            [
                _wukong_python_executable(),
                "-m", # ejecuta el módulo wukong_engine
                "wukong_engine", # el nombre del módulo que contiene la función main() de Wukong
                str(workdir), # la ruta al workdir de Wukong
                "--config", # la ruta al archivo de configuración de Wukong
                str(WUKONG_DEFAULT_CONFIG), # la ruta al archivo de configuración de Wukong
            ],
            check=True, # para que el proceso termine correctamente
            capture_output=True, # para capturar la salida de Wukong
            text=True, # para que el resultado sea un string legible
            timeout=timeout_seconds, # para que no se quede corriendo eternamente
        )
        return None
    except subprocess.CalledProcessError as exc:
        # el proceso Wukong sí arrancó y terminó, pero con código de salida distinto de 0, Suele ser un bug en datos, config, API key del LLM, etc.
        stderr = (exc.stderr or "").strip() or str(exc) # exc.stderr: mensajes de error que Wukong escribió a stderr (si hay). Si está vacío, usa str(exc).
        return f"Wukong falló (exit {exc.returncode}): {stderr[:500]}"
        # exc.returncode: el número que devolvió el proceso (≠ 0).
        # stderr[:500]: los primeros 500 caracteres del mensaje de error.
    except subprocess.TimeoutExpired:
        return f"Wukong superó el timeout de {timeout_seconds}s."
    except FileNotFoundError:
        return (
            "wukong_engine no está instalado en el entorno. "
            "Correr: pip install -e ./wukong-engine"
        )


def _mark_collection_error(collection_id: str, message: str) -> None:
    supabase_client.update_collection_processing_status(
        collection_id,
        "error",
        error_message=message,
        processed_at=_now_iso(),
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Pipeline 3a: Embeddings ────────────────────────────────────────────────────


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

    # 6. Construir registros
    records: list[dict] = []
    for chunk_id, chunk_text in chunk_text_map.items():
        doc_obj_id = chunk_to_doc_obj.get(chunk_id)
        if not doc_obj_id:
            continue
        doc_uuid = doc_obj_to_uuid.get(doc_obj_id)
        if not doc_uuid:
            continue
        records.append({
            "chunk_id": chunk_id,
            "collection_id": collection_id,
            "document_id": doc_uuid,
            "document_name": doc_filename_map.get(doc_uuid, doc_uuid),
            "chunk_index": chunk_index_map.get(chunk_id, 0),
            "chunk_text": chunk_text,
            "entity_types": entity_types_map.get(chunk_id, []),
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
