-- HU-04: Agrega estado de procesamiento a nivel colección.
-- Permite saber, sin tener que iterar por documento, si una colección está
-- siendo procesada, ya tiene grafo, falló parcialmente, etc.

ALTER TABLE collections
    ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'idle'
        CHECK (processing_status IN (
            'idle',              -- recién creada o sin procesar
            'processing_text',   -- Pipeline 1: extracción de texto en curso
            'processing_graph',  -- Pipeline 2: Wukong corriendo
            'graph_ready',       -- todo OK, grafo cargado en MillenniumDB
            'partial_error',     -- algunos docs fallaron, grafo generado igual
            'error'              -- falla total: el grafo no se generó
        )),
    ADD COLUMN processing_error_message TEXT,
    ADD COLUMN processed_at TIMESTAMPTZ;

CREATE INDEX idx_collections_processing_status ON collections(processing_status);
