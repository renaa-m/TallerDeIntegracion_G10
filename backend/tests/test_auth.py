from unittest.mock import AsyncMock, patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import JWTError

from app.middleware.auth import get_current_user

# App mínima de prueba — aísla el middleware sin depender de rutas reales
_test_app = FastAPI()


@_test_app.get("/test-auth")
async def _test_endpoint(user_id: str = Depends(get_current_user)):
    return {"user_id": user_id}


MOCK_USER_ID = "auth0|testuser123"
MOCK_KID = "test-kid"
MOCK_JWKS = {
    "keys": [
        {"kid": MOCK_KID, "kty": "RSA", "use": "sig", "n": "mock_n", "e": "AQAB"}
    ]
}


# ── get_current_user ───────────────────────────────────────────────────────────


class TestGetCurrentUser:
    def test_token_ausente_retorna_403(self):
        # HTTPBearer lanza 403 antes de entrar a get_current_user
        with TestClient(_test_app) as c:
            response = c.get("/test-auth")

        assert response.status_code == 403

    def test_token_formato_invalido_retorna_403(self):
        # HTTPBearer exige scheme "bearer"; "Basic" lo rechaza con 403
        with TestClient(_test_app) as c:
            response = c.get(
                "/test-auth",
                headers={"Authorization": "Basic token_no_bearer"},
            )

        assert response.status_code == 403

    def test_jwt_invalido_retorna_403(self):
        with (
            patch(
                "app.middleware.auth._get_jwks",
                new_callable=AsyncMock,
                return_value=MOCK_JWKS,
            ),
            patch(
                "app.middleware.auth.jwt.get_unverified_header",
                return_value={"kid": MOCK_KID},
            ),
            patch(
                "app.middleware.auth.jwt.decode",
                side_effect=JWTError("firma incorrecta"),
            ),
        ):
            with TestClient(_test_app) as c:
                response = c.get(
                    "/test-auth",
                    headers={"Authorization": "Bearer token.invalido.firma"},
                )

        assert response.status_code == 403

    def test_token_valido_retorna_user_id(self):
        with (
            patch(
                "app.middleware.auth._get_jwks",
                new_callable=AsyncMock,
                return_value=MOCK_JWKS,
            ),
            patch(
                "app.middleware.auth.jwt.get_unverified_header",
                return_value={"kid": MOCK_KID},
            ),
            patch(
                "app.middleware.auth.jwt.decode",
                return_value={"sub": MOCK_USER_ID},
            ),
        ):
            with TestClient(_test_app) as c:
                response = c.get(
                    "/test-auth",
                    headers={"Authorization": "Bearer token.valido.mock"},
                )

        assert response.status_code == 200
        assert response.json()["user_id"] == MOCK_USER_ID
