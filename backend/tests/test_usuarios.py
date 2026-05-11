from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.auth import get_current_user_id

MOCK_USER_ID = "auth0|testuser123"


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user_id] = lambda: MOCK_USER_ID
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def client_sin_auth():
    with TestClient(app) as c:
        yield c


# ── Eliminar cuenta ────────────────────────────────────────────────────────────


class TestEliminarCuenta:
    def test_eliminar_cuenta_exitoso(self, client):
        with patch(
            "app.api.routes.usuarios.purge_complete_user"
        ) as mock_purge:
            response = client.delete("/usuarios/me")

        assert response.status_code == 204
        mock_purge.assert_called_once_with(MOCK_USER_ID)

    def test_eliminar_sin_autenticacion_retorna_403(self, client_sin_auth):
        response = client_sin_auth.delete("/usuarios/me")
        assert response.status_code == 403

    def test_eliminar_error_interno_retorna_500(self, client):
        with patch(
            "app.api.routes.usuarios.purge_complete_user",
            side_effect=RuntimeError("fallo al borrar datos"),
        ):
            response = client.delete("/usuarios/me")

        assert response.status_code == 500
