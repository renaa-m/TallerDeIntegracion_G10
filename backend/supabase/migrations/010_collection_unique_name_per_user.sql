-- Un mismo usuario no puede tener dos colecciones con el mismo nombre.
-- El constraint es UNIQUE sobre (user_id, name) para que distintos usuarios
-- puedan reusar nombres sin conflicto.

ALTER TABLE collections
    ADD CONSTRAINT collections_user_id_name_unique UNIQUE (user_id, name);
