from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user

MOCK_USER_ID = "auth0|testuser123"
MOCK_COLLECTION_ID = uuid4()

MOCK_COLLECTION = {
    "id": str(MOCK_COLLECTION_ID),
    "user_id": MOCK_USER_ID,
    "name": "Mi Colección",
    "processing_status": "graph_ready",
}

MOCK_EMBEDDING = [0.1] * 384

MOCK_CHUNK = {
    "chunk_id": "Chunk_1_1",
    "document_name": "informe.pdf",
    "chunk_text": "Fragmento de prueba del documento.",
    "similarity": 0.85,
    "storage_path": "auth0_testuser123/coleccion/doc",
}

MOCK_SIGNED_URL = "https://storage.example.com/signed/informe.pdf"

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


@pytest.fixture
def client_sin_auth():
    with TestClient(app) as c:
        yield c


# ── Búsqueda semántica ─────────────────────────────────────────────────────────


class TestBusquedaSemantica:
    def test_happy_path_retorna_resultados(self, client):
        with (
            patch(
                "app.api.routes.search.supabase_client.get_collection_by_id",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.search.generate_embedding",
                return_value=MOCK_EMBEDDING,
            ),
            patch(
                "app.api.routes.search.supabase_client.search_chunks",
                return_value=[MOCK_CHUNK],
            ),
            patch(
                "app.api.routes.search.supabase_client.create_signed_url",
                return_value=MOCK_SIGNED_URL,
            ),
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["resultados"][0]["titulo"] == "informe.pdf"
        assert data["resultados"][0]["score"] == 0.85

    def test_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=None,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 404

    def test_coleccion_de_otro_usuario_retorna_404(self, client):
        # El endpoint unifica "no existe" y "pertenece a otro usuario" en el mismo 404.
        coleccion_ajena = {**MOCK_COLLECTION, "user_id": "auth0|otro_usuario"}
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=coleccion_ajena,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 404

    def test_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post("/api/search", json=SEARCH_BODY)
        assert response.status_code == 403

    def test_sin_resultados_retorna_lista_vacia_200(self, client):
        with (
            patch(
                "app.api.routes.search.supabase_client.get_collection_by_id",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.search.generate_embedding",
                return_value=MOCK_EMBEDDING,
            ),
            patch(
                "app.api.routes.search.supabase_client.search_chunks",
                return_value=[],
            ),
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["resultados"] == []
