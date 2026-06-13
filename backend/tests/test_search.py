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

# total_count refleja lo que devuelve la window function SQL
MOCK_CHUNK = {
    "chunk_id": "Chunk_1_1",
    "document_name": "informe.pdf",
    "chunk_text": "Fragmento de prueba del documento.",
    "similarity": 0.85,
    "storage_path": "auth0_testuser123/coleccion/doc",
    "total_count": 1,
}

# Prefijo correcto para el usuario de prueba
_VALID_PATH = "auth0_testuser123/coleccion/archivo.pdf"

SEARCH_BODY = {
    "query": "consulta de prueba",
    "coleccion_id": str(MOCK_COLLECTION_ID),
}


def _chunk(i: int, similarity: float = 0.8, total_count: int = 1) -> dict:
    """Representa una fila devuelta por search_chunks (SQL ya paginó y filtró)."""
    return {
        "chunk_id": f"Chunk_1_{i}",
        "document_name": f"doc_{i}.pdf",
        "chunk_text": f"Fragmento número {i}.",
        "similarity": similarity,
        "storage_path": f"auth0_testuser123/{MOCK_COLLECTION_ID}/doc_{i}.pdf",
        "total_count": total_count,
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
# El mock representa lo que SQL devuelve: datos ya paginados + total_count real.


class TestPaginacion:
    def test_page1_retorna_primeros_10(self, client):
        # SQL devuelve la página 1 (10 chunks) con total_count del universo completo
        page_chunks = [_chunk(i, total_count=25) for i in range(10)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=page_chunks),
        ):
            data = client.post("/api/search", json=SEARCH_BODY).json()

        assert data["total"] == 25
        assert data["page"] == 1
        assert data["total_pages"] == 3
        assert len(data["resultados"]) == 10
        assert data["resultados"][0]["id_chunk"] == "Chunk_1_0"

    def test_page2_retorna_siguientes_10(self, client):
        # SQL devuelve la página 2 (chunks 10-19) con total_count del universo completo
        page_chunks = [_chunk(i + 10, total_count=25) for i in range(10)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=page_chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 2}).json()

        assert data["page"] == 2
        assert len(data["resultados"]) == 10
        assert data["resultados"][0]["id_chunk"] == "Chunk_1_10"

    def test_ultima_pagina_puede_ser_parcial(self, client):
        # SQL devuelve la última página (5 chunks) con total_count del universo
        page_chunks = [_chunk(i + 20, total_count=25) for i in range(5)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=page_chunks),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 3}).json()

        assert data["page"] == 3
        assert len(data["resultados"]) == 5

    def test_page_fuera_de_rango_retorna_lista_vacia(self, client):
        # SQL devuelve vacío cuando OFFSET supera el total de resultados
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=[]),
        ):
            data = client.post("/api/search", json={**SEARCH_BODY, "page": 99}).json()

        assert data["resultados"] == []

    def test_total_refleja_todos_los_resultados_no_solo_la_pagina(self, client):
        # SQL devuelve 10 chunks (una página) pero total_count=15
        page_chunks = [_chunk(i, total_count=15) for i in range(10)]
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", return_value=page_chunks),
        ):
            data = client.post("/api/search", json=SEARCH_BODY).json()

        assert data["total"] == 15
        assert len(data["resultados"]) == 10

    def test_sql_recibe_min_score_y_offset_correctos(self, client):
        """Verifica que la ruta pasa min_score y offset a SQL (no filtra en Python)."""
        from unittest.mock import MagicMock
        mock_search = MagicMock(return_value=[_chunk(0, similarity=0.9, total_count=1)])
        with (
            patch("app.api.routes.search.supabase_client.get_collection_by_id", return_value=MOCK_COLLECTION),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", mock_search),
        ):
            client.post("/api/search", json={**SEARCH_BODY, "page": 2, "min_score": 0.6})

        _, call_kwargs = mock_search.call_args
        args = mock_search.call_args.args
        # search_chunks(embedding, collection_id, limit, offset, ..., min_score)
        assert args[2] == 10     # _PAGE_SIZE
        assert args[3] == 10     # offset = (page 2 - 1) * 10
        assert args[7] == 0.6    # min_score


# ── Endpoint signed-url ─────────────────────────────────────────────────────────


class TestSignedUrl:
    def test_retorna_url_valida(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.create_signed_url",
            return_value="https://example.supabase.co/storage/v1/signed?token=abc",
        ):
            response = client.get(f"/api/documentos/signed-url?path={_VALID_PATH}")

        assert response.status_code == 200
        assert response.json()["url"].startswith("https://")

    def test_devuelve_502_si_storage_falla(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.create_signed_url",
            side_effect=Exception("Storage error"),
        ):
            response = client.get(f"/api/documentos/signed-url?path={_VALID_PATH}")

        assert response.status_code == 502

    def test_path_de_otro_usuario_retorna_403(self, client):
        otro_path = "auth0_otrousuario/coleccion/archivo.pdf"
        response = client.get(f"/api/documentos/signed-url?path={otro_path}")
        assert response.status_code == 403

    def test_requiere_autenticacion(self, client_sin_auth):
        response = client_sin_auth.get(f"/api/documentos/signed-url?path={_VALID_PATH}")
        assert response.status_code == 403


# ── Fallo en generación de embedding ───────────────────────────────────────────


class TestEmbeddingFailure:
    def test_generate_embedding_falla_retorna_502(self, client):
        with (
            patch(
                "app.api.routes.search.supabase_client.get_collection_by_id",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.search.generate_embedding",
                side_effect=Exception("modelo roto"),
            ),
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 502


# ── Filtros de búsqueda ────────────────────────────────────────────────────────


class TestFiltrosBusqueda:
    def test_entity_type_llega_a_sql(self, client):
        from unittest.mock import MagicMock

        mock_search = MagicMock(return_value=[_chunk(0, total_count=1)])
        with (
            patch(
                "app.api.routes.search.supabase_client.get_collection_by_id",
                return_value=MOCK_COLLECTION,
            ),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", mock_search),
        ):
            client.post(
                "/api/search",
                json={**SEARCH_BODY, "filtros": {"tipo_entidad": "Persona"}},
            )

        assert mock_search.call_args.args[4] == ["Persona"]

    def test_rango_años_llega_a_sql(self, client):
        from unittest.mock import MagicMock

        mock_search = MagicMock(return_value=[_chunk(0, total_count=1)])
        with (
            patch(
                "app.api.routes.search.supabase_client.get_collection_by_id",
                return_value=MOCK_COLLECTION,
            ),
            patch("app.api.routes.search.generate_embedding", return_value=MOCK_EMBEDDING),
            patch("app.api.routes.search.supabase_client.search_chunks", mock_search),
        ):
            client.post(
                "/api/search",
                json={**SEARCH_BODY, "filtros": {"rango_años": [2000, 2010]}},
            )

        assert mock_search.call_args.args[5] == 2000
        assert mock_search.call_args.args[6] == 2010


# ── Colección no lista para búsqueda ──────────────────────────────────────────


class TestColeccionNoLista:
    def test_processing_text_retorna_ready_false(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "processing_text"}
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=col,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        assert response.json()["ready"] is False

    def test_processing_graph_retorna_ready_false(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "processing_graph"}
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=col,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        assert response.json()["ready"] is False

    def test_error_retorna_ready_false(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "error"}
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=col,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        assert response.json()["ready"] is False

    def test_cancelled_retorna_ready_false(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "cancelled"}
        with patch(
            "app.api.routes.search.supabase_client.get_collection_by_id",
            return_value=col,
        ):
            response = client.post("/api/search", json=SEARCH_BODY)

        assert response.status_code == 200
        assert response.json()["ready"] is False
