from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user

MOCK_USER_ID = "auth0|testuser123"
MOCK_COLECCION_ID = uuid4()
MOCK_DOC_ID = uuid4()
safe_user_id = MOCK_USER_ID.replace("|", "_")
MOCK_DOC = {
    "id": str(MOCK_DOC_ID),
    "user_id": MOCK_USER_ID,
    "collection_id": str(MOCK_COLECCION_ID),
    "filename": "test.pdf",
    "file_type": "pdf",
    "file_size_bytes": 1024,
    "status": "uploaded",
    "error_message": None,
    "sha256_hash": None,
    "storage_path": f"{safe_user_id}/{MOCK_COLECCION_ID}/{MOCK_DOC_ID}",
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


# ── Upload ─────────────────────────────────────────────────────────────────────


class TestUploadDocumento:
    @pytest.fixture(autouse=True)
    def mock_coleccion(self):
        with patch(
            "app.api.routes.documentos.supabase_client.get_collection_by_id"
        ) as mock:
            mock.return_value = {"user_id": MOCK_USER_ID}
            yield mock

    @pytest.fixture(autouse=True)
    def mock_find_hash(self):
        with patch(
            "app.api.routes.documentos.supabase_client.find_document_by_hash",
            new_callable=AsyncMock,
            return_value=None,
        ) as mock:
            yield mock

    def test_upload_pdf_exitoso(self, client):
        with (
            patch(
                "app.api.routes.documentos.supabase_client.upload_file",
                new_callable=AsyncMock,
            ),
            patch(
                "app.api.routes.documentos.supabase_client.insert_document",
                new_callable=AsyncMock,
                return_value=MOCK_DOC,
            ),
        ):
            response = client.post(
                f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
                files={
                    "file": ("informe.pdf", b"%PDF-1.4 contenido", "application/pdf")
                },
            )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "uploaded"
        assert data["file_type"] == "pdf"

    def test_upload_txt_exitoso(self, client):
        with (
            patch(
                "app.api.routes.documentos.supabase_client.upload_file",
                new_callable=AsyncMock,
            ),
            patch(
                "app.api.routes.documentos.supabase_client.insert_document",
                new_callable=AsyncMock,
                return_value={**MOCK_DOC, "file_type": "txt", "filename": "notas.txt"},
            ),
        ):
            response = client.post(
                f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
                files={
                    "file": ("notas.txt", b"contenido de texto plano", "text/plain")
                },
            )

        assert response.status_code == 201
        assert response.json()["file_type"] == "txt"

    def test_upload_formato_invalido_muestra_formatos_aceptados(self, client):
        response = client.post(
            f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
            files={"file": ("imagen.png", b"\x89PNG...", "image/png")},
        )

        assert response.status_code == 422
        detalle = response.json()["detail"]
        assert ".png" in detalle
        assert "PDF" in detalle
        assert "TXT" in detalle

    def test_upload_sin_extension_muestra_error_claro(self, client):
        response = client.post(
            f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
            files={
                "file": (
                    "archivo_sin_extension",
                    b"contenido",
                    "application/octet-stream",
                )
            },
        )

        assert response.status_code == 422
        assert "sin extensión" in response.json()["detail"]

    def test_upload_archivo_supera_50mb(self, client):
        contenido_grande = b"x" * (51 * 1024 * 1024)
        response = client.post(
            f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
            files={"file": ("grande.pdf", contenido_grande, "application/pdf")},
        )

        assert response.status_code == 422
        assert "50 MB" in response.json()["detail"]

    def test_upload_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post(
            f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
            files={"file": ("doc.pdf", b"contenido", "application/pdf")},
        )

        assert response.status_code == 403

    def test_upload_llama_storage_y_db(self, client):
        with (
            patch(
                "app.api.routes.documentos.supabase_client.upload_file",
                new_callable=AsyncMock,
            ) as mock_upload,
            patch(
                "app.api.routes.documentos.supabase_client.insert_document",
                new_callable=AsyncMock,
                return_value=MOCK_DOC,
            ) as mock_insert,
        ):
            client.post(
                f"/api/documentos/upload?coleccion_id={MOCK_COLECCION_ID}",
                files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
            )

        mock_upload.assert_called_once()
        mock_insert.assert_called_once()
        ruta_llamada = mock_upload.call_args[0][0]
        safe_user_id = MOCK_USER_ID.replace("|", "_")
        assert ruta_llamada.startswith(safe_user_id)


# ── Listar ─────────────────────────────────────────────────────────────────────


class TestListarDocumentos:
    def test_listar_retorna_lista(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.list_documents",
            new_callable=AsyncMock,
            return_value=[MOCK_DOC],
        ):
            response = client.get("/api/documentos")

        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_listar_filtra_por_coleccion(self, client):
        coleccion_id = uuid4()
        with patch(
            "app.api.routes.documentos.supabase_client.list_documents",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_listar:
            client.get(f"/api/documentos?coleccion_id={coleccion_id}")

        mock_listar.assert_called_once_with(MOCK_USER_ID, str(coleccion_id))

    def test_listar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.get("/api/documentos")
        assert response.status_code == 403


# ── Obtener ────────────────────────────────────────────────────────────────────


class TestObtenerDocumento:
    def test_obtener_documento_existente(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.get_document",
            new_callable=AsyncMock,
            return_value=MOCK_DOC,
        ):
            response = client.get(f"/api/documentos/{MOCK_DOC_ID}")

        assert response.status_code == 200
        assert response.json()["id"] == str(MOCK_DOC_ID)

    def test_obtener_documento_no_encontrado_retorna_404(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.get_document",
            new_callable=AsyncMock,
            return_value=None,
        ):
            response = client.get(f"/api/documentos/{uuid4()}")

        assert response.status_code == 404

    def test_obtener_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.get(f"/api/documentos/{MOCK_DOC_ID}")
        assert response.status_code == 403


# ── Batch Upload ────────────────────────────────────────────────────────────────


class TestBatchUploadDocumentos:
    @pytest.fixture(autouse=True)
    def mock_coleccion(self):
        with patch(
            "app.api.routes.documentos.supabase_client.get_collection_by_id"
        ) as mock:
            mock.return_value = {"user_id": MOCK_USER_ID}
            yield mock

    @pytest.fixture(autouse=True)
    def mock_find_hash(self):
        with patch(
            "app.api.routes.documentos.supabase_client.find_document_by_hash",
            new_callable=AsyncMock,
            return_value=None,
        ) as mock:
            yield mock

    def test_todos_los_archivos_suben_exitosamente(self, client):
        with (
            patch(
                "app.api.routes.documentos.supabase_client.upload_file",
                new_callable=AsyncMock,
            ),
            patch(
                "app.api.routes.documentos.supabase_client.insert_document",
                new_callable=AsyncMock,
                return_value=MOCK_DOC,
            ),
        ):
            response = client.post(
                f"/api/documentos/upload/batch?coleccion_id={MOCK_COLECCION_ID}",
                files=[("files", ("doc.pdf", b"%PDF-1.4 contenido", "application/pdf"))],
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["exitos"]) == 1
        assert data["exitos"][0]["filename"] == "doc.pdf"
        assert data["duplicados"] == []
        assert data["fallidos"] == []

    def test_archivo_duplicado_se_reporta_como_duplicado(self, client):
        with patch(
            "app.api.routes.documentos.supabase_client.find_document_by_hash",
            new_callable=AsyncMock,
            return_value=MOCK_DOC,
        ):
            response = client.post(
                f"/api/documentos/upload/batch?coleccion_id={MOCK_COLECCION_ID}",
                files=[("files", ("test.pdf", b"%PDF-1.4 contenido", "application/pdf"))],
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["duplicados"]) == 1
        assert data["duplicados"][0]["filename"] == "test.pdf"
        assert data["exitos"] == []
        assert data["fallidos"] == []

    def test_archivo_formato_invalido_se_reporta_como_fallido(self, client):
        response = client.post(
            f"/api/documentos/upload/batch?coleccion_id={MOCK_COLECCION_ID}",
            files=[("files", ("imagen.png", b"\x89PNG...", "image/png"))],
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["fallidos"]) == 1
        assert data["fallidos"][0]["filename"] == "imagen.png"
        assert data["exitos"] == []
        assert data["duplicados"] == []

    def test_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.post(
            f"/api/documentos/upload/batch?coleccion_id={MOCK_COLECCION_ID}",
            files=[("files", ("doc.pdf", b"contenido", "application/pdf"))],
        )

        assert response.status_code == 403
