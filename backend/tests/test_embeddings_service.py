"""Tests unitarios para la generación de embeddings (modelo siempre mockeado)."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services.ai_models import ModelUnavailableError
from app.services.embeddings_service import (
    generate_embedding,
    generate_embeddings_batch,
)


def test_generate_embedding_exitoso():
    mock_model = MagicMock()
    mock_model.encode.return_value = np.array([0.1] * 384)

    with patch(
        "app.services.embeddings_service._get_model", return_value=mock_model
    ):
        resultado = generate_embedding("texto de prueba")

    assert isinstance(resultado, list)
    assert len(resultado) == 384
    assert all(isinstance(x, float) for x in resultado)


def test_generate_embedding_excepcion_generica_lanza_model_unavailable():
    mock_model = MagicMock()
    mock_model.encode.side_effect = Exception("fallo")

    with patch(
        "app.services.embeddings_service._get_model", return_value=mock_model
    ):
        with pytest.raises(ModelUnavailableError):
            generate_embedding("texto de prueba")


def test_generate_embeddings_batch_lista_vacia_retorna_lista_vacia():
    with patch("app.services.embeddings_service._get_model") as mock_get_model:
        resultado = generate_embeddings_batch([])

    assert resultado == []
    mock_get_model.assert_not_called()


def test_generate_embeddings_batch_exitoso():
    mock_model = MagicMock()
    mock_model.encode.return_value = np.array([[0.1] * 384, [0.2] * 384])

    with patch(
        "app.services.embeddings_service._get_model", return_value=mock_model
    ):
        resultado = generate_embeddings_batch(["texto 1", "texto 2"])

    assert isinstance(resultado, list)
    assert len(resultado) == 2
    for embedding in resultado:
        assert isinstance(embedding, list)
        assert len(embedding) == 384
        assert all(isinstance(x, float) for x in embedding)
