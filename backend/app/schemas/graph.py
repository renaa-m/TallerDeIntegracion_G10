from pydantic import BaseModel, ConfigDict, model_validator


class EntityProperty(BaseModel):
    """Definición de una propiedad dentro de una entidad del Data Model."""

    model_config = ConfigDict(extra="allow")

    type: str
    description: str


class EntityDefinition(BaseModel):
    """Definición de un tipo de entidad (nodo) del grafo."""

    model_config = ConfigDict(extra="allow")

    description: str
    primary_key: str
    properties: dict[str, EntityProperty]


class RelationDefinition(BaseModel):
    """Definición de un tipo de relación (arista) del grafo.

    Topología: usar 'origin_target' (dict de listas) O bien 'origin' + 'target'
    por separado — nunca los dos a la vez.
    """

    model_config = ConfigDict(extra="allow")

    description: str
    origin_target: dict[str, list[str]] | None = None
    origin: list[str] | None = None
    target: list[str] | None = None

    @model_validator(mode="after")
    def _check_topology(self) -> "RelationDefinition":
        has_origin_target = self.origin_target is not None
        has_separate = self.origin is not None or self.target is not None
        if not has_origin_target and not has_separate:
            raise ValueError(
                "Una relación debe definir 'origin_target' o bien 'origin' y 'target'."
            )
        if has_origin_target and has_separate:
            raise ValueError(
                "No se puede definir 'origin_target' junto con 'origin'/'target' al mismo tiempo."
            )
        return self


class DataModelParameters(BaseModel):
    """Parámetros globales del Data Model (rol del LLM, idioma, entidades incluidas)."""

    role: str
    context: str
    input_language: str
    output_language: str
    included_documents: list[str]
    included_entities: list[str]
    included_relations: list[str]


class DataModelUpdate(BaseModel):
    """Cuerpo del request para POST /generate-graph.

    Refleja la estructura de default_data_model.json. El runner siempre
    sobreescribe 'parameters.included_documents' con el valor interno
    WUKONG_DOCUMENT_SET para evitar desincronización con el workdir.
    """

    parameters: DataModelParameters
    entities: dict[str, EntityDefinition]
    relations: dict[str, RelationDefinition]
