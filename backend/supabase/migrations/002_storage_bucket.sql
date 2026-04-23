-- Bucket privado para documentos de usuarios
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS sobre storage.objects para el bucket 'documentos'
-- El path esperado es: {user_sub}/{filename}
-- (storage.foldername(name))[1] extrae el primer segmento del path.

CREATE POLICY "users_own_files_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = current_setting('request.jwt.claims', true)::json->>'sub'
    );

CREATE POLICY "users_own_files_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = current_setting('request.jwt.claims', true)::json->>'sub'
    );

CREATE POLICY "users_own_files_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = current_setting('request.jwt.claims', true)::json->>'sub'
    );

CREATE POLICY "users_own_files_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = current_setting('request.jwt.claims', true)::json->>'sub'
    );
