"""Tests del slot de procesamiento (sin cola)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services import processing_queue
from app.services.processing_queue import ProcessingSlotBusyError

USER_ID = "auth0|test-user"
COL_A = str(uuid4())
COL_B = str(uuid4())
BLOCKING = {"id": COL_A, "name": "Colección A", "processing_status": "processing_text"}


class TestProcessingQueue:
    def test_request_process_inicia_cuando_slot_libre(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue._find_in_memory_blocker",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ) as mock_upd,
            patch(
                "app.services.processing_queue._dispatch_process_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_ID, bg)

        assert status == "processing_text"
        mock_upd.assert_called_once_with(COL_B, "processing_text")
        mock_dispatch.assert_called_once_with(COL_B, None)

    def test_request_process_lanza_si_slot_ocupado(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=BLOCKING,
            ),
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ) as mock_upd,
            patch(
                "app.services.processing_queue._dispatch_process_job",
            ) as mock_dispatch,
        ):
            with pytest.raises(ProcessingSlotBusyError) as exc_info:
                processing_queue.request_process(COL_B, USER_ID, bg)

        assert exc_info.value.blocking["name"] == "Colección A"
        mock_upd.assert_not_called()
        mock_dispatch.assert_not_called()

    def test_request_continue_graph_excluye_la_misma_coleccion(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=None,
            ) as mock_blocking,
            patch(
                "app.services.processing_queue._find_in_memory_blocker",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ) as mock_upd,
            patch(
                "app.services.processing_queue._dispatch_continue_graph_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_continue_graph(COL_A, USER_ID, bg)

        assert status == "processing_graph"
        mock_blocking.assert_called_once_with(
            USER_ID,
            exclude_collection_id=COL_A,
        )
        mock_upd.assert_called_once_with(COL_A, "processing_graph")
        mock_dispatch.assert_called_once_with(COL_A)

    def test_drain_user_queue_limpia_legacy_queued(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
                return_value=[{"id": COL_B, "user_id": USER_ID}],
            ),
            patch(
                "app.services.processing_queue.supabase_client.clear_collection_queue_metadata",
            ) as mock_clear,
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ) as mock_upd,
        ):
            processing_queue.drain_user_queue(USER_ID)

        mock_clear.assert_called_once_with(COL_B)
        mock_upd.assert_called_once_with(COL_B, "idle", error_message="")

    def test_drain_for_collection_es_noop(self):
        processing_queue.drain_for_collection(COL_A)

    def test_busy_detail_message_incluye_nombre(self):
        msg = processing_queue.busy_detail_message(BLOCKING)
        assert "Colección A" in msg
        assert "Se está procesando" in msg
