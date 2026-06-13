import json
from unittest.mock import patch

import pytest

from app.services import wukong_runner

MOCK_COL_ID = "11111111-2222-3333-4444-555555555555"
MOCK_USER_ID = "auth0|testuser123"
MOCK_DOC_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _make_collection() -> dict:
    return {
        "id": MOCK_COL_ID,
        "user_id": MOCK_USER_ID,
        "name": "Mi colección",
        "processing_status": "processing_text",
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


class TestProcessCollectionCancelled:
    @patch("app.services.wukong_runner.supabase_client")
    def test_coleccion_ya_cancelada_no_procesa(self, mock_sb):
        mock_sb.get_collection_by_id.return_value = {
            "id": MOCK_COL_ID,
            "user_id": MOCK_USER_ID,
            "name": "c",
            "processing_status": "cancelled",
        }
        wukong_runner.process_collection(MOCK_COL_ID)
        mock_sb.get_documents_by_collection.assert_not_called()
        mock_sb.update_collection_processing_status.assert_not_called()


class TestProcessCollection:
    @patch("app.services.wukong_runner.export_qm_to_supabase", return_value=None)
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=2)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_happy_path_marca_graph_ready(
        self, mock_process_txt, _mock_build, _mock_run_wukong, mock_sb, _mock_qm
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [
            _make_doc("doc1"),
            _make_doc("doc2"),
        ]
        mock_process_txt.return_value = {"status": "ok", "document_id": "X"}

        wukong_runner.process_collection(MOCK_COL_ID)

        # Debe haber pasado por: processing_graph → graph_ready (processing_text lo pone POST /process antes del worker)
        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert "processing_graph" in statuses
        assert statuses[-1] == "graph_ready"

    @patch("app.services.wukong_runner.export_qm_to_supabase", return_value=None)
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=1)
    @patch("app.services.wukong_runner.process_pdf_document")
    @patch("app.services.wukong_runner.process_txt_document")
    def test_awaiting_graph_confirmation_cuando_algun_doc_falla(
        self,
        mock_process_txt,
        mock_process_pdf,
        _mock_build,
        _mock_run_wukong,
        mock_sb,
        _mock_qm,
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
        assert statuses[-1] == "awaiting_graph_confirmation"
        final_kwargs = mock_sb.update_collection_processing_status.call_args_list[
            -1
        ].kwargs
        assert "doc1.pdf" in (final_kwargs.get("error_message") or "")
        assert "Puedes continuar" not in (final_kwargs.get("error_message") or "")
        assert "solo con 1 documento(s)" in (final_kwargs.get("error_message") or "")

        _mock_build.assert_not_called()
        _mock_run_wukong.assert_not_called()
        _mock_qm.assert_not_called()

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

    @patch("app.services.wukong_runner.export_qm_to_supabase", return_value=None)
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=1)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_falla_de_wukong_marca_coleccion_error(
        self, mock_process_txt, _mock_build, mock_sb, _mock_qm
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

    @patch("app.services.wukong_runner.supabase_client")
    def test_coleccion_no_encontrada_retorna_sin_procesar(self, mock_sb):
        mock_sb.get_collection_by_id.return_value = None

        wukong_runner.process_collection(MOCK_COL_ID)

        mock_sb.get_documents_by_collection.assert_not_called()
        mock_sb.update_collection_processing_status.assert_not_called()

    @patch("app.services.wukong_runner.supabase_client")
    def test_coleccion_sin_documentos_marca_error(self, mock_sb):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = []

        wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses[-1] == "error"
        err_kwargs = mock_sb.update_collection_processing_status.call_args_list[-1].kwargs
        assert "documentos" in (err_kwargs.get("error_message") or "")


class TestResolveGraphCompletion:
    @patch("app.services.wukong_runner.supabase_client")
    def test_partial_extraction_mensaje_exito(self, mock_sb):
        mock_sb.get_collection_by_id.return_value = {
            "text_progress_processed": 2,
            "text_failed_documents": [{"filename": "scan.pdf"}],
        }
        status, msg = wukong_runner._resolve_graph_completion(MOCK_COL_ID)
        assert status == "partial_error"
        assert "Grafo generado exitosamente con 2 documento(s)" in msg
        assert "scan.pdf" in msg

    @patch("app.services.wukong_runner.supabase_client")
    def test_sin_fallos_devuelve_graph_ready(self, mock_sb):
        mock_sb.get_collection_by_id.return_value = {
            "text_progress_processed": 3,
            "text_failed_documents": [],
        }
        status, msg = wukong_runner._resolve_graph_completion(MOCK_COL_ID)
        assert status == "graph_ready"
        assert msg == ""


class TestBuildWukongWorkdir:
    """Verifica que _build_wukong_workdir escriba el data_model.json correcto."""

    def _make_rows(self) -> list[dict]:
        return [{"document_id": MOCK_DOC_UUID, "extracted_text": "Texto de prueba."}]

    @patch("app.services.wukong_runner.supabase_client.get_document_texts_by_collection")
    def test_sin_custom_model_escribe_default(self, mock_get_texts, tmp_path):
        mock_get_texts.return_value = self._make_rows()

        wukong_runner._build_wukong_workdir(tmp_path, MOCK_COL_ID)

        written = json.loads((tmp_path / "data_model.json").read_text())
        # El default tiene Persona y Organizacion
        assert "Persona" in written["entities"]
        assert "Organizacion" in written["entities"]

    @patch("app.services.wukong_runner.supabase_client.get_document_texts_by_collection")
    def test_con_custom_model_escribe_entidades_personalizadas(self, mock_get_texts, tmp_path):
        mock_get_texts.return_value = self._make_rows()
        custom = {
            "parameters": {
                "role": "Analista",
                "context": "Docs",
                "input_language": "spanish",
                "output_language": "spanish",
                "included_documents": ["preview"],
                "included_entities": ["RangoMilitar"],
                "included_relations": [],
            },
            "entities": {
                "RangoMilitar": {
                    "description": "Grado militar",
                    "primary_key": "nombre",
                    "properties": {"nombre": {"type": "string", "description": "Nombre"}},
                }
            },
            "relations": {},
        }

        wukong_runner._build_wukong_workdir(tmp_path, MOCK_COL_ID, custom_data_model=custom)

        written = json.loads((tmp_path / "data_model.json").read_text())
        assert "RangoMilitar" in written["entities"]
        assert "Persona" not in written["entities"]

    @patch("app.services.wukong_runner.supabase_client.get_document_texts_by_collection")
    def test_custom_model_siempre_fuerza_included_documents_a_preview(
        self, mock_get_texts, tmp_path
    ):
        mock_get_texts.return_value = self._make_rows()
        # El usuario envía "full" — el runner debe corregirlo a "preview"
        custom = {
            "parameters": {
                "role": "r",
                "context": "c",
                "input_language": "spanish",
                "output_language": "spanish",
                "included_documents": ["full"],  # valor incorrecto a propósito
                "included_entities": ["RangoMilitar"],
                "included_relations": [],
            },
            "entities": {
                "RangoMilitar": {
                    "description": "x",
                    "primary_key": "nombre",
                    "properties": {"nombre": {"type": "string", "description": "y"}},
                }
            },
            "relations": {},
        }

        wukong_runner._build_wukong_workdir(tmp_path, MOCK_COL_ID, custom_data_model=custom)

        written = json.loads((tmp_path / "data_model.json").read_text())
        assert written["parameters"]["included_documents"] == ["preview"]

    @patch("app.services.wukong_runner.supabase_client.get_document_texts_by_collection")
    def test_custom_model_no_muta_el_dict_original(self, mock_get_texts, tmp_path):
        mock_get_texts.return_value = self._make_rows()
        custom = {
            "parameters": {
                "role": "r", "context": "c",
                "input_language": "spanish", "output_language": "spanish",
                "included_documents": ["full"],
                "included_entities": [], "included_relations": [],
            },
            "entities": {},
            "relations": {},
        }
        original_docs = custom["parameters"]["included_documents"].copy()

        wukong_runner._build_wukong_workdir(tmp_path, MOCK_COL_ID, custom_data_model=custom)

        # El dict original no debe haber sido modificado por el deepcopy
        assert custom["parameters"]["included_documents"] == original_docs

    @patch("app.services.wukong_runner.supabase_client.get_document_texts_by_collection")
    def test_crea_archivos_txt_en_el_workdir(self, mock_get_texts, tmp_path):
        mock_get_texts.return_value = self._make_rows()

        n = wukong_runner._build_wukong_workdir(tmp_path, MOCK_COL_ID)

        assert n == 1
        txt_path = tmp_path / "docs" / "text" / "preview" / f"{MOCK_DOC_UUID}.txt"
        assert txt_path.exists()
        assert txt_path.read_text() == "Texto de prueba."


def _stub_wukong_config_path(tmp_path):
    """default.toml del submódulo no está en CI (repo privado / no clonable); los tests solo necesitan un archivo existente."""
    p = tmp_path / "wukong-default-stub.toml"
    p.write_text("# stub para tests\n", encoding="utf-8")
    return p


class TestRunWukong:
    @patch("app.services.wukong_runner.subprocess.Popen")
    def test_subprocess_ok_devuelve_none(self, mock_popen, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        process = mock_popen.return_value
        process.poll.side_effect = [0]
        process.communicate.return_value = ("", "")
        process.returncode = 0
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            assert wukong_runner._run_wukong(tmp_path) is None

    @patch("app.services.wukong_runner.subprocess.Popen")
    def test_subprocess_falla_devuelve_mensaje(self, mock_popen, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        process = mock_popen.return_value
        process.poll.side_effect = [1]
        process.communicate.return_value = ("", "boom")
        process.returncode = 1
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            result = wukong_runner._run_wukong(tmp_path)
        assert result is not None
        assert "boom" in result

    @patch("app.services.wukong_runner.subprocess.Popen")
    def test_wukong_no_instalado_devuelve_mensaje_claro(self, mock_popen, tmp_path):
        cfg = _stub_wukong_config_path(tmp_path)
        mock_popen.side_effect = FileNotFoundError()
        with patch.object(wukong_runner, "WUKONG_DEFAULT_CONFIG", cfg):
            result = wukong_runner._run_wukong(tmp_path)
        assert result is not None
        assert "wukong_engine" in result.lower()


# ── Tests para _split_into_subchunks ──────────────────────────────────────────


class TestSplitIntoSubchunks:
    def test_texto_corto_devuelve_un_solo_subchunk(self):
        text = " ".join(["palabra"] * 80)
        result = wukong_runner._split_into_subchunks(text)
        assert len(result) == 1
        assert result[0] == text

    def test_texto_exactamente_max_words_devuelve_un_solo_subchunk(self):
        text = " ".join(["x"] * 100)
        result = wukong_runner._split_into_subchunks(text)
        assert len(result) == 1

    def test_texto_largo_genera_multiples_subchunks_de_maximo_100_palabras(self):
        text = " ".join([f"p{i}" for i in range(200)])
        result = wukong_runner._split_into_subchunks(text)
        # step=85 → sub-chunks en i=0, 85, 170 → 3 sub-chunks
        assert len(result) == 3
        assert all(len(s.split()) <= 100 for s in result)

    def test_overlap_correcto_entre_subchunks_consecutivos(self):
        text = " ".join([f"w{i}" for i in range(200)])
        result = wukong_runner._split_into_subchunks(text)
        words_0 = result[0].split()
        words_1 = result[1].split()
        # Las últimas 15 palabras del sub-chunk 0 deben ser las primeras 15 del sub-chunk 1
        assert words_0[-15:] == words_1[:15]


# ── Helpers para TestGenerateAndStoreEmbeddings ────────────────────────────────


def _write_json(path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _setup_wukong_results(workdir) -> None:
    """Crea la estructura mínima de artefactos JSON que produce Wukong."""
    results = workdir / "results"
    _write_json(
        results / "entities" / "Document.json",
        [{"_ObjectId": "Document_1", "name": MOCK_DOC_UUID}],
    )
    _write_json(
        results / "entities" / "Chunk.json",
        [{"_ObjectId": "Chunk_1_1", "text": "Texto del chunk de prueba"}],
    )
    _write_json(
        results / "relations" / "ChunkOf.json",
        [{"_OriginId": "Chunk_1_1", "_TargetId": "Document_1", "chunk_number": 0}],
    )


class TestGenerateAndStoreEmbeddings:
    @patch("app.services.wukong_runner.supabase_client.save_chunk_embeddings")
    @patch("app.services.embeddings_service.generate_embeddings_batch")
    @patch("app.services.wukong_runner.supabase_client.get_documents_by_collection")
    def test_happy_path_genera_y_guarda_embeddings(
        self,
        mock_get_docs,
        mock_generate_batch,
        mock_save_chunks,
        tmp_path,
    ):
        _setup_wukong_results(tmp_path)
        mock_get_docs.return_value = [{"id": MOCK_DOC_UUID, "filename": "informe.pdf"}]
        mock_generate_batch.return_value = [[0.1] * 384]

        result = wukong_runner._generate_and_store_embeddings(tmp_path, MOCK_COL_ID)

        assert result == 1
        mock_generate_batch.assert_called_once()
        mock_save_chunks.assert_called_once()
        saved_records = mock_save_chunks.call_args[0][0]
        assert len(saved_records) == 1
        assert saved_records[0]["chunk_id"] == "Chunk_1_1"
        assert saved_records[0]["document_name"] == "informe.pdf"

    @patch("app.services.wukong_runner.supabase_client.save_chunk_embeddings")
    @patch("app.services.embeddings_service.generate_embeddings_batch")
    @patch("app.services.wukong_runner.supabase_client.get_documents_by_collection")
    def test_chunk_largo_genera_subchunks_con_chunk_id_padre_y_chunk_index_correcto(
        self,
        mock_get_docs,
        mock_generate_batch,
        mock_save_chunks,
        tmp_path,
    ):
        # Chunk de 200 palabras → step=85 → 3 sub-chunks (i=0, 85, 170)
        long_text = " ".join([f"palabra{i}" for i in range(200)])
        results = tmp_path / "results"
        _write_json(
            results / "entities" / "Document.json",
            [{"_ObjectId": "Document_1", "name": MOCK_DOC_UUID}],
        )
        _write_json(
            results / "entities" / "Chunk.json",
            [{"_ObjectId": "Chunk_1_1", "text": long_text}],
        )
        _write_json(
            results / "relations" / "ChunkOf.json",
            [{"_OriginId": "Chunk_1_1", "_TargetId": "Document_1", "chunk_number": 3}],
        )
        mock_get_docs.return_value = [{"id": MOCK_DOC_UUID, "filename": "informe.pdf"}]
        mock_generate_batch.return_value = [[0.1] * 384] * 3

        result = wukong_runner._generate_and_store_embeddings(tmp_path, MOCK_COL_ID)

        assert result == 3
        saved_records = mock_save_chunks.call_args[0][0]
        assert len(saved_records) == 3
        # chunk_id padre preservado en todos los sub-chunks
        assert all(r["chunk_id"] == "Chunk_1_1" for r in saved_records)
        # chunk_index = base_index * 1000 + sub_idx
        assert saved_records[0]["chunk_index"] == 3000
        assert saved_records[1]["chunk_index"] == 3001
        assert saved_records[2]["chunk_index"] == 3002
        # cada sub-chunk tiene como máximo 100 palabras
        assert all(len(r["chunk_text"].split()) <= 100 for r in saved_records)

    @patch("app.services.wukong_runner.supabase_client.save_chunk_embeddings")
    @patch("app.services.embeddings_service.generate_embeddings_batch")
    def test_sin_archivos_json_no_genera_embeddings(
        self,
        mock_generate_batch,
        mock_save_chunks,
        tmp_path,
    ):
        # tmp_path no tiene results/entities/Document.json → la función retorna 0
        result = wukong_runner._generate_and_store_embeddings(tmp_path, MOCK_COL_ID)

        assert result == 0
        mock_generate_batch.assert_not_called()
        mock_save_chunks.assert_not_called()

    @patch("app.services.wukong_runner.supabase_client.save_chunk_embeddings")
    @patch("app.services.embeddings_service.generate_embeddings_batch")
    @patch("app.services.wukong_runner.supabase_client.get_documents_by_collection")
    def test_error_al_guardar_embeddings_propaga_excepcion(
        self,
        mock_get_docs,
        mock_generate_batch,
        mock_save_chunks,
        tmp_path,
    ):
        # _generate_and_store_embeddings propaga la excepción al llamador
        # (process_collection la captura con falla silenciosa — líneas 145-152)
        _setup_wukong_results(tmp_path)
        mock_get_docs.return_value = [{"id": MOCK_DOC_UUID, "filename": "informe.pdf"}]
        mock_generate_batch.return_value = [[0.1] * 384]
        mock_save_chunks.side_effect = RuntimeError("Supabase no disponible")

        with pytest.raises(RuntimeError, match="Supabase no disponible"):
            wukong_runner._generate_and_store_embeddings(tmp_path, MOCK_COL_ID)


# ── Transición de estados ──────────────────────────────────────────────────────


class TestTransicionEstados:
    @patch("app.services.wukong_runner.export_qm_to_supabase", return_value=None)
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=2)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_secuencia_completa_de_estados(
        self, mock_process_txt, _mock_build, _mock_run_wukong, mock_sb, _mock_qm
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [_make_doc("doc1")]
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc1"}

        wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses == ["processing_graph", "graph_ready"]

    @patch("app.services.wukong_runner._check_cancelled",
           side_effect=wukong_runner.ProcessingCancelled)
    @patch("app.services.wukong_runner.supabase_client")
    def test_cancelacion_durante_extraccion(self, mock_sb, _mock_check):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [_make_doc("doc1")]

        wukong_runner.process_collection(MOCK_COL_ID)

        mock_sb.update_collection_processing_status.assert_not_called()

    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong",
           side_effect=wukong_runner.ProcessingCancelled)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=2)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_cancelacion_durante_wukong(
        self, mock_process_txt, _mock_build, _mock_run_wukong, mock_sb
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [_make_doc("doc1")]
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc1"}

        wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses == ["processing_graph"]
        assert "error" not in statuses
        assert "graph_ready" not in statuses

    @patch("app.services.wukong_runner.export_qm_to_supabase", return_value=None)
    @patch("app.services.wukong_runner._generate_and_store_embeddings",
           side_effect=RuntimeError("fallo embeddings"))
    @patch("app.services.wukong_runner.supabase_client")
    @patch("app.services.wukong_runner._run_wukong", return_value=None)
    @patch("app.services.wukong_runner._build_wukong_workdir", return_value=2)
    @patch("app.services.wukong_runner.process_txt_document")
    def test_fallo_embeddings_no_bloquea_estado_graph_ready(
        self, mock_process_txt, _mock_build, _mock_run_wukong, mock_sb,
        _mock_embeddings, _mock_qm
    ):
        mock_sb.get_collection_by_id.return_value = _make_collection()
        mock_sb.get_documents_by_collection.return_value = [_make_doc("doc1")]
        mock_process_txt.return_value = {"status": "ok", "document_id": "doc1"}

        wukong_runner.process_collection(MOCK_COL_ID)

        statuses = [
            call.args[1]
            for call in mock_sb.update_collection_processing_status.call_args_list
        ]
        assert statuses[-1] == "graph_ready"
