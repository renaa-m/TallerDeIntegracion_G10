"""Tests de la cola con Google Cloud Tasks (despacho vía Supabase + Tasks)."""

from contextlib import ExitStack
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


class TestExecuteJobResumeExtraction:
    """Reintento de Cloud Tasks con la extracción a medias.

    Si una tarea ``process`` se re-ejecuta mientras solo algunos documentos
    tienen texto, NO debe saltar al grafo: debe reanudar la extracción con
    ``process_collection`` (idempotente) para que terminen TODOS antes de Wukong.
    """

    def _run_execute_job(self, *, status: str, texts):
        """Corre execute_job con todo Supabase mockeado y devuelve los dos mocks
        del runner: (process_collection, process_graph_collection)."""
        with ExitStack() as stack:
            sb = "app.services.processing_queue.supabase_client."
            stack.enter_context(patch(
                sb + "get_collection",
                return_value={"processing_status": status},
            ))
            stack.enter_context(patch(
                sb + "get_user_blocking_collection", return_value=None,
            ))
            stack.enter_context(patch(
                sb + "count_active_processing_jobs", return_value=1,
            ))
            stack.enter_context(patch(sb + "clear_collection_queue_metadata"))
            stack.enter_context(patch(sb + "update_collection_processing_status"))
            stack.enter_context(patch(
                sb + "get_document_texts_by_collection", return_value=texts,
            ))
            stack.enter_context(patch(
                "app.services.processing_queue._try_dispatch_queued_from_db",
            ))
            mock_full = stack.enter_context(patch(
                "app.services.processing_queue.wukong_runner.process_collection",
            ))
            mock_graph = stack.enter_context(patch(
                "app.services.processing_queue.wukong_runner.process_graph_collection",
            ))
            processing_queue.execute_job(
                collection_id=COL_A,
                user_id=USER_A,
                action="process",
            )
        return mock_full, mock_graph

    def test_processing_text_con_textos_parciales_reanuda_extraccion(self):
        # Había un texto extraído pero faltan otros: NO debe ir directo al grafo.
        mock_full, mock_graph = self._run_execute_job(
            status="processing_text",
            texts=[{"document_id": "doc-1", "extracted_text": "hola"}],
        )
        mock_full.assert_called_once()
        mock_graph.assert_not_called()

    def test_processing_graph_va_directo_al_grafo(self):
        # La extracción ya terminó en una corrida previa: solo (re)arma el grafo.
        mock_full, mock_graph = self._run_execute_job(
            status="processing_graph", texts=[],
        )
        mock_graph.assert_called_once()
        mock_full.assert_not_called()


class TestResumeStaleJob:
    def test_processing_text_reencola_como_process_no_continue_graph(self):
        # Tras reinicio, una colección en processing_text con algún texto debe
        # re-encolarse como "process" (reanuda extracción), no "continue_graph".
        with (
            patch(
                "app.services.processing_queue.supabase_client.get_collection",
                return_value={"processing_status": "processing_text"},
            ),
            patch(
                "app.services.processing_queue._can_dispatch",
                return_value=True,
            ),
            patch(
                "app.services.processing_queue._custom_model_from_row",
                return_value=None,
            ),
            patch(
                "app.services.processing_queue._enqueue_cloud_task",
            ) as mock_enqueue,
        ):
            resumed = processing_queue.try_resume_stale_job(COL_A, USER_A)

        assert resumed is True
        assert mock_enqueue.call_args.kwargs["action"] == "process"
