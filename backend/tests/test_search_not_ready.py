"""Búsqueda cuando la colección aún no tiene grafo."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user

MOCK_USER_ID = "auth0|testuser123"
MOCK_COLLECTION_ID = uuid4()

SEARCH_BODY = {
    "query": "consulta de prueba",
    "coleccion_id": str(MOCK_COLLECTION_ID),
}


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER_ID
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_busqueda_sin_grafo_retorna_200_vacio(client):
    coleccion_idle = {
        "id": str(MOCK_COLLECTION_ID),
        "user_id": MOCK_USER_ID,
        "processing_status": "idle",
    }
    with patch(
        "app.api.routes.search.supabase_client.get_collection_by_id",
        return_value=coleccion_idle,
    ):
        response = client.post("/api/search", json=SEARCH_BODY)

    assert response.status_code == 200
    data = response.json()
    assert data["ready"] is False
    assert data["total"] == 0
    assert data["resultados"] == []
    assert "grafo" in data["message"].lower()
