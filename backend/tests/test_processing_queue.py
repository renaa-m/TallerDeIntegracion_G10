"""Tests de la cola de procesamiento multi-usuario."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services import processing_queue
from app.services.processing_queue import ProcessingSlotBusyError

USER_A = "auth0|user-a"
USER_B = "auth0|user-b"
COL_A = str(uuid4())
COL_B = str(uuid4())
COL_C = str(uuid4())
BLOCKING = {"id": COL_A, "name": "Colección A", "processing_status": "processing_text"}


# ──────────────────────────────────────────────────────────────────────────────
# request_process
# ──────────────────────────────────────────────────────────────────────────────

class TestRequestProcess:
    def test_inicia_cuando_slot_libre(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_A, bg)

        assert status == "processing_text"
        mock_upd.assert_called_once_with(COL_B, "processing_text")
        mock_dispatch.assert_called_once_with(COL_B, None, user_id=USER_A)

    def test_encola_cuando_usuario_ocupado(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value={USER_A}),
            patch("app.services.processing_queue._active_job_count", return_value=1),
            patch("app.services.processing_queue.supabase_client.set_collection_queued") as mock_enqueue,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_A, bg)

        assert status == "queued"
        mock_enqueue.assert_called_once_with(COL_B, "process", payload=None)
        mock_dispatch.assert_not_called()

    def test_encola_cuando_global_lleno(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue._active_job_count", return_value=processing_queue.MAX_CONCURRENT_JOBS),
            patch("app.services.processing_queue.supabase_client.set_collection_queued") as mock_enqueue,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            status = processing_queue.request_process(COL_B, USER_A, bg)

        assert status == "queued"
        mock_enqueue.assert_called_once()
        mock_dispatch.assert_not_called()

    def test_encola_con_custom_model_en_payload(self):
        bg = MagicMock()
        custom = {"entities": [{"name": "Persona"}]}
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value={USER_A}),
            patch("app.services.processing_queue._active_job_count", return_value=1),
            patch("app.services.processing_queue.supabase_client.set_collection_queued") as mock_enqueue,
            patch("app.services.processing_queue._dispatch_process_job"),
        ):
            status = processing_queue.request_process(COL_B, USER_A, bg, custom_data_model=custom)

        assert status == "queued"
        mock_enqueue.assert_called_once_with(
            COL_B, "process", payload={"custom_data_model": custom}
        )

    def test_lanza_si_cola_llena(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections",
                  return_value=processing_queue.MAX_QUEUED_PER_USER),
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            with pytest.raises(ProcessingSlotBusyError):
                processing_queue.request_process(COL_B, USER_A, bg)

        mock_upd.assert_not_called()
        mock_dispatch.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# request_continue_graph
# ──────────────────────────────────────────────────────────────────────────────

class TestRequestContinueGraph:
    def test_inicia_cuando_slot_libre(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_continue_graph_job") as mock_dispatch,
        ):
            status = processing_queue.request_continue_graph(COL_A, USER_A, bg)

        assert status == "processing_graph"
        mock_upd.assert_called_once_with(COL_A, "processing_graph")
        mock_dispatch.assert_called_once_with(COL_A, None, user_id=USER_A)

    def test_encola_cuando_usuario_tiene_otro_job(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value={USER_A}),
            patch("app.services.processing_queue._active_job_count", return_value=1),
            patch("app.services.processing_queue.supabase_client.set_collection_queued") as mock_enqueue,
            patch("app.services.processing_queue._dispatch_continue_graph_job") as mock_dispatch,
        ):
            status = processing_queue.request_continue_graph(COL_A, USER_A, bg)

        assert status == "queued"
        mock_enqueue.assert_called_once_with(COL_A, "continue_graph", payload=None)
        mock_dispatch.assert_not_called()

    def test_lanza_si_cola_llena(self):
        bg = MagicMock()
        with (
            patch("app.services.processing_queue.supabase_client.count_user_queued_collections",
                  return_value=processing_queue.MAX_QUEUED_PER_USER),
        ):
            with pytest.raises(ProcessingSlotBusyError):
                processing_queue.request_continue_graph(COL_A, USER_A, bg)


# ──────────────────────────────────────────────────────────────────────────────
# _try_dequeue_next  (corazón de la cola)
# ──────────────────────────────────────────────────────────────────────────────

class TestTryDequeueNext:
    def test_no_hace_nada_si_global_lleno(self):
        with (
            patch("app.services.processing_queue._active_job_count",
                  return_value=processing_queue.MAX_CONCURRENT_JOBS),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs") as mock_get,
        ):
            processing_queue._try_dequeue_next()

        mock_get.assert_not_called()

    def test_no_hace_nada_si_no_hay_candidatos(self):
        with (
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs", return_value=[]),
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        mock_dispatch.assert_not_called()

    def test_despacha_job_process_del_primer_candidato_disponible(self):
        candidate = {
            "id": COL_A,
            "user_id": USER_A,
            "queue_action": "process",
            "queue_payload": None,
        }
        with (
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs", return_value=[candidate]),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata") as mock_clear,
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        mock_clear.assert_called_once_with(COL_A)
        mock_upd.assert_called_once_with(COL_A, "processing_text")
        mock_dispatch.assert_called_once_with(COL_A, None, user_id=USER_A)

    def test_despacha_job_continue_graph(self):
        candidate = {
            "id": COL_A,
            "user_id": USER_A,
            "queue_action": "continue_graph",
            "queue_payload": None,
        }
        with (
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs", return_value=[candidate]),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata"),
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_continue_graph_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        mock_upd.assert_called_once_with(COL_A, "processing_graph")
        mock_dispatch.assert_called_once_with(COL_A, None, user_id=USER_A)

    def test_pasa_custom_model_desde_payload(self):
        custom = {"entities": [{"name": "Persona"}]}
        candidate = {
            "id": COL_A,
            "user_id": USER_A,
            "queue_action": "process",
            "queue_payload": {"custom_data_model": custom},
        }
        with (
            patch("app.services.processing_queue._active_job_count", return_value=0),
            patch("app.services.processing_queue._users_with_active_jobs", return_value=set()),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs", return_value=[candidate]),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata"),
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status"),
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        mock_dispatch.assert_called_once_with(COL_A, custom, user_id=USER_A)

    def test_salta_candidato_con_usuario_ocupado_y_despacha_el_siguiente(self):
        """Si el primer candidato pertenece a un usuario con job activo,
        debe saltar al siguiente candidato de otro usuario."""
        candidate_a = {"id": COL_A, "user_id": USER_A, "queue_action": "process", "queue_payload": None}
        candidate_b = {"id": COL_B, "user_id": USER_B, "queue_action": "process", "queue_payload": None}
        with (
            patch("app.services.processing_queue._active_job_count", return_value=1),
            patch("app.services.processing_queue._users_with_active_jobs", return_value={USER_A}),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs",
                  return_value=[candidate_a, candidate_b]),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata") as mock_clear,
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        # Solo debe despachar el candidato de USER_B
        mock_clear.assert_called_once_with(COL_B)
        mock_upd.assert_called_once_with(COL_B, "processing_text")
        mock_dispatch.assert_called_once_with(COL_B, None, user_id=USER_B)

    def test_no_hace_nada_si_todos_los_candidatos_tienen_usuario_ocupado(self):
        candidate_a = {"id": COL_A, "user_id": USER_A, "queue_action": "process", "queue_payload": None}
        candidate_b = {"id": COL_B, "user_id": USER_A, "queue_action": "process", "queue_payload": None}
        with (
            patch("app.services.processing_queue._active_job_count", return_value=1),
            patch("app.services.processing_queue._users_with_active_jobs", return_value={USER_A}),
            patch("app.services.processing_queue.supabase_client.get_next_queued_jobs",
                  return_value=[candidate_a, candidate_b]),
            patch("app.services.processing_queue._dispatch_process_job") as mock_dispatch,
        ):
            processing_queue._try_dequeue_next()

        mock_dispatch.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# recover_orphaned_processing
# ──────────────────────────────────────────────────────────────────────────────

class TestRecoverOrphanedProcessing:
    def test_jobs_activos_se_resetean_a_idle(self):
        stale = [
            {"id": COL_A, "processing_status": "processing_text"},
            {"id": COL_B, "processing_status": "processing_graph"},
        ]
        with (
            patch("app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
                  return_value=stale),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata") as mock_clear,
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._try_dequeue_next"),
        ):
            processing_queue.recover_orphaned_processing()

        assert mock_clear.call_count == 2
        calls = mock_upd.call_args_list
        statuses = [c.args[1] for c in calls]
        assert all(s == "idle" for s in statuses)

    def test_jobs_queued_no_se_resetean(self):
        stale = [{"id": COL_C, "processing_status": "queued"}]
        with (
            patch("app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
                  return_value=stale),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata") as mock_clear,
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
            patch("app.services.processing_queue._try_dequeue_next"),
        ):
            processing_queue.recover_orphaned_processing()

        mock_clear.assert_not_called()
        mock_upd.assert_not_called()

    def test_llama_try_dequeue_tras_recovery(self):
        with (
            patch("app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
                  return_value=[]),
            patch("app.services.processing_queue._try_dequeue_next") as mock_dequeue,
        ):
            processing_queue.recover_orphaned_processing()

        mock_dequeue.assert_called_once()

    def test_error_de_db_no_propaga(self):
        with patch(
            "app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
            side_effect=Exception("DB error"),
        ):
            processing_queue.recover_orphaned_processing()


# ──────────────────────────────────────────────────────────────────────────────
# _run_process_job — dequeue en finally
# ──────────────────────────────────────────────────────────────────────────────

class TestRunJobDequeue:
    def test_run_process_llama_dequeue_al_terminar(self):
        with (
            patch("app.services.processing_queue.wukong_runner.process_collection"),
            patch("app.services.processing_queue._try_dequeue_next") as mock_dequeue,
        ):
            processing_queue._run_process_job(COL_A, USER_A)

        mock_dequeue.assert_called_once()

    def test_run_process_llama_dequeue_aunque_falle(self):
        with (
            patch("app.services.processing_queue.wukong_runner.process_collection",
                  side_effect=Exception("fallo")),
            patch("app.services.processing_queue._try_dequeue_next") as mock_dequeue,
        ):
            processing_queue._run_process_job(COL_A, USER_A)

        mock_dequeue.assert_called_once()

    def test_run_continue_graph_llama_dequeue_al_terminar(self):
        with (
            patch("app.services.processing_queue.wukong_runner.process_graph_collection"),
            patch("app.services.processing_queue._try_dequeue_next") as mock_dequeue,
        ):
            processing_queue._run_continue_graph_job(COL_A, USER_A)

        mock_dequeue.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# Compatibilidad / utilidades
# ──────────────────────────────────────────────────────────────────────────────

class TestCompatibilidad:
    def test_drain_user_queue_limpia_legacy_queued(self):
        with (
            patch("app.services.processing_queue.supabase_client.list_collections_by_processing_statuses",
                  return_value=[{"id": COL_B, "user_id": USER_A}]),
            patch("app.services.processing_queue.supabase_client.clear_collection_queue_metadata") as mock_clear,
            patch("app.services.processing_queue.supabase_client.update_collection_processing_status") as mock_upd,
        ):
            processing_queue.drain_user_queue(USER_A)

        mock_clear.assert_called_once_with(COL_B)
        mock_upd.assert_called_once_with(COL_B, "idle", error_message="")

    def test_drain_for_collection_es_noop(self):
        processing_queue.drain_for_collection(COL_A)

    def test_busy_detail_message_incluye_nombre(self):
        msg = processing_queue.busy_detail_message(BLOCKING)
        assert "Colección A" in msg
