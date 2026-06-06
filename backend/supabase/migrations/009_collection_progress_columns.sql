-- HU-04 / fix-producción: columnas de progreso de extracción y construcción de grafo.
-- update_collection_progress() en supabase_client.py escribe estas columnas;
-- el frontend las lee para mostrar la barra de progreso de procesamiento.
-- Sin esta migración, cada UPDATE de progreso falla en producción con
-- "column does not exist" y el pipeline de procesamiento se interrumpe.

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS text_progress_total      INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS text_progress_processed  INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS graph_progress_total     INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS graph_progress_processed INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS text_failed_documents    JSONB    NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS graph_failed_documents   JSONB    NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN collections.text_progress_total      IS 'Total de documentos en pipeline de extracción de texto.';
COMMENT ON COLUMN collections.text_progress_processed  IS 'Documentos con extracción de texto completada (ok o error).';
COMMENT ON COLUMN collections.graph_progress_total     IS 'Total de documentos en pipeline de construcción de grafo.';
COMMENT ON COLUMN collections.graph_progress_processed IS 'Documentos procesados por Wukong (ok o error).';
COMMENT ON COLUMN collections.text_failed_documents    IS 'Lista de {document_id, filename, error} con fallo en extracción.';
COMMENT ON COLUMN collections.graph_failed_documents   IS 'Lista de {document_id, filename, error} con fallo en Wukong.';
