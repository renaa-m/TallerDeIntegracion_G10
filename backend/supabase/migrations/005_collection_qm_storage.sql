-- Archivo .qm (MillenniumDB Quad Model) generado por Wukong, guardado en Storage.
-- qm_storage_path sigue el mismo patrón que documentos: <user_id>/<collection_id>/...
ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS qm_storage_path TEXT;

COMMENT ON COLUMN collections.qm_storage_path IS
    'Ruta en bucket documentos del .qm; primer segmento = user_id (RLS Storage), segundo = collection_id.';
