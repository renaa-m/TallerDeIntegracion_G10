from unittest.mock import MagicMock, patch

import pytest

from app.services.delete_user import purge_complete_user

MOCK_USER_ID = "auth0|testuser123"
MOCK_ACCESS_TOKEN = "mock_management_api_token"


class TestPurgeCompleteUser:
    @patch("app.services.delete_user.create_client")
    @patch("app.services.delete_user.Auth0")
    @patch("app.services.delete_user.GetToken")
    def test_happy_path_ejecuta_todos_los_pasos(
        self, mock_get_token_cls, mock_auth0_cls, mock_create_client
    ):
        mock_get_token_cls.return_value.client_credentials.return_value = {
            "access_token": MOCK_ACCESS_TOKEN
        }
        mock_auth0 = MagicMock()
        mock_auth0_cls.return_value = mock_auth0
        mock_supabase = MagicMock()
        mock_create_client.return_value = mock_supabase

        result = purge_complete_user(MOCK_USER_ID)

        assert result == {"status": "success", "user_id": MOCK_USER_ID}
        mock_auth0.users.delete.assert_called_once_with(MOCK_USER_ID)
        mock_supabase.table.assert_called_once_with("collections")

    @patch("app.services.delete_user.create_client")
    @patch("app.services.delete_user.Auth0")
    @patch("app.services.delete_user.GetToken")
    def test_error_en_auth0_delete_propaga_excepcion(
        self, mock_get_token_cls, mock_auth0_cls, mock_create_client
    ):
        mock_get_token_cls.return_value.client_credentials.return_value = {
            "access_token": MOCK_ACCESS_TOKEN
        }
        mock_auth0 = MagicMock()
        mock_auth0.users.delete.side_effect = RuntimeError("Auth0 no disponible")
        mock_auth0_cls.return_value = mock_auth0
        mock_create_client.return_value = MagicMock()

        with pytest.raises(RuntimeError, match="Auth0 no disponible"):
            purge_complete_user(MOCK_USER_ID)

    @patch("app.services.delete_user.create_client")
    @patch("app.services.delete_user.Auth0")
    @patch("app.services.delete_user.GetToken")
    def test_error_en_supabase_propaga_excepcion(
        self, mock_get_token_cls, mock_auth0_cls, mock_create_client
    ):
        mock_get_token_cls.return_value.client_credentials.return_value = {
            "access_token": MOCK_ACCESS_TOKEN
        }
        mock_auth0_cls.return_value = MagicMock()
        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .delete.return_value
            .eq.return_value
            .execute.side_effect
        ) = RuntimeError("Supabase no disponible")
        mock_create_client.return_value = mock_supabase

        with pytest.raises(RuntimeError, match="Supabase no disponible"):
            purge_complete_user(MOCK_USER_ID)
