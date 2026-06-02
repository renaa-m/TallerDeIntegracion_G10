"""Tests para búsqueda semántica paginada y endpoint de URL firmada."""

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

SEARCH_BODY = {
    "query": "consulta de prueba",
    "coleccion_id": str(MOCK_COLLECTION_ID),
}


def _chunk(i: int, similarity: float = 0.8) -> dict:
    return {
        "chunk_id": f"Chunk_1_{i}",
        "document_name": f"doc_{i}.pdf",
        "chunk_text": f"Fragmento número {i}.",
        "similarity": similarity,
        "storage_path": f"user/{MOCK_COLLECTION_ID}/doc_{i}.pdf",
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
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["page"] == 1
        assert data["total_pages"] == 1
        assert data["resultados"][0]["titulo"] == "informe.pdf"
        assert data["resultados"][0]["score"] == 0.85
        assert "storage_path" in data["resultados"][0]

    def test_resultado_contiene_storage_path_no_url_firmada(self, client):
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
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        path = response.json()["resultados"][0]["storage_path"]
        assert not path.startswith("https://")
        assert "token" not in path

    def test_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=None,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 404

    def test_coleccion_de_otro_usuario_retorna_404(self, client):
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
        assert data["total_pages"] == 0
        assert data["resultados"] == []


# ── Paginación ─────────────────────────────────────────────────────────────────


class TestPaginacion:
    def test_page1_retorna_primeros_10(self, client):
        chunks = [_chunk(i) for i in range(25)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json=SEARCH_BODY).json()

        assert data["total"] == 25
        assert data["page"] == 1
        assert data["total_pages"] == 3
        assert len(data["resultados"]) == 10
        assert data["resultados"][0]["id_chunk"] == "Chunk_1_0"

    def test_page2_retorna_siguientes_10(self, client):
        chunks = [_chunk(i) for i in range(25)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 2}).json()

        assert data["page"] == 2
        assert len(data["resultados"]) == 10
        assert data["resultados"][0]["id_chunk"] == "Chunk_1_10"

    def test_ultima_pagina_puede_ser_parcial(self, client):
        chunks = [_chunk(i) for i in range(25)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 3}).json()

        assert data["page"] == 3
        assert len(data["resultados"]) == 5

    def test_page_fuera_de_rango_retorna_lista_vacia(self, client):
        chunks = [_chunk(i) for i in range(5)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 99}).json()

        assert data["total"] == 5
        assert data["resultados"] == []

    def test_total_refleja_todos_los_resultados_no_solo_la_pagina(self, client):
        chunks = [_chunk(i) for i in range(15)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json=SEARCH_BODY).json()

        assert data["total"] == 15
        assert len(data["resultados"]) == 10

    def test_filtra_por_min_score_antes_de_paginar(self, client):
        chunks = [
            _chunk(0, similarity=0.9),
            _chunk(1, similarity=0.3),  # descartado
            _chunk(2, similarity=0.7),
        ]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "min_score": 0.5}).json()

        assert data["total"] == 2
        assert all(r["score"] >= 0.5 for r in data["resultados"])


# ── Endpoint signed-url ─────────────────────────────────────────────────────────


class TestSignedUrl:
    def test_retorna_url_valida(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.create_signed_url",
            return_value="https://example.supabase.co/storage/v1/signed?token=abc",
        ):
            response = client.get("/api/documentos/signed-url?path=user/col/archivo.pdf")

        assert response.status_code == 200
        assert response.json()["url"].startswith("https://")

    def test_devuelve_502_si_storage_falla(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.create_signed_url",
            side_effect=Exception("Storage error"),
        ):
            response = client.get("/api/documentos/signed-url?path=user/col/archivo.pdf")

        assert response.status_code == 502

    def test_requiere_autenticacion(self, client_sin_auth):
        response = client_sin_auth.get("/api/documentos/signed-url?path=user/col/archivo.pdf")
        assert response.status_code == 403
