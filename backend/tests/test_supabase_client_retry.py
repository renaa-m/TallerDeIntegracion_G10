"""Reintentos transitorios en supabase_client."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import supabase_client

MOCK_COL_ID = "11111111-2222-3333-4444-555555555555"


class TestRunWithRetry:
    @patch("app.services.supabase_client.time.sleep")
    def test_reintenta_read_error_y_termina_ok(self, _mock_sleep):
        fn = MagicMock(
            side_effect=[
                httpx.ReadError("[Errno 11] Resource temporarily unavailable"),
                httpx.ReadError("[Errno 11] Resource temporarily unavailable"),
                "ok",
            ]
        )
        assert supabase_client._run_with_retry(fn, context="test") == "ok"
        assert fn.call_count == 3

    @patch("app.services.supabase_client.time.sleep")
    def test_agota_reintentos_y_propaga(self, _mock_sleep):
        fn = MagicMock(
            side_effect=httpx.ReadError("[Errno 11] Resource temporarily unavailable")
        )
        with pytest.raises(httpx.ReadError):
            supabase_client._run_with_retry(fn, context="test")
        assert fn.call_count == supabase_client._SUPABASE_REQUEST_ATTEMPTS

    @patch("app.services.supabase_client.time.sleep")
    def test_no_reintenta_errores_de_negocio(self, _mock_sleep):
        fn = MagicMock(side_effect=ValueError("dato inválido"))
        with pytest.raises(ValueError):
            supabase_client._run_with_retry(fn, context="test")
        assert fn.call_count == 1


class TestGetCollectionByIdRetry:
    @patch("app.services.supabase_client.time.sleep")
    @patch("app.services.supabase_client.get_supabase_client")
    def test_get_collection_by_id_reintenta(self, mock_client_factory, _mock_sleep):
        client = MagicMock()
        mock_client_factory.return_value = client
        ok = MagicMock()
        ok.data = [{"id": MOCK_COL_ID, "processing_status": "idle"}]
        client.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
            httpx.ReadError("[Errno 11] Resource temporarily unavailable"),
            ok,
        ]

        row = supabase_client.get_collection_by_id(MOCK_COL_ID)

        assert row is not None
        assert row["id"] == MOCK_COL_ID
        assert (
            client.table.return_value.select.return_value.eq.return_value.execute.call_count
            == 2
        )
