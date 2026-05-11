-- Estado del pipeline "Generar grafo" por colección (HU-04)
ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'idle';

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS processing_error_message TEXT;

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
