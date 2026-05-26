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
    "description": "Descripción de prueba",
    "status": "active",
    "processing_status": "idle",
    "processing_error_message": None,
    "processed_at": None,
    "created_at": "2024-01-01T00:00:00+00:00",
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


# ── Listar ─────────────────────────────────────────────────────────────────────


class TestListarColecciones:
    def test_listar_retorna_lista(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collections",
            return_value=[MOCK_COLLECTION],
        ):
            response = client.get("/api/collections")

        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_listar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.get("/api/collections")
        assert response.status_code == 403


# ── Crear ──────────────────────────────────────────────────────────────────────


class TestCrearColeccion:
    def test_crear_coleccion_exitoso(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.create_collection",
            return_value=MOCK_COLLECTION,
        ):
            response = client.post(
                "/api/collections",
                json={"name": "Mi Colección", "description": "Descripción de prueba"},
            )

        assert response.status_code == 201
        assert response.json()["name"] == "Mi Colección"

    def test_crear_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post(
            "/api/collections",
            json={"name": "Mi Colección"},
        )
        assert response.status_code == 403


# ── Obtener ────────────────────────────────────────────────────────────────────


class TestObtenerColeccion:
    def test_obtener_coleccion_existente(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=MOCK_COLLECTION,
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 200
        assert response.json()["id"] == str(MOCK_COLLECTION_ID)

    def test_obtener_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=None,
        ):
            response = client.get(f"/api/collections/{uuid4()}")

        assert response.status_code == 404

    def test_obtener_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.get(f"/api/collections/{MOCK_COLLECTION_ID}")
        assert response.status_code == 403


# ── Eliminar ───────────────────────────────────────────────────────────────────


class TestEliminarColeccion:
    def test_eliminar_coleccion_exitoso(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.delete_collection",
            return_value=True,
        ):
            response = client.delete(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 204

    def test_eliminar_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.delete_collection",
            return_value=False,
        ):
            response = client.delete(f"/api/collections/{uuid4()}")

        assert response.status_code == 404

    def test_eliminar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.delete(f"/api/collections/{MOCK_COLLECTION_ID}")
        assert response.status_code == 403


# ── Actualizar ─────────────────────────────────────────────────────────────────


class TestActualizarColeccion:
    def test_actualizar_nombre_exitoso(self, client):
        coleccion_actualizada = {**MOCK_COLLECTION, "name": "Nuevo Nombre"}
        with patch(
            "app.api.routes.collections.supabase_client.update_collection_name",
            return_value=coleccion_actualizada,
        ):
            response = client.patch(
                f"/api/collections/{MOCK_COLLECTION_ID}",
                json={"name": "Nuevo Nombre"},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Nuevo Nombre"

    def test_actualizar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.patch(
            f"/api/collections/{MOCK_COLLECTION_ID}",
            json={"name": "Nuevo Nombre"},
        )
        assert response.status_code == 403


# ── Procesar ───────────────────────────────────────────────────────────────────


class TestProcesarColeccion:
    def test_procesar_coleccion_idle_retorna_202(self, client):
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.collections.supabase_client.get_documents",
                return_value=[{"id": str(uuid4())}],
            ),
            patch(
                "app.api.routes.collections.supabase_client.update_collection_processing_status",
            ),
            patch(
                "app.api.routes.collections.wukong_runner.process_collection",
            ),
        ):
            response = client.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_text"

    def test_procesar_coleccion_en_procesamiento_retorna_409(self, client):
        coleccion_procesando = {**MOCK_COLLECTION, "processing_status": "processing_text"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=coleccion_procesando,
        ):
            response = client.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")

        assert response.status_code == 409

    def test_procesar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")
        assert response.status_code == 403


# ── Cancelar procesamiento ─────────────────────────────────────────────────────


class TestCancelarProcesamiento:
    def test_cancelar_en_pipeline_ok(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "processing_text"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=col,
        ), patch(
            "app.api.routes.collections.supabase_client.update_collection_processing_status",
        ) as mock_upd:
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/process/cancel",
            )
        assert response.status_code == 200
        data = response.json()
        assert data["processing_status"] == "cancelled"
        mock_upd.assert_called_once()
        assert mock_upd.call_args[0][1] == "cancelled"

    def test_cancelar_idempotente_si_ya_cancelada(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "cancelled"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=col,
        ), patch(
            "app.api.routes.collections.supabase_client.update_collection_processing_status",
        ) as mock_upd:
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/process/cancel",
            )
        assert response.status_code == 200
        mock_upd.assert_not_called()

    def test_cancelar_sin_pipeline_retorna_409(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=MOCK_COLLECTION,
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/process/cancel",
            )
        assert response.status_code == 409

    def test_cancelar_sin_auth_403(self, client_sin_auth):
        response = client_sin_auth.post(
            f"/api/collections/{MOCK_COLLECTION_ID}/process/cancel",
        )
        assert response.status_code == 403


# ── Grafo Cytoscape ────────────────────────────────────────────────────────────

_QM_MINIMAL = (
    'Nodo_1 :TipoA nombre:"Entidad A"\n'
    'Nodo_2 :TipoB nombre:"Entidad B"\n'
    "Nodo_1->Nodo_2 :Relacion\n"
)

class TestObtenerGrafo:
    def test_grafo_listo_retorna_200_con_elements(self, client):
        coleccion_lista = {**MOCK_COLLECTION, "processing_status": "graph_ready"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=coleccion_lista,
            ),
            patch(
                "app.api.routes.collections.supabase_client.download_collection_qm",
                return_value=_QM_MINIMAL.encode("utf-8"),
            ),
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 200
        data = response.json()
        assert "elements" in data
        assert "nodes" in data["elements"]
        assert "edges" in data["elements"]

    def test_grafo_retorna_nodos_y_aristas_correctos(self, client):
        coleccion_lista = {**MOCK_COLLECTION, "processing_status": "graph_ready"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=coleccion_lista,
            ),
            patch(
                "app.api.routes.collections.supabase_client.download_collection_qm",
                return_value=_QM_MINIMAL.encode("utf-8"),
            ),
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        data = response.json()
        assert len(data["elements"]["nodes"]) == 2
        assert len(data["elements"]["edges"]) == 1

    def test_grafo_no_listo_retorna_409(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=MOCK_COLLECTION,  # processing_status: "idle"
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 409

    def test_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=None,
        ):
            response = client.get(f"/api/collections/{uuid4()}/graph")

        assert response.status_code == 404

    def test_error_descarga_retorna_502(self, client):
        coleccion_lista = {**MOCK_COLLECTION, "processing_status": "graph_ready"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=coleccion_lista,
            ),
            patch(
                "app.api.routes.collections.supabase_client.download_collection_qm",
                side_effect=RuntimeError("Storage error"),
            ),
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 502

    def test_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")
        assert response.status_code == 403


# ── Generar grafo con Data Model personalizado ─────────────────────────────────

CUSTOM_DATA_MODEL_PAYLOAD = {
    "parameters": {
        "role": "Analista experto en documentos históricos.",
        "context": "Documentos sobre la dictadura militar chilena.",
        "input_language": "spanish",
        "output_language": "spanish",
        "included_documents": ["preview"],
        "included_entities": ["RangoMilitar", "CentroDetencion"],
        "included_relations": ["DetenidoEn"],
    },
    "entities": {
        "RangoMilitar": {
            "description": "Grado o rango dentro de las Fuerzas Armadas.",
            "primary_key": "nombre",
            "properties": {
                "nombre": {"type": "string", "description": "Nombre del rango"}
            },
        },
        "CentroDetencion": {
            "description": "Lugar utilizado como centro de detención política.",
            "primary_key": "nombre",
            "properties": {
                "nombre": {"type": "string", "description": "Nombre del centro"}
            },
        },
    },
    "relations": {
        "DetenidoEn": {
            "description": "Una persona fue detenida en un centro.",
            "origin_target": {"RangoMilitar": ["CentroDetencion"]},
        }
    },
}


class TestGenerateGraph:
    def test_retorna_202_y_encola_con_custom_model(self, client):
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.collections.supabase_client.get_documents",
                return_value=[{"id": str(uuid4())}],
            ),
            patch(
                "app.api.routes.collections.supabase_client.update_collection_processing_status",
            ),
            patch(
                "app.api.routes.collections.wukong_runner.process_collection",
            ) as mock_process,
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_text"
        mock_process.assert_called_once()
        _, kwargs_model = mock_process.call_args[0][0], mock_process.call_args[0][1]
        assert "RangoMilitar" in kwargs_model["entities"]
        assert "CentroDetencion" in kwargs_model["entities"]

    def test_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=None,
        ):
            response = client.post(
                f"/api/collections/{uuid4()}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 404

    def test_coleccion_en_procesamiento_retorna_409(self, client):
        coleccion_procesando = {**MOCK_COLLECTION, "processing_status": "processing_graph"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=coleccion_procesando,
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 409

    def test_sin_documentos_retorna_422(self, client):
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.collections.supabase_client.get_documents",
                return_value=[],
            ),
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 422

    def test_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post(
            f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
            json=CUSTOM_DATA_MODEL_PAYLOAD,
        )
        assert response.status_code == 403

    def test_body_invalido_sin_entities_retorna_422(self, client):
        response = client.post(
            f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
            json={"parameters": {}, "relations": {}},  # falta "entities"
        )
        assert response.status_code == 422

    def test_relacion_sin_topologia_retorna_422(self, client):
        payload_invalido = {
            **CUSTOM_DATA_MODEL_PAYLOAD,
            "relations": {
                "Mala": {
                    "description": "Sin origin_target ni origin/target",
                }
            },
        }
        response = client.post(
            f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
            json=payload_invalido,
        )
        assert response.status_code == 422
