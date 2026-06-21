import fitz
import pytest
from unittest.mock import MagicMock, patch

from google.api_core import exceptions as gcloud_exceptions
from google.auth.exceptions import DefaultCredentialsError

from app.config import language_to_ocr_hints, language_to_wukong_name
from app.services.ai_models import OcrServiceUnavailableError
from app.services.text_extraction import (
    _build_image_context,
    choose_ocr_dpi,
    detect_file_type,
    extract_text_pymupdf,
    extract_text_vision,
    page_needs_high_dpi,
    process_pdf_document,
    process_txt_document,
    render_page_for_ocr,
    _clamp_dpi_for_vision,
)

MOCK_DOC_ID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"
MOCK_USER_ID = "auth0|testuser123"
MOCK_COL_ID = "cccccccc-4444-5555-6666-dddddddddddd"
MOCK_STORAGE_PATH = "auth0|testuser123/documento.pdf"


def _make_fitz_doc(page_texts: list[str]) -> MagicMock:
    mock_pages = [MagicMock() for _ in page_texts]
    for mock_page, text in zip(mock_pages, page_texts):
        mock_page.get_text.return_value = text
    mock_doc = MagicMock()
    mock_doc.__len__ = MagicMock(return_value=len(page_texts))
    mock_doc.__getitem__ = MagicMock(side_effect=lambda i: mock_pages[i])
    return mock_doc


class TestDetectFileType:
    def test_txt_retorna_txt(self):
        assert detect_file_type("archivo.txt") == "txt"

    @patch("app.services.text_extraction.fitz")
    def test_pdf_con_texto_suficiente_retorna_pdf_digital(self, mock_fitz):
        mock_fitz.open.return_value = _make_fitz_doc(["A" * 150])
        assert detect_file_type("documento.pdf") == "pdf_digital"

    @patch("app.services.text_extraction.fitz")
    def test_pdf_sin_texto_suficiente_retorna_pdf_scanned(self, mock_fitz):
        mock_fitz.open.return_value = _make_fitz_doc(["AB"])
        assert detect_file_type("documento.pdf") == "pdf_scanned"


class TestExtractTextPymupdf:
    @patch("app.services.text_extraction.fitz")
    def test_concatena_paginas_con_doble_salto(self, mock_fitz):
        mock_fitz.open.return_value = _make_fitz_doc(["página uno", "página dos"])
        result = extract_text_pymupdf("documento.pdf")
        assert result == "página uno\n\npágina dos"


class TestProcessPdfDocument:
    @patch("app.services.text_extraction.os.unlink")
    @patch("app.services.text_extraction.tempfile.NamedTemporaryFile")
    @patch("app.services.text_extraction.fitz")
    @patch("app.services.text_extraction.save_document_text")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_happy_path(
        self,
        mock_download,
        mock_update_status,
        mock_save_text,
        mock_fitz,
        mock_ntf,
        mock_unlink,
    ):
        mock_download.return_value = b"contenido pdf"
        mock_tmp = MagicMock()
        mock_tmp.name = "/tmp/test_doc.pdf"
        mock_ntf.return_value.__enter__.return_value = mock_tmp
        mock_fitz.open.return_value = _make_fitz_doc(["A" * 150, "B" * 50])

        result = process_pdf_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {"status": "ok", "document_id": MOCK_DOC_ID}
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "extracting_text")
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "text_extracted")
        assert mock_save_text.call_args.kwargs["extraction_method"] == "pymupdf"
        assert mock_save_text.call_args.kwargs["document_id"] == MOCK_DOC_ID
        mock_unlink.assert_called_once_with("/tmp/test_doc.pdf")

    @patch("app.services.text_extraction.os.unlink")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_error_en_descarga_marca_estado_error(
        self,
        mock_download,
        mock_update_status,
        mock_unlink,
    ):
        mock_download.side_effect = RuntimeError("conexión fallida")

        result = process_pdf_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {
            "status": "error",
            "document_id": MOCK_DOC_ID,
            "error": "conexión fallida",
        }
        mock_update_status.assert_any_call(
            MOCK_DOC_ID,
            MOCK_USER_ID,
            "error",
            error_message="conexión fallida",
        )
        mock_unlink.assert_not_called()

    @patch("app.services.text_extraction.os.unlink")
    @patch("app.services.text_extraction.tempfile.NamedTemporaryFile")
    @patch("app.services.text_extraction.detect_file_type", return_value="pdf_scanned")
    @patch("app.services.text_extraction.extract_text_vision")
    @patch("app.services.text_extraction.save_document_text")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_pdf_escaneado_happy_path_ocr(
        self,
        mock_download,
        mock_update_status,
        mock_save_text,
        mock_vision,
        mock_detect,
        mock_ntf,
        mock_unlink,
    ):
        mock_download.return_value = b"contenido pdf escaneado"
        mock_tmp = MagicMock()
        mock_tmp.name = "/tmp/test_scanned.pdf"
        mock_ntf.return_value.__enter__.return_value = mock_tmp
        mock_vision.return_value = "Texto extraído por OCR"

        result = process_pdf_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {"status": "ok", "document_id": MOCK_DOC_ID}
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "extracting_text")
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "text_extracted")
        assert mock_save_text.call_args.kwargs["extraction_method"] == "ocr"
        mock_unlink.assert_called_once_with("/tmp/test_scanned.pdf")


# --- Tests OCR (Google Cloud Vision) ---

class TestOcrDpiHelpers:
    def test_clamp_dpi_reduces_on_huge_page(self):
        doc = fitz.open()
        page = doc.new_page(width=5000, height=5000)
        clamped = _clamp_dpi_for_vision(page, 400)
        assert clamped < 400
        doc.close()

    def test_choose_ocr_dpi_standard_page(self):
        doc = fitz.open()
        page = doc.new_page()
        assert choose_ocr_dpi(page) == 300
        doc.close()

    def test_render_page_for_ocr_grayscale(self):
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 100), "Hola")
        pix = render_page_for_ocr(page, 150)
        assert pix.n == 1
        assert len(pix.tobytes("png")) > 0
        doc.close()

    def test_page_needs_high_dpi_large_format(self):
        doc = fitz.open()
        page = doc.new_page(width=1200, height=1600)
        assert page_needs_high_dpi(page) is True
        doc.close()


def test_extract_text_vision_success(tmp_path):
    """Vision retorna texto correctamente para un PDF de una página."""
    # Creamos un PDF mínimo con PyMuPDF para el test
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 100), "Texto de prueba")
    doc.save(str(pdf_path))
    doc.close()

    mock_response = MagicMock()
    mock_response.error.message = ""
    mock_response.full_text_annotation.text = "Texto extraído por Vision"

    with patch("app.services.text_extraction.vision.ImageAnnotatorClient") as mock_client_class:
        mock_client = MagicMock()
        mock_client.document_text_detection.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = extract_text_vision(str(pdf_path))

    assert result == "Texto extraído por Vision"


def test_extract_text_vision_api_error(tmp_path):
    """Si Vision retorna un error en cualquier página, se lanza RuntimeError."""
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()

    mock_response = MagicMock()
    mock_response.error.message = "API quota exceeded"

    with patch("app.services.text_extraction.vision.ImageAnnotatorClient") as mock_client_class:
        mock_client = MagicMock()
        mock_client.document_text_detection.return_value = mock_response
        mock_client_class.return_value = mock_client

        with pytest.raises(RuntimeError, match="Cloud Vision error en página 1"):
            extract_text_vision(str(pdf_path))


def test_process_pdf_document_scanned_marks_error_on_vision_failure(tmp_path):
    """Si Vision falla, el documento se marca como error y no afecta otros documentos."""
    with (
        patch("app.services.text_extraction.download_file_from_storage") as mock_download,
        patch("app.services.text_extraction.update_document_status") as mock_status,
        patch("app.services.text_extraction.save_document_text") as mock_save,
        patch("app.services.text_extraction.extract_text_vision") as mock_vision,
        patch("app.services.text_extraction.detect_file_type", return_value="pdf_scanned"),
    ):
        mock_download.return_value = b"%PDF-fake"
        mock_vision.side_effect = RuntimeError("Cloud Vision error en página 1: quota exceeded")

        result = process_pdf_document(
            document_id="doc-123",
            user_id="auth0|test",
            collection_id="col-456",
            storage_path="col-456/doc-123.pdf",
        )

    assert result["status"] == "error"
    assert result["document_id"] == "doc-123"
    mock_save.assert_not_called()
    # Verifica que se intentó marcar como error
    calls = [str(c) for c in mock_status.call_args_list]
    assert any("error" in c for c in calls)


def test_extract_text_vision_servicio_caido_lanza_ocr_service_error(tmp_path):
    """Si el SERVICIO de Vision se cae (cuota/credenciales/indisponible), se
    lanza OcrServiceUnavailableError — distinto de un error de OCR del documento."""
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()

    with patch("app.services.text_extraction.vision.ImageAnnotatorClient") as mock_client_class:
        mock_client = MagicMock()
        mock_client.document_text_detection.side_effect = (
            gcloud_exceptions.ResourceExhausted("Quota exceeded")
        )
        mock_client_class.return_value = mock_client

        with pytest.raises(OcrServiceUnavailableError):
            extract_text_vision(str(pdf_path))


def test_extract_text_vision_sin_credenciales_lanza_ocr_service_error(tmp_path):
    """Sin credenciales válidas, crear el cliente falla → OcrServiceUnavailableError."""
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()

    with patch(
        "app.services.text_extraction.vision.ImageAnnotatorClient",
        side_effect=DefaultCredentialsError("sin credenciales"),
    ):
        with pytest.raises(OcrServiceUnavailableError):
            extract_text_vision(str(pdf_path))


def test_process_pdf_document_propaga_fallo_de_servicio_ocr(tmp_path):
    """process_pdf_document NO traga el fallo de servicio: lo propaga (no marca
    el documento como ilegible), para avisar a nivel de colección."""
    with (
        patch("app.services.text_extraction.download_file_from_storage") as mock_download,
        patch("app.services.text_extraction.update_document_status") as mock_status,
        patch("app.services.text_extraction.save_document_text") as mock_save,
        patch("app.services.text_extraction.extract_text_vision") as mock_vision,
        patch("app.services.text_extraction.detect_file_type", return_value="pdf_scanned"),
    ):
        mock_download.return_value = b"%PDF-fake"
        mock_vision.side_effect = OcrServiceUnavailableError()

        with pytest.raises(OcrServiceUnavailableError):
            process_pdf_document(
                document_id="doc-123",
                user_id="auth0|test",
                collection_id="col-456",
                storage_path="col-456/doc-123.pdf",
            )

    # No se marcó el documento como error: no es culpa del documento.
    mock_save.assert_not_called()
    assert not any("error" in str(c) for c in mock_status.call_args_list)


# ---------------------------------------------------------------------------
# Tests: language_to_ocr_hints (config.py)
# ---------------------------------------------------------------------------


class TestLanguageToOcrHints:
    def test_espanol_devuelve_es_en(self):
        hints = language_to_ocr_hints("es")
        assert hints == ["es", "en"]

    def test_ingles_devuelve_solo_en(self):
        hints = language_to_ocr_hints("en")
        assert hints == ["en"]

    def test_portugues_devuelve_solo_pt(self):
        hints = language_to_ocr_hints("pt")
        assert hints == ["pt"]

    def test_idioma_no_soportado_usa_fallback(self):
        hints = language_to_ocr_hints("xx")
        # debe devolver los hints globales del settings (por defecto "es,en")
        assert "es" in hints

    def test_none_usa_fallback(self):
        hints = language_to_ocr_hints(None)
        assert isinstance(hints, list)
        assert len(hints) > 0


# ---------------------------------------------------------------------------
# Tests: _build_image_context
# ---------------------------------------------------------------------------


class TestLanguageToWukongName:
    def test_espanol(self):
        assert language_to_wukong_name("es") == "spanish"

    def test_ingles(self):
        assert language_to_wukong_name("en") == "english"

    def test_portugues(self):
        assert language_to_wukong_name("pt") == "portuguese"

    def test_idioma_no_mapeado_devuelve_spanish(self):
        assert language_to_wukong_name("xx") == "spanish"

    def test_none_devuelve_spanish(self):
        assert language_to_wukong_name(None) == "spanish"


class TestBuildImageContext:
    def test_sin_hints_retorna_none(self):
        assert _build_image_context(None) is None
        assert _build_image_context([]) is None

    def test_con_hints_retorna_image_context(self):
        ctx = _build_image_context(["es", "en"])
        assert ctx is not None
        assert list(ctx.language_hints) == ["es", "en"]


# ---------------------------------------------------------------------------
# Tests: extract_text_vision con language_hints
# ---------------------------------------------------------------------------


def test_extract_text_vision_con_language_hints(tmp_path):
    """Los language_hints se pasan a document_text_detection como image_context."""
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()

    mock_response = MagicMock()
    mock_response.error.message = ""
    mock_response.full_text_annotation.text = "Texto OCR"

    with patch("app.services.text_extraction.vision.ImageAnnotatorClient") as mock_cls:
        mock_client = MagicMock()
        mock_client.document_text_detection.return_value = mock_response
        mock_cls.return_value = mock_client

        result = extract_text_vision(str(pdf_path), language_hints=["es", "en"])

    assert result == "Texto OCR"
    call_kwargs = mock_client.document_text_detection.call_args.kwargs
    assert "image_context" in call_kwargs
    assert list(call_kwargs["image_context"].language_hints) == ["es", "en"]


def test_extract_text_vision_sin_hints_no_pasa_image_context(tmp_path):
    """Sin language_hints NO se pasa image_context a Cloud Vision."""
    pdf_path = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()

    mock_response = MagicMock()
    mock_response.error.message = ""
    mock_response.full_text_annotation.text = "Texto OCR"

    with patch("app.services.text_extraction.vision.ImageAnnotatorClient") as mock_cls:
        mock_client = MagicMock()
        mock_client.document_text_detection.return_value = mock_response
        mock_cls.return_value = mock_client

        extract_text_vision(str(pdf_path))

    call_kwargs = mock_client.document_text_detection.call_args.kwargs
    assert "image_context" not in call_kwargs


# ---------------------------------------------------------------------------
# Tests: process_pdf_document propaga language_hints al OCR
# ---------------------------------------------------------------------------


def test_process_pdf_document_propaga_hints_al_ocr():
    """language_hints se pasan a extract_text_vision cuando el PDF es escaneado."""
    with (
        patch("app.services.text_extraction.download_file_from_storage", return_value=b"%PDF"),
        patch("app.services.text_extraction.update_document_status"),
        patch("app.services.text_extraction.save_document_text"),
        patch("app.services.text_extraction.detect_file_type", return_value="pdf_scanned"),
        patch("app.services.text_extraction.extract_text_vision") as mock_vision,
        patch(
            "app.services.text_extraction.tempfile.NamedTemporaryFile"
        ) as mock_ntf,
        patch("app.services.text_extraction.os.unlink"),
    ):
        mock_tmp = MagicMock()
        mock_tmp.name = "/tmp/scanned.pdf"
        mock_ntf.return_value.__enter__.return_value = mock_tmp
        mock_vision.return_value = "texto ocr"

        result = process_pdf_document(
            "doc-1", "user-1", "col-1", "col-1/doc-1.pdf",
            language_hints=["es", "en"],
        )

    assert result["status"] == "ok"
    mock_vision.assert_called_once_with("/tmp/scanned.pdf", language_hints=["es", "en"])


class TestProcessTxtDocument:
    @patch("app.services.text_extraction.save_document_text")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_happy_path(
        self,
        mock_download,
        mock_update_status,
        mock_save_text,
    ):
        mock_download.return_value = b"Texto de prueba en TXT"

        result = process_txt_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {"status": "ok", "document_id": MOCK_DOC_ID}
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "extracting_text")
        mock_update_status.assert_any_call(MOCK_DOC_ID, MOCK_USER_ID, "text_extracted")
        assert mock_save_text.call_args.kwargs["extraction_method"] == "direct_read"
        assert mock_save_text.call_args.kwargs["document_id"] == MOCK_DOC_ID

    @patch("app.services.text_extraction.save_document_text")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_error_en_descarga_marca_estado_error(
        self,
        mock_download,
        mock_update_status,
        mock_save_text,
    ):
        mock_download.side_effect = RuntimeError("conexión fallida")

        result = process_txt_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {
            "status": "error",
            "document_id": MOCK_DOC_ID,
            "error": "conexión fallida",
        }
        mock_update_status.assert_any_call(
            MOCK_DOC_ID,
            MOCK_USER_ID,
            "error",
            error_message="conexión fallida",
        )
        mock_save_text.assert_not_called()

    @patch("app.services.text_extraction.save_document_text")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_error_al_guardar_texto_marca_estado_error(
        self,
        mock_download,
        mock_update_status,
        mock_save_text,
    ):
        mock_download.return_value = b"Texto de prueba en TXT"
        mock_save_text.side_effect = RuntimeError("db error")

        result = process_txt_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result == {
            "status": "error",
            "document_id": MOCK_DOC_ID,
            "error": "db error",
        }
        mock_update_status.assert_any_call(
            MOCK_DOC_ID,
            MOCK_USER_ID,
            "error",
            error_message="db error",
        )
