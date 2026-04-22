-- Colecciones de documentos por usuario
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documentos individuales dentro de una colección
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'txt')),
    file_size_bytes BIGINT,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting_text', 'text_extracted', 'building_graph', 'graph_ready', 'error')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Texto extraído de cada documento (resultado del Pipeline 1)
CREATE TABLE document_texts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    collection_id UUID NOT NULL,
    extracted_text TEXT NOT NULL,
    extraction_method TEXT NOT NULL CHECK (extraction_method IN ('pymupdf', 'ocr', 'direct_read')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX idx_collections_user_id ON collections(user_id);
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_collection_id ON documents(collection_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_document_texts_document_id ON document_texts(document_id);
CREATE INDEX idx_document_texts_collection_id ON document_texts(collection_id);

-- RLS: cada usuario solo ve sus propios datos
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_texts ENABLE ROW LEVEL SECURITY;

-- El backend usa service_role key (bypasea RLS).
-- Estas políticas aplican solo si se usa anon key desde el frontend.
CREATE POLICY "users_own_collections" ON collections
    FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "users_own_documents" ON documents
    FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "users_own_texts" ON document_texts
    FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
