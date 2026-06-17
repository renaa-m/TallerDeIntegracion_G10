"""Tests de la cola de procesamiento multi-usuario."""

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
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._users_with_active_jobs",
                return_value=set(),
            ),
            patch(
                "app.services.processing_queue._active_job_count",
                return_value=0,
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
        mock_dispatch.assert_called_once_with(COL_B, None, user_id=USER_ID)

    def test_request_process_encola_cuando_usuario_ocupado(self):
        """Si el usuario ya tiene un job activo, la colección se encola."""
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._users_with_active_jobs",
                return_value={USER_ID},
            ),
            patch(
                "app.services.processing_queue._active_job_count",
                return_value=1,
            ),
            patch(
                "app.services.processing_queue.supabase_client.set_collection_queued",
            ) as mock_enqueue,
            patch(
                "app.services.processing_queue._dispatch_process_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_ID, bg)

        assert status == "queued"
        mock_enqueue.assert_called_once_with(COL_B, "process", payload=None)
        mock_dispatch.assert_not_called()

    def test_request_process_encola_cuando_global_lleno(self):
        """Si el límite global está lleno, la colección se encola aunque el usuario esté libre."""
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._users_with_active_jobs",
                return_value=set(),
            ),
            patch(
                "app.services.processing_queue._active_job_count",
                return_value=processing_queue.MAX_CONCURRENT_JOBS,
            ),
            patch(
                "app.services.processing_queue.supabase_client.set_collection_queued",
            ) as mock_enqueue,
            patch(
                "app.services.processing_queue._dispatch_process_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_ID, bg)

        assert status == "queued"
        mock_enqueue.assert_called_once()
        mock_dispatch.assert_not_called()

    def test_request_process_lanza_si_cola_llena(self):
        """Si el usuario ya tiene MAX_QUEUED_PER_USER colecciones encoladas, lanza error."""
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=processing_queue.MAX_QUEUED_PER_USER,
            ),
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ) as mock_upd,
            patch(
                "app.services.processing_queue._dispatch_process_job",
            ) as mock_dispatch,
        ):
            with pytest.raises(ProcessingSlotBusyError):
                processing_queue.request_process(COL_B, USER_ID, bg)

        mock_upd.assert_not_called()
        mock_dispatch.assert_not_called()

    def test_request_continue_graph_inicia_cuando_slot_libre(self):
        """continue_graph arranca inmediatamente si hay capacidad."""
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._users_with_active_jobs",
                return_value=set(),
            ),
            patch(
                "app.services.processing_queue._active_job_count",
                return_value=0,
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
        mock_upd.assert_called_once_with(COL_A, "processing_graph")
        mock_dispatch.assert_called_once_with(COL_A, None, user_id=USER_ID)

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
