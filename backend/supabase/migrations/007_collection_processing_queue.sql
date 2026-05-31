-- Cola de procesamiento: una colección activa por usuario; el resto queda en ``queued``.
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_processing_status_check;

ALTER TABLE collections ADD CONSTRAINT collections_processing_status_check
    CHECK (processing_status IN (
        'idle',
        'queued',
        'processing_text',
        'processing_graph',
        'awaiting_graph_confirmation',
        'graph_ready',
        'partial_error',
        'error',
        'cancelled'
    ));

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS queue_action TEXT,
    ADD COLUMN IF NOT EXISTS queue_payload JSONB;

COMMENT ON COLUMN collections.queue_action IS
    'Cuando processing_status=queued: process | continue_graph';

COMMENT ON COLUMN collections.queue_payload IS
    'Datos opcionales para el job encolado (p. ej. custom_data_model en generate-graph).';
