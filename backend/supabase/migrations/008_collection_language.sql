-- Agrega campo de idioma a las colecciones.
-- Permite configurar hints de OCR (Cloud Vision) y en el futuro
-- el data_model de Wukong por idioma.
-- Códigos BCP-47 de un solo idioma; 'es' por defecto (comportamiento previo).

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es';

COMMENT ON COLUMN collections.language IS
    'Idioma principal de los documentos (código BCP-47: es, en, fr, pt, …). '
    'Controla los language_hints de Cloud Vision OCR y, en el futuro, el data_model de Wukong.';
