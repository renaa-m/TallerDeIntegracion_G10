"""Tests de la cola con Google Cloud Tasks (despacho vía Supabase + Tasks)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services import processing_queue
from app.services.processing_queue import ProcessingSlotBusyError

USER_A = "auth0|user-a"
COL_A = str(uuid4())
COL_B = str(uuid4())


class TestRequestProcess:
    def test_despacha_cuando_hay_capacidad(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._can_dispatch",
                return_value=True,
            ),
            patch(
                "app.services.processing_queue._dispatch_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_A, USER_A, bg)

        assert status == "processing_text"
        mock_dispatch.assert_called_once_with(
            collection_id=COL_A,
            user_id=USER_A,
            action="process",
            custom_data_model=None,
        )

    def test_encola_en_supabase_sin_capacidad(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._can_dispatch",
                return_value=False,
            ),
            patch(
                "app.services.processing_queue._queue_in_db",
            ) as mock_queue,
            patch(
                "app.services.processing_queue._dispatch_job",
            ) as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_A, bg)

        assert status == "queued"
        mock_queue.assert_called_once()
        mock_dispatch.assert_not_called()

    def test_rechaza_si_cola_usuario_llena(self):
        bg = MagicMock()
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_user_queued_collections",
                return_value=processing_queue.MAX_QUEUED_PER_USER,
            ),
            patch(
                "app.services.processing_queue._dispatch_job",
            ) as mock_dispatch,
            pytest.raises(ProcessingSlotBusyError),
        ):
            processing_queue.request_process(COL_B, USER_A, bg)

        mock_dispatch.assert_not_called()


class TestTryDispatchQueued:
    def test_despacha_siguiente_en_fifo(self):
        candidate = {
            "id": COL_B,
            "user_id": USER_A,
            "queue_action": "process",
            "queue_payload": None,
        }
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_active_processing_jobs",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_next_queued_jobs",
                return_value=[candidate],
            ),
            patch(
                "app.services.processing_queue.get_user_blocking_collection",
                create=True,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue._dispatch_job",
            ) as mock_dispatch,
        ):
            processing_queue._try_dispatch_queued_from_db()

        mock_dispatch.assert_called_once()

    def test_no_despacha_si_capacidad_global_llena(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.count_active_processing_jobs",
                return_value=processing_queue.MAX_CONCURRENT_JOBS,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_next_queued_jobs",
                return_value=[{"id": COL_B, "user_id": USER_A, "queue_action": "process"}],
            ),
            patch(
                "app.services.processing_queue._dispatch_job",
            ) as mock_dispatch,
        ):
            processing_queue._try_dispatch_queued_from_db()

        mock_dispatch.assert_not_called()


class TestExecuteJob:
    def test_omite_si_usuario_ocupado(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={"processing_status": "queued"},
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value={"id": COL_A, "name": "Otra"},
            ),
            patch(
                "app.services.processing_queue.wukong_runner.process_collection",
            ) as mock_run,
        ):
            result = processing_queue.execute_job(
                collection_id=COL_B,
                user_id=USER_A,
                action="process",
            )

        assert result["status"] == "skipped"
        mock_run.assert_not_called()


class TestDispatchJobFailure:
    def test_fallo_de_encolado_revierte_estado_y_lanza_dispatch_error(self):
        # Si Google Cloud Tasks no está disponible al encolar, _dispatch_job
        # revierte el estado a "error" y lanza ProcessingDispatchError para que
        # el endpoint responda 503 (en vez de un 500 crudo).
        with (
            patch("app.services.processing_queue.supabase_client") as mock_sb,
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
                side_effect=RuntimeError("Cloud Tasks no disponible"),
            ),
        ):
            with pytest.raises(processing_queue.ProcessingDispatchError):
                processing_queue._dispatch_job(
                    collection_id=COL_A,
                    user_id=USER_A,
                    action="process",
                    custom_data_model=None,
                )

        error_calls = [
            c
            for c in mock_sb.update_collection_processing_status.call_args_list
            if "error" in c.args
        ]
        assert error_calls, "debe revertir el estado a 'error' al fallar el encolado"
