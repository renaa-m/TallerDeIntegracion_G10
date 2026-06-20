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


class TestTryResumeStaleJob:
    def test_processing_text_parcial_no_reencola_en_polling(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={
                    "processing_status": "processing_text",
                    "queue_payload": None,
                },
            ),
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
            ) as mock_enqueue,
        ):
            ok = processing_queue.try_resume_stale_job(COL_A, USER_A)

        assert ok is False
        mock_enqueue.assert_not_called()

    def test_processing_text_parcial_reencola_process_en_recovery(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={
                    "processing_status": "processing_text",
                    "queue_payload": None,
                },
            ),
            patch(
                "app.services.processing_queue._can_dispatch",
                return_value=True,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_documents_by_collection",
                return_value=[{"id": "d1"}, {"id": "d2"}],
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_document_texts_by_collection",
                return_value=[{"document_id": "d1"}],
            ),
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
            ) as mock_enqueue,
        ):
            ok = processing_queue.try_resume_stale_job(
                COL_A, USER_A, from_startup_recovery=True
            )

        assert ok is True
        mock_enqueue.assert_called_once()
        assert mock_enqueue.call_args.kwargs["action"] == "process"

    def test_processing_text_completo_usa_continue_graph_en_recovery(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={
                    "processing_status": "processing_text",
                    "queue_payload": None,
                },
            ),
            patch(
                "app.services.processing_queue._can_dispatch",
                return_value=True,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_documents_by_collection",
                return_value=[{"id": "d1"}],
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_document_texts_by_collection",
                return_value=[{"document_id": "d1"}],
            ),
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
            ) as mock_enqueue,
        ):
            ok = processing_queue.try_resume_stale_job(
                COL_A, USER_A, from_startup_recovery=True
            )

        assert ok is True
        assert mock_enqueue.call_args.kwargs["action"] == "continue_graph"

    def test_processing_text_completo_no_reencola_en_polling(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={
                    "processing_status": "processing_text",
                    "queue_payload": None,
                },
            ),
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
            ) as mock_enqueue,
        ):
            ok = processing_queue.try_resume_stale_job(COL_A, USER_A)

        assert ok is False
        mock_enqueue.assert_not_called()


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

    def test_continue_graph_omite_si_textos_incompletos(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={"processing_status": "processing_text"},
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue.supabase_client.count_active_processing_jobs",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_documents_by_collection",
                return_value=[{"id": "d1"}, {"id": "d2"}],
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_document_texts_by_collection",
                return_value=[{"document_id": "d1"}],
            ),
            patch(
                "app.services.processing_queue.wukong_runner.process_graph_collection",
            ) as mock_graph,
        ):
            result = processing_queue.execute_job(
                collection_id=COL_A,
                user_id=USER_A,
                action="continue_graph",
            )

        assert result["status"] == "skipped"
        assert "Extracción" in result["detail"]
        mock_graph.assert_not_called()

    def test_incomplete_si_queda_en_processing_graph(self):
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                side_effect=[
                    {"processing_status": "processing_graph"},
                    {"processing_status": "processing_graph"},
                ],
            ),
            patch(
                "app.services.processing_queue.supabase_client.get_user_blocking_collection",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue.supabase_client.count_active_processing_jobs",
                return_value=0,
            ),
            patch(
                "app.services.processing_queue._text_extraction_complete",
                return_value=True,
            ),
            patch(
                "app.services.processing_queue.supabase_client.clear_collection_queue_metadata",
            ),
            patch(
                "app.services.processing_queue.supabase_client.update_collection_processing_status",
            ),
            patch(
                "app.services.processing_queue.wukong_runner.process_graph_collection",
            ),
            patch(
                "app.services.processing_queue._try_dispatch_queued_from_db",
            ),
        ):
            result = processing_queue.execute_job(
                collection_id=COL_A,
                user_id=USER_A,
                action="continue_graph",
            )

        assert result["status"] == "incomplete"
        assert processing_queue.should_retry_cloud_task(result)


class TestShouldRetryCloudTask:
    def test_reintenta_capacidad_llena(self):
        assert processing_queue.should_retry_cloud_task(
            {"status": "skipped", "detail": "Capacidad global llena."}
        )

    def test_no_reintenta_cancelada(self):
        assert not processing_queue.should_retry_cloud_task(
            {"status": "skipped", "detail": "Colección cancelada."}
        )


class TestEnsureCollectionProcessing:
    def test_polling_no_reencola_stale_jobs(self):
        with (
            patch(
                "app.services.processing_queue.try_resume_stale_job",
            ) as mock_resume,
            patch(
                "app.services.processing_queue._try_dispatch_queued_from_db",
            ) as mock_dispatch,
        ):
            processing_queue.ensure_collection_processing(COL_A, USER_A)

        mock_resume.assert_not_called()
        mock_dispatch.assert_called_once()
