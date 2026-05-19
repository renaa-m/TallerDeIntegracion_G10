"""Exportar el .qm generado por Wukong a Supabase Storage con aislamiento por colección."""

import logging
from pathlib import Path

from app.services import supabase_client

logger = logging.getLogger(__name__)


def _log_exports_debug(exports: Path) -> None:
    """Lista breve de archivos bajo exports/ para depurar .qm faltante."""
    if not exports.is_dir():
        logger.info("qm_storage: exports no es directorio: %s", exports)
        return
    files = sorted([p for p in exports.rglob("*") if p.is_file()])
    rels = [str(p.relative_to(exports)) for p in files[:40]]
    logger.info(
        "qm_storage: bajo %s hay %d archivo(s); muestra: %s",
        exports,
        len(files),
        rels if rels else "(vacío)",
    )


def find_qm_in_exports(workdir: Path) -> Path | None:
    """Devuelve la ruta a un archivo .qm bajo ``workdir/exports`` o None."""
    exports = workdir / "exports"
    if not exports.is_dir():
        logger.warning("Wukong: no existe %s", exports)
        return None
    # Wukong escribe siempre en exports/mdb/knowledge_graph.qm (layout fijo).
    preferred = exports / "mdb" / "knowledge_graph.qm"
    if preferred.is_file():
        logger.info("qm_storage: usando .qm preferido %s", preferred)
        return preferred
    qms = sorted(exports.rglob("*.qm"))
    if not qms:
        logger.warning("Wukong: no hay archivos .qm en %s", exports)
        _log_exports_debug(exports)
        return None
    if len(qms) > 1:
        logger.warning(
            "Wukong: varios .qm en exports (%d); se sube %s",
            len(qms),
            qms[0],
        )
    logger.info("qm_storage: usando .qm encontrado por rglob: %s", qms[0])
    return qms[0]


def export_qm_to_supabase(workdir: Path, collection_id: str) -> str | None:
    """
    Localiza el .qm en el workdir, lo sube al bucket ``documentos`` y actualiza
    ``collections.qm_storage_path``. Ruta canónica (desde la fila en DB):
    ``{storage_user_folder}/{collection_id}/{collection_id}.qm``
    (mismo primer segmento que los documentos: ``|`` en el sub → ``_``).

    Returns:
        Ruta en Storage si hubo .qm y la subida OK; None si no hay archivo o la colección no existe.
    """
    logger.info(
        "qm_storage: inicio export_qm_to_supabase collection_id=%s workdir=%s",
        collection_id,
        workdir,
    )
    row = supabase_client.get_collection_by_id(collection_id)
    if not row:
        logger.warning(
            "export_qm_to_supabase: get_collection_by_id sin filas para id=%r",
            collection_id,
        )
        return None
    user_id = str(row["user_id"]).strip()
    cid = str(row["id"]).strip()
    logger.info(
        "qm_storage: colección encontrada user_id=%r id_en_fila=%r (param=%r)",
        user_id,
        cid,
        collection_id,
    )
    qm_path = find_qm_in_exports(workdir)
    if qm_path is None:
        logger.warning(
            "qm_storage: no hay .qm en workdir=%s; listando exports…",
            workdir,
        )
        _log_exports_debug(workdir / "exports")
        return None
    data = qm_path.read_bytes()
    logger.info(
        "qm_storage: leído %s (%d bytes)",
        qm_path,
        len(data),
    )
    storage_path = supabase_client.upload_collection_qm(user_id, cid, data)
    supabase_client.update_collection_qm_storage_path(cid, storage_path)
    logger.info(
        "Exportado .qm a Storage (%s, ~%s bytes) para colección %s",
        storage_path,
        len(data),
        cid,
    )
    return storage_path
