-- HU-13: Resiliencia de carga — hash SHA-256 para detección de duplicados
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256_hash TEXT;

-- Garantiza que el mismo archivo no pueda subirse dos veces a la misma colección
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_collection_hash
    ON documents(collection_id, sha256_hash)
    WHERE sha256_hash IS NOT NULL;

-- Índice para búsquedas rápidas por usuario+colección+hash
CREATE INDEX IF NOT EXISTS idx_documents_user_collection_hash
    ON documents(user_id, collection_id, sha256_hash)
    WHERE sha256_hash IS NOT NULL;
