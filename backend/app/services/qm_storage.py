"""Exportar el .qm generado por Wukong a Supabase Storage con aislamiento por colección."""

import logging
from pathlib import Path

from app.services import supabase_client

logger = logging.getLogger(__name__)


def find_qm_in_exports(workdir: Path) -> Path | None:
    """Devuelve la ruta a un archivo .qm bajo ``workdir/exports`` o None."""
    exports = workdir / "exports"
    if not exports.is_dir():
        logger.warning("Wukong: no existe %s", exports)
        return None
    qms = sorted(exports.rglob("*.qm"))
    if not qms:
        logger.warning("Wukong: no hay archivos .qm en %s", exports)
        return None
    if len(qms) > 1:
        logger.warning(
            "Wukong: varios .qm en exports (%d); se sube %s",
            len(qms),
            qms[0],
        )
    return qms[0]


def export_qm_to_supabase(workdir: Path, user_id: str, collection_id: str) -> str | None:
    """
    Localiza el .qm en el workdir, lo sube al bucket ``documentos`` y actualiza
    ``collections.qm_storage_path``. Ruta: ``{user_id}/{collection_id}/knowledge_graph.qm``.

    Returns:
        Ruta en Storage si hubo .qm y la subida OK; None si no hay archivo.
    """
    qm_path = find_qm_in_exports(workdir)
    if qm_path is None:
        return None
    data = qm_path.read_bytes()
    storage_path = supabase_client.upload_collection_qm(user_id, collection_id, data)
    supabase_client.update_collection_qm_storage_path(collection_id, storage_path)
    logger.info(
        "Exportado .qm a Storage (%s, ~%s bytes) para colección %s",
        storage_path,
        len(data),
        collection_id,
    )
    return storage_path
