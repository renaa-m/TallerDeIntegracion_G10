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

    def test_get_no_reencola_mientras_procesa(self, client):
        # Un GET de polling NO debe re-encolar: hacerlo en cada poll generaba
        # ALREADY_EXISTS en Cloud Tasks cada ~3s.
        col = {**MOCK_COLLECTION, "processing_status": "processing_graph"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=col,
            ),
            patch(
                "app.api.routes.collections.processing_queue.ensure_collection_processing",
            ) as mock_ensure,
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 200
        mock_ensure.assert_not_called()


# ── Eliminar ───────────────────────────────────────────────────────────────────


class TestEliminarColeccion:
    def test_eliminar_coleccion_exitoso(self, client):
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=MOCK_COLLECTION,
            ),
            patch(
                "app.api.routes.collections.supabase_client.delete_collection",
                return_value=True,
            ),
        ):
            response = client.delete(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 204

    def test_eliminar_encolada_legacy_no_drena(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "queued"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=col,
            ),
            patch(
                "app.api.routes.collections.supabase_client.delete_collection",
                return_value=True,
            ),
            patch(
                "app.api.routes.collections.processing_queue.drain_user_queue",
            ) as mock_drain,
        ):
            response = client.delete(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 204
        mock_drain.assert_not_called()

    def test_eliminar_procesando_no_drena_en_delete(self, client):
        """El worker activo drena la cola al terminar; DELETE no debe bloquear ni adelantar."""
        col = {**MOCK_COLLECTION, "processing_status": "processing_text"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=col,
            ),
            patch(
                "app.api.routes.collections.supabase_client.delete_collection",
                return_value=True,
            ),
            patch(
                "app.api.routes.collections.processing_queue.drain_user_queue",
            ) as mock_drain,
        ):
            response = client.delete(f"/api/collections/{MOCK_COLLECTION_ID}")

        assert response.status_code == 204
        mock_drain.assert_not_called()

    def test_eliminar_coleccion_no_encontrada_retorna_404(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=None,
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
                "app.api.routes.collections.processing_queue.request_process",
                return_value="processing_text",
            ) as mock_request,
        ):
            response = client.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_text"
        mock_request.assert_called_once()

    def test_procesar_coleccion_retorna_429_si_cola_llena(self, client):
        from app.services.processing_queue import ProcessingSlotBusyError

        blocking = {
            "id": str(uuid4()),
            "name": "Otra colección",
            "processing_status": "processing_text",
        }
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
                "app.api.routes.collections.processing_queue.request_process",
                side_effect=ProcessingSlotBusyError(blocking),
            ),
        ):
            response = client.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")

        assert response.status_code == 429
        assert "Otra colección" in response.json()["detail"]

    def test_procesar_coleccion_en_procesamiento_retorna_202_idempotente(self, client):
        coleccion_procesando = {**MOCK_COLLECTION, "processing_status": "processing_text"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=coleccion_procesando,
        ):
            response = client.post(f"/api/collections/{MOCK_COLLECTION_ID}/process")

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_text"
        assert "en curso" in data["detail"].lower()

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

    def test_cancelar_legacy_queued_retorna_idle(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "queued"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=col,
        ), patch(
            "app.api.routes.collections.supabase_client.clear_collection_queue_metadata",
        ), patch(
            "app.api.routes.collections.supabase_client.update_collection_processing_status",
        ) as mock_upd, patch(
            "app.api.routes.collections.processing_queue.drain_user_queue",
        ) as mock_drain:
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/process/cancel",
            )
        assert response.status_code == 200
        data = response.json()
        assert data["processing_status"] == "idle"
        mock_upd.assert_called_once()
        mock_drain.assert_not_called()

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
        assert data["ready"] is True
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

    def test_grafo_partial_error_retorna_200(self, client):
        coleccion = {**MOCK_COLLECTION, "processing_status": "partial_error"}
        with (
            patch(
                "app.api.routes.collections.supabase_client.get_collection",
                return_value=coleccion,
            ),
            patch(
                "app.api.routes.collections.supabase_client.download_collection_qm",
                return_value=_QM_MINIMAL.encode("utf-8"),
            ),
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 200

    def test_grafo_no_listo_retorna_200_sin_ready(self, client):
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=MOCK_COLLECTION,  # processing_status: "idle"
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 200
        data = response.json()
        assert data["ready"] is False
        assert data["processing_status"] == "idle"
        assert "Aún no hay grafo para visualizar" in data["message"]
        assert data["elements"]["nodes"] == []
        assert data["elements"]["edges"] == []

    def test_grafo_en_procesamiento_retorna_200_sin_ready(self, client):
        col = {**MOCK_COLLECTION, "processing_status": "processing_graph"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=col,
        ):
            response = client.get(f"/api/collections/{MOCK_COLLECTION_ID}/graph")

        assert response.status_code == 200
        data = response.json()
        assert data["ready"] is False
        assert "se está generando" in data["message"].lower()

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
                "app.api.routes.collections.processing_queue.request_process",
                return_value="processing_text",
            ) as mock_request,
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_text"
        mock_request.assert_called_once()
        _, kwargs = mock_request.call_args
        assert "RangoMilitar" in kwargs["custom_data_model"]["entities"]
        assert "CentroDetencion" in kwargs["custom_data_model"]["entities"]

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

    def test_coleccion_en_procesamiento_retorna_202_idempotente(self, client):
        coleccion_procesando = {**MOCK_COLLECTION, "processing_status": "processing_graph"}
        with patch(
            "app.api.routes.collections.supabase_client.get_collection",
            return_value=coleccion_procesando,
        ):
            response = client.post(
                f"/api/collections/{MOCK_COLLECTION_ID}/generate-graph",
                json=CUSTOM_DATA_MODEL_PAYLOAD,
            )

        assert response.status_code == 202
        data = response.json()
        assert data["processing_status"] == "processing_graph"
        assert "en curso" in data["detail"].lower()

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


# ── Cascada de borrado (delete_collection, unit) ───────────────────────────────

_COL_ID = str(MOCK_COLLECTION_ID)
_USER_ID = MOCK_USER_ID
_DOC_PATH = f"auth0_testuser123/{MOCK_COLLECTION_ID}/doc.pdf"


def _make_client(collection_row=None, doc_rows=None):
    from unittest.mock import MagicMock

    mock_client = MagicMock()
    tables = {}

    def _table(name):
        if name not in tables:
            tables[name] = MagicMock()
        return tables[name]

    mock_client.table.side_effect = _table

    _table("collections").select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=collection_row if collection_row is not None
        else [{"id": _COL_ID, "qm_storage_path": None}]
    )
    _table("collections").delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": _COL_ID}]
    )
    _table("documents").select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=doc_rows if doc_rows is not None else []
    )
    return mock_client, tables


class TestCascadaBorrado:
    def test_cascada_elimina_storage_documentos(self):
        mock_client, _ = _make_client(doc_rows=[{"storage_path": _DOC_PATH}])
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        paths_removed = mock_client.storage.from_.return_value.remove.call_args[0][0]
        assert _DOC_PATH in paths_removed

    def test_cascada_elimina_qm(self):
        mock_client, _ = _make_client(
            collection_row=[{"id": _COL_ID, "qm_storage_path": "mi/path.qm"}],
            doc_rows=[],
        )
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        paths_removed = mock_client.storage.from_.return_value.remove.call_args[0][0]
        assert "mi/path.qm" in paths_removed

    def test_cascada_elimina_chunk_embeddings(self):
        mock_client, tables = _make_client()
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        tables["chunk_embeddings"].delete.return_value.eq.assert_called_with(
            "collection_id", _COL_ID
        )

    def test_cascada_elimina_document_texts(self):
        mock_client, tables = _make_client()
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        tables["document_texts"].delete.return_value.eq.assert_called_with(
            "collection_id", _COL_ID
        )
        tables["document_texts"].delete.return_value.eq.return_value.eq.assert_called_with(
            "user_id", _USER_ID
        )

    def test_cascada_elimina_documents(self):
        mock_client, tables = _make_client()
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        tables["documents"].delete.return_value.eq.assert_called_with(
            "collection_id", _COL_ID
        )
        tables["documents"].delete.return_value.eq.return_value.eq.assert_called_with(
            "user_id", _USER_ID
        )

    def test_cascada_elimina_collection(self):
        mock_client, tables = _make_client()
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            delete_collection(_COL_ID, _USER_ID)

        tables["collections"].delete.return_value.eq.assert_called_with(
            "id", _COL_ID
        )
        tables["collections"].delete.return_value.eq.return_value.eq.assert_called_with(
            "user_id", _USER_ID
        )

    def test_cascada_coleccion_no_encontrada_retorna_false(self):
        mock_client, tables = _make_client(collection_row=[])
        with patch(
            "app.services.supabase_client.get_supabase_client",
            return_value=mock_client,
        ):
            from app.services.supabase_client import delete_collection
            result = delete_collection(_COL_ID, _USER_ID)

        assert result is False
        mock_client.storage.from_.return_value.remove.assert_not_called()
        tables["collections"].delete.assert_not_called()
