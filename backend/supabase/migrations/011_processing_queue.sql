-- Migración 011: timestamp de encolado para ordenamiento FIFO confiable
--
-- La migración 007 ya agregó queue_action y queue_payload.
-- Esta migración agrega queued_at para que el dequeue sea por orden de llegada
-- exacto (updated_at podría cambiar por otras razones y no es confiable como
-- criterio de ordenamiento de la cola).

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

COMMENT ON COLUMN collections.queued_at IS
    'Timestamp en que la colección fue encolada (se limpia al salir de estado queued). '
    'Se usa para ordenamiento FIFO de la cola global.';

CREATE INDEX IF NOT EXISTS idx_collections_queued_fifo
    ON collections (queued_at ASC)
    WHERE processing_status = 'queued';
