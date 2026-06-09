-- 011: Búsqueda avanzada por nombre de entidad
-- * Habilita pg_trgm para ILIKE eficiente sobre chunk_text.
-- * Agrega índice GIN trigram en chunk_embeddings.chunk_text.
-- * Actualiza search_chunks:
--   - query_embedding pasa a ser opcional (NULL = sin ranking semántico).
--   - p_entity_names TEXT[]: filtra chunks que contengan los nombres dados (ILIKE).
--   - p_entity_logic TEXT: 'OR' (alguno) | 'AND' (todos). Default 'OR'.
--   - Cuando no hay embedding, ordena por chunk_index en lugar de distancia vectorial.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS chunk_embeddings_text_trgm_idx
    ON chunk_embeddings USING GIN (chunk_text gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_chunks(
    query_embedding vector(384) DEFAULT NULL,
    p_collection_id UUID,
    p_limit         INTEGER DEFAULT 10,
    p_offset        INTEGER DEFAULT 0,
    p_entity_types  TEXT[]  DEFAULT NULL,
    p_year_min      INTEGER DEFAULT NULL,
    p_year_max      INTEGER DEFAULT NULL,
    p_min_score     FLOAT   DEFAULT 0.0,
    p_entity_names  TEXT[]  DEFAULT NULL,
    p_entity_logic  TEXT    DEFAULT 'OR'
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
        CASE
            WHEN query_embedding IS NULL THEN 1.0::FLOAT
            ELSE (1.0 - (ce.embedding <=> query_embedding))::FLOAT
        END                          AS similarity,
        d.storage_path,
        COUNT(*) OVER()::BIGINT      AS total_count
    FROM chunk_embeddings ce
    JOIN documents d ON d.id = ce.document_id
    WHERE ce.collection_id = p_collection_id
      AND (p_entity_types IS NULL OR ce.entity_types && p_entity_types)
      AND (p_year_min IS NULL OR EXTRACT(YEAR FROM d.created_at) >= p_year_min)
      AND (p_year_max IS NULL OR EXTRACT(YEAR FROM d.created_at) <= p_year_max)
      AND (
          query_embedding IS NULL
          OR (1.0 - (ce.embedding <=> query_embedding)) >= p_min_score
      )
      AND (
          p_entity_names IS NULL
          OR cardinality(p_entity_names) = 0
          OR (
              CASE p_entity_logic
                  WHEN 'AND' THEN (
                      SELECT bool_and(ce.chunk_text ILIKE '%' || n || '%')
                      FROM unnest(p_entity_names) AS n
                  )
                  ELSE (
                      EXISTS (
                          SELECT 1 FROM unnest(p_entity_names) AS n
                          WHERE ce.chunk_text ILIKE '%' || n || '%'
                      )
                  )
              END
          )
      )
    ORDER BY
        CASE WHEN query_embedding IS NULL     THEN ce.chunk_index                   END ASC NULLS LAST,
        CASE WHEN query_embedding IS NOT NULL THEN (ce.embedding <=> query_embedding) END ASC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
