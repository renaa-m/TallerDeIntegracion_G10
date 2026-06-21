"""Tipos compartidos para el manejo de fallos de los modelos de IA.

Vive en su propio módulo (sin dependencias pesadas) para que tanto
``embeddings_service`` como ``wukong_runner`` puedan importarlo sin cargar
``sentence_transformers`` ni el modelo en tiempo de import.
"""

from __future__ import annotations


class ModelUnavailableError(Exception):
    """Un modelo de IA no se pudo cargar o ejecutar ("se cayó el modelo").

    Se usa para distinguir la caída del modelo en sí (embeddings o el LLM que
    usa Wukong) de otros errores del pipeline (red, base de datos, archivos),
    que NO deben reportarse como fallo de modelo.

    ``model_label`` es el nombre legible del modelo para el mensaje al usuario
    (p. ej. "embeddings" o "construcción del grafo").
    """

    def __init__(self, model_label: str, *args: object) -> None:
        super().__init__(*args)
        self.model_label = model_label
