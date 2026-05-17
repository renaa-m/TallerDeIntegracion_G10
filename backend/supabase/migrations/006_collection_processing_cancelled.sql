-- Permitir estado terminal "cancelled" (solicitud explícita de la usuaria durante el pipeline).
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_processing_status_check;

ALTER TABLE collections ADD CONSTRAINT collections_processing_status_check
    CHECK (processing_status IN (
        'idle',
        'processing_text',
        'processing_graph',
        'graph_ready',
        'partial_error',
        'error',
        'cancelled'
    ));

COMMENT ON COLUMN collections.processing_status IS
    'Incluye cancelled tras POST /process/cancel; permite reintentar con POST /process.';
