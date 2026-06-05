-- PDT10-196: Extiende search_chunks para aplicar min_score y paginación en SQL.
-- Agrega total_count (window function) para conocer el total sin un segundo query.
-- Esto elimina el limit=10_000 que antes se hacía en Python y reduce los datos
-- transferidos desde Supabase a solo la página actual.
CREATE OR REPLACE FUNCTION search_chunks(
    query_embedding vector(384),
    p_collection_id UUID,
    p_limit         INTEGER DEFAULT 10,
    p_offset        INTEGER DEFAULT 0,
    p_entity_types  TEXT[]  DEFAULT NULL,
    p_year_min      INTEGER DEFAULT NULL,
    p_year_max      INTEGER DEFAULT NULL,
    p_min_score     FLOAT   DEFAULT 0.0
)
RETURNS TABLE (
    chunk_id      TEXT,
    document_id   UUID,
    document_name TEXT,
    chunk_text    TEXT,
    entity_types  TEXT[],
    similarity    FLOAT,
    storage_path  TEXT,
    total_count   BIGINT
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
        (1.0 - (ce.embedding <=> query_embedding))::FLOAT  AS similarity,
        d.storage_path,
        COUNT(*) OVER()::BIGINT                            AS total_count
    FROM chunk_embeddings ce
    JOIN documents d ON d.id = ce.document_id
    WHERE ce.collection_id = p_collection_id
      AND (p_entity_types IS NULL OR ce.entity_types && p_entity_types)
      AND (p_year_min IS NULL OR EXTRACT(YEAR FROM d.created_at) >= p_year_min)
      AND (p_year_max IS NULL OR EXTRACT(YEAR FROM d.created_at) <= p_year_max)
      AND (1.0 - (ce.embedding <=> query_embedding)) >= p_min_score
    ORDER BY ce.embedding <=> query_embedding
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
