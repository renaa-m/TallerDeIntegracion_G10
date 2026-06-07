"""Tests para GET /api/collections/{id}/entities — facetas de entidades del grafo."""

from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user
from app.services import graph_transformer

MOCK_USER_ID = "auth0|testuser123"
MOCK_COLLECTION_ID = uuid4()

_COLLECTION_READY = {
    "id": str(MOCK_COLLECTION_ID),
    "user_id": MOCK_USER_ID,
    "processing_status": "graph_ready",
}

# .qm mínimo con 4 entidades de dominio + entidades de sistema (deben ser excluidas)
_QM_SAMPLE = """\
Persona_1 :Persona nombre:"Pinochet" rol:"General"
Persona_2 :Persona nombre:"Lagos" rol:"Presidente"
Organizacion_1 :Organizacion nombre:"Ejército de Chile"
Lugar_1 :Lugar nombre:"Santiago"
Document_1 :Document filename:"informe.pdf"
Chunk_1 :Chunk text:"fragmento..."
Persona_1->Organizacion_1 :TrabajaEn cargo:"Comandante"
Persona_1->Chunk_1 :ExtractedFrom
"""

_QM_BYTES = _QM_SAMPLE.encode("utf-8")
_ENDPOINT = f"/api/collections/{MOCK_COLLECTION_ID}/entities"


@pytest.fixture(autouse=True)
def limpiar_cache():
    """Limpia el caché de facetas antes de cada test."""
    graph_transformer._facets_cache.clear()
    yield
    graph_transformer._facets_cache.clear()


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


# ── Happy path ──────────────────────────────────────────────────────────────────


def test_retorna_entidades_del_grafo(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch("app.api.routes.collections.supabase_client.download_collection_qm", return_value=_QM_BYTES),
    ):
        response = client.get(_ENDPOINT)

    assert response.status_code == 200
    data = response.json()
    labels = [e["label"] for e in data["entidades"]]
    assert "Pinochet" in labels
    assert "Lagos" in labels
    assert "Ejército de Chile" in labels
    assert "Santiago" in labels


def test_excluye_entidades_de_sistema(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch("app.api.routes.collections.supabase_client.download_collection_qm", return_value=_QM_BYTES),
    ):
        response = client.get(_ENDPOINT)

    tipos = response.json()["tipos"]
    assert "Document" not in tipos
    assert "Chunk" not in tipos
    labels = [e["label"] for e in response.json()["entidades"]]
    assert "informe.pdf" not in labels


def test_tipos_contiene_solo_tipos_presentes(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch("app.api.routes.collections.supabase_client.download_collection_qm", return_value=_QM_BYTES),
    ):
        data = client.get(_ENDPOINT).json()

    assert set(data["tipos"]) == {"Lugar", "Organizacion", "Persona"}


def test_entidades_ordenadas_por_tipo_y_label(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch("app.api.routes.collections.supabase_client.download_collection_qm", return_value=_QM_BYTES),
    ):
        data = client.get(_ENDPOINT).json()

    entidades = data["entidades"]
    claves = [(e["tipo"], e["label"].lower()) for e in entidades]
    assert claves == sorted(claves)


# ── Caché ───────────────────────────────────────────────────────────────────────


def test_segunda_llamada_usa_cache_sin_descargar(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch(
            "app.api.routes.collections.supabase_client.download_collection_qm",
            return_value=_QM_BYTES,
        ) as mock_download,
    ):
        client.get(_ENDPOINT)
        client.get(_ENDPOINT)

    assert mock_download.call_count == 1  # solo la primera llamada descarga


def test_invalidar_cache_fuerza_nueva_descarga(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch(
            "app.api.routes.collections.supabase_client.download_collection_qm",
            return_value=_QM_BYTES,
        ) as mock_download,
    ):
        client.get(_ENDPOINT)
        graph_transformer.invalidate_facets_cache(str(MOCK_COLLECTION_ID))
        client.get(_ENDPOINT)

    assert mock_download.call_count == 2


# ── Errores ─────────────────────────────────────────────────────────────────────


def test_coleccion_no_encontrada_retorna_404(client):
    with patch("app.api.routes.collections.supabase_client.get_collection", return_value=None):
        response = client.get(_ENDPOINT)
    assert response.status_code == 404


def test_coleccion_sin_grafo_retorna_409(client):
    coleccion_idle = {**_COLLECTION_READY, "processing_status": "idle"}
    with patch("app.api.routes.collections.supabase_client.get_collection", return_value=coleccion_idle):
        response = client.get(_ENDPOINT)
    assert response.status_code == 409


def test_error_de_storage_retorna_502(client):
    with (
        patch("app.api.routes.collections.supabase_client.get_collection", return_value=_COLLECTION_READY),
        patch(
            "app.api.routes.collections.supabase_client.download_collection_qm",
            side_effect=Exception("Storage error"),
        ),
    ):
        response = client.get(_ENDPOINT)
    assert response.status_code == 502


def test_sin_autenticacion_retorna_403(client_sin_auth):
    response = client_sin_auth.get(_ENDPOINT)
    assert response.status_code == 403
