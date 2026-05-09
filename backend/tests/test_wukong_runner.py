import subprocess
from unittest.mock import patch

from app.services import wukong_runner

MOCK_COL_ID = "11111111-2222-3333-4444-555555555555"
MOCK_USER_ID = "auth0|testuser123"


def _make_collection() -> dict:
    return {
        "id": MOCK_COL_ID,
        "user_id": MOCK_USER_ID,
        "name": "Mi colección",
        "processing_status": "idle",
    }


def _make_doc(doc_id: str, file_type: str = "txt") -> dict:
    return {
        "id": doc_id,
        "user_id": MOCK_USER_ID,
        "collection_id": MOCK_COL_ID,
        "file_type": file_type,
        "filename": f"{doc_id}.{file_type}",
        "storage_path": f"{MOCK_USER_ID}/{MOCK_COL_ID}/{doc_id}",
        "status": "uploaded",
    }


class TestExtractTexts:
    @patch("app.services.wukong_runner.process_txt_document")
    def test_todos_los_txt_ok(self, mock_process_txt):
        mock_process_txt.return_value = {"status": "ok", "document_id": "X"}
        docs = [_make_doc("doc1"), _make_doc("doc2"), _make_doc("doc3")]

        n_ok, n_err, names = wukong_runner._extract_texts(docs)

        assert n_ok == 3
        assert n_err == 0
        assert names == []
        assert mock_process_txt.call_count == 3

    @patch("app.services.wukong_runner.supabase_client.update_document_status")
    @patch("app.services.wukong_runner.process_pdf_document")
    @patch("app.services.wukong_runner.process_txt_document")
    def test_pdf_escaneado_falla_pero_continua_con_el_resto(
        self, mock_process_txt, mock_process_pdf, _mock_update_status
    ):
        # PDF 1 OK, PDF 2 escaneado (queda en error vía process_pdf_document),
        # TXT 3 OK. La extracción debe seguir tras el fallo del 2.
        mock_process_pdf.side_effect = [
            {"status": "ok", "document_id": "doc1"},
            {
                "status": "error",
                "document_id": "doc2",
                "error": "OCR no implementado — Sprint 2",
            },
        ]
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc3"}

        docs = [
            _make_doc("doc1", file_type="pdf"),
            _make_doc("doc2", file_type="pdf"),
            _make_doc("doc3", file_type="txt"),
        ]

        n_ok, n_err, names = wukong_runner._extract_texts(docs)

        assert n_ok == 2
        assert n_err == 1
        assert names == ["doc2.pdf"]
        # Crítico: las 3 funciones de extracción se invocaron, no se rompió
        # el loop ante el fallo del PDF escaneado.
        assert mock_process_pdf.call_count == 2
        assert mock_process_txt.call_count == 1

    @patch("app.services.wukong_runner.supabase_client.update_document_status")
    @patch("app.services.wukong_runner.process_txt_document")
    def test_excepcion_inesperada_marca_doc_en_error_y_sigue(
        self, mock_process_txt, mock_update_status
    ):
        # Si una de las funciones lanza una excepción no capturada
        # internamente, el runner igual la atrapa y sigue.
        mock_process_txt.side_effect = [
            {"status": "ok", "document_id": "doc1"},
            RuntimeError("supabase caída"),
            {"status": "ok", "document_id": "doc3"},
        ]
        docs = [_make_doc("doc1"), _make_doc("doc2"), _make_doc("doc3")]

        n_ok, n_err, names = wukong_runner._extract_texts(docs)

        assert n_ok == 2
        assert n_err == 1
        assert names == ["doc2.txt"]
        mock_update_status.assert_called_once()
        assert mock_update_status.call_args.kwargs["status"] == "error"
        assert "RuntimeError" in mock_update_status.call_args.kwargs["error_message"]


class TestProcessCollection:
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=2)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_happy_path_marca_graph_ready(
        self, mock_process_txt, _mock_build, _mock_run_wukong, mock_sb
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [
            _make_doc("doc1"),
            _make_doc("doc2"),
        ]
        mock_process_txt.return_value = {"status": "ok", "document_id": "X"}

        wukong_runner.process_collection(MOCK_COL_ID)

        # Debe haber pasado por: processing_text → processing_graph → graph_ready
        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert "processing_text" in statuses
        assert "processing_graph" in statuses
        assert statuses[-1] == "graph_ready"

    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=1)
    @patch("app.services.wukong_runner.process_pdf_document")
    @patch("app.services.wukong_runner.process_txt_document")
    def test_partial_error_cuando_algun_doc_falla(
        self,
        mock_process_txt,
        mock_process_pdf,
        _mock_build,
        _mock_run_wukong,
        mock_sb,
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [
            _make_doc("doc1", file_type="pdf"),
            _make_doc("doc2", file_type="txt"),
        ]
        mock_process_pdf.return_value = {
            "status": "error",
            "document_id": "doc1",
            "error": "OCR no implementado — Sprint 2",
        }
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc2"}

        wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses[-1] == "partial_error"
        final_kwargs = mock_sb.update_collection_processing_status.call_args_list[
            -1
        ].kwargs
        assert "doc1.pdf" in (final_kwargs.get("error_message") or "")

    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner.process_pdf_document")
    def test_si_todos_fallan_no_corre_wukong_y_marca_error(
        self, mock_process_pdf, mock_sb
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [
            _make_doc("doc1", file_type="pdf"),
            _make_doc("doc2", file_type="pdf"),
        ]
        mock_process_pdf.return_value = {
            "status": "error",
            "document_id": "X",
            "error": "OCR no implementado — Sprint 2",
        }

        with patch("app.services.wukong_runner._run_wukong") as mock_wukong:
            wukong_runner.process_collection(MOCK_COL_ID)
            mock_wukong.assert_not_called()

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses[-1] == "error"
        err_kwargs = mock_sb.update_collection_processing_status.call_args_list[
            -1
        ].kwargs
        msg = err_kwargs.get("error_message") or ""
        assert "doc1.pdf" in msg and "doc2.pdf" in msg

    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=1)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_falla_de_wukong_marca_coleccion_error(
        self, mock_process_txt, _mock_build, mock_sb
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [_make_doc("doc1")]
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc1"}

        with patch(
            "app.services.wukong_runner._run_wukong",
            return_value="Wukong falló (exit 1): some stderr",
        ):
            wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses[-1] == "error"


def _stub_wukong_config_path(tmp_path):
    """default.toml del submódulo no está en CI (repo privado / no clonable); los tests solo necesitan un archivo existente."""
    p = tmp_path / "wukong-default-stub.toml"
    p.write_text("# stub para tests\n", encoding="utf-8")
    return p


class TestRunWukong:
    @patch("app.services.wukong_runner.subprocess.run")
    def test_subprocess_ok_devuelve_none(self, mock_run, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        mock_run.return_value = subprocess.CompletedProcess([], 0, "", "")
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            assert wukong_runner._run_wukong(tmp_path) is None

    @patch("app.services.wukong_runner.subprocess.run")
    def test_subprocess_falla_devuelve_mensaje(self, mock_run, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        mock_run.side_effect = subprocess.CalledProcessError(
            returncode=1, cmd=[], stderr="boom"
        )
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            result = wukong_runner._run_wukong(tmp_path)
        assert result is not None
        assert "boom" in result

    @patch("app.services.wukong_runner.subprocess.run")
    def test_wukong_no_instalado_devuelve_mensaje_claro(self, mock_run, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        mock_run.side_effect = FileNotFoundError()
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            result = wukong_runner._run_wukong(tmp_path)
        assert result is not None
        assert "wukong_engine" in result.lower()
