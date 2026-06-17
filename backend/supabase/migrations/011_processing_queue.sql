-- Migración 011: soporte de cola de procesamiento por colección
--
-- Agrega los campos necesarios para que processing_queue.py pueda
-- encolar jobs en Supabase en lugar de rechazarlos con error cuando
-- el slot de procesamiento está ocupado.
--
-- Campos agregados a la tabla collections:
--   queue_position  : orden de la colección dentro de la cola del usuario (NULL = no encolada)
--   queued_at       : timestamp en que se encoló (para ordenar y calcular tiempos de espera)
--
-- El estado `queued` se agrega al tipo de procesamiento.
-- El backend lee la cola ordenada por (user_id, queued_at) y despacha
-- el siguiente job cuando el slot global se libera.

-- Agregar campos de cola a la tabla collections
ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS queue_position  integer,
    ADD COLUMN IF NOT EXISTS queued_at       timestamptz;

-- Índice para dequeue eficiente: buscar el próximo job en cola de un usuario
CREATE INDEX IF NOT EXISTS idx_collections_queue
    ON collections (user_id, queued_at)
    WHERE processing_status = 'queued';

-- Vista utilitaria: jobs encolados ordenados globalmente
-- Útil para el worker que despacha el próximo job disponible
CREATE OR REPLACE VIEW queued_jobs_ordered AS
SELECT
    id,
    user_id,
    name,
    queued_at,
    queue_position
FROM collections
WHERE processing_status = 'queued'
ORDER BY queued_at ASC;

COMMENT ON COLUMN collections.queue_position IS
    'Posición en la cola de procesamiento del usuario. NULL si no está encolada.';

COMMENT ON COLUMN collections.queued_at IS
    'Timestamp en que la colección fue encolada. NULL si nunca se encoló.';
