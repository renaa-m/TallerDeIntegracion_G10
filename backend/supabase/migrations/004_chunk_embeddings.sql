-- Habilitar extensión pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla para almacenar chunks y sus embeddings
CREATE TABLE chunk_embeddings (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id         TEXT        NOT NULL,                          -- e.g. "Chunk_1_2" (coincide con el grafo en MillenniumDB)
    collection_id    UUID        NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    document_id      UUID        NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
    document_name    TEXT        NOT NULL,                          -- nombre del archivo original (para mostrar en resultados)
    chunk_index      INTEGER     NOT NULL,                          -- posición 1-based dentro del documento
    chunk_text       TEXT        NOT NULL,                          -- texto del chunk
    embedding        vector(384),                                   -- paraphrase-multilingual-MiniLM-L12-v2 (sentence-transformers)
    entity_types     TEXT[]      NOT NULL DEFAULT '{}',             -- tipos de entidad extraídos del chunk (Persona, Lugar, etc.)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX chunk_embeddings_collection_idx ON chunk_embeddings (collection_id);
CREATE INDEX chunk_embeddings_document_idx   ON chunk_embeddings (document_id);
CREATE INDEX chunk_embeddings_vec_idx        ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_chunk_embeddings" ON chunk_embeddings
    USING (
        collection_id IN (
            SELECT id FROM collections WHERE user_id = auth.uid()::text
        )
    );

-- Función de búsqueda semántica por similitud coseno
-- Llamada desde el backend vía supabase.rpc("search_chunks", {...})
CREATE OR REPLACE FUNCTION search_chunks(
    query_embedding vector(384),
    p_collection_id UUID,
    p_limit         INTEGER  DEFAULT 10,
    p_entity_types  TEXT[]   DEFAULT NULL,   -- filtra chunks que contengan al menos un tipo de estos
    p_year_min      INTEGER  DEFAULT NULL,   -- filtra por año de creación del documento (>=)
    p_year_max      INTEGER  DEFAULT NULL    -- filtra por año de creación del documento (<=)
)
RETURNS TABLE (
    chunk_id      TEXT,
    document_id   UUID,
    document_name TEXT,
    chunk_text    TEXT,
    entity_types  TEXT[],
    similarity    FLOAT,
    storage_path  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ce.chunk_id,
        ce.document_id,
        ce.document_name,
        ce.chunk_text,
        ce.entity_types,
        1.0 - (ce.embedding <=> query_embedding) AS similarity,
        d.storage_path
    FROM chunk_embeddings ce
    JOIN documents d ON d.id = ce.document_id
    WHERE ce.collection_id = p_collection_id
      AND (p_entity_types IS NULL OR ce.entity_types && p_entity_types)
      AND (p_year_min IS NULL OR EXTRACT(YEAR FROM d.created_at) >= p_year_min)
      AND (p_year_max IS NULL OR EXTRACT(YEAR FROM d.created_at) <= p_year_max)
    ORDER BY ce.embedding <=> query_embedding
    LIMIT p_limit;
END;
$$;
