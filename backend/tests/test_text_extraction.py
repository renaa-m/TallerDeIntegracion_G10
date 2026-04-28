from unittest.mock import MagicMock, patch

from app.services.text_extraction import (
    detect_file_type,
    extract_text_pymupdf,
    process_pdf_document,
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
    @patch("app.services.text_extraction.fitz")
    @patch("app.services.text_extraction.update_document_status")
    @patch("app.services.text_extraction.download_file_from_storage")
    def test_pdf_escaneado_marca_estado_error(
        self,
        mock_download,
        mock_update_status,
        mock_fitz,
        mock_ntf,
        mock_unlink,
    ):
        mock_download.return_value = b"contenido pdf escaneado"
        mock_tmp = MagicMock()
        mock_tmp.name = "/tmp/test_scanned.pdf"
        mock_ntf.return_value.__enter__.return_value = mock_tmp
        mock_fitz.open.return_value = _make_fitz_doc(["AB"])

        result = process_pdf_document(
            MOCK_DOC_ID, MOCK_USER_ID, MOCK_COL_ID, MOCK_STORAGE_PATH
        )

        assert result["status"] == "error"
        assert "OCR no implementado" in result["error"]
        mock_update_status.assert_any_call(
            MOCK_DOC_ID,
            MOCK_USER_ID,
            "error",
            error_message="OCR no implementado — Sprint 2",
        )
        mock_unlink.assert_called_once_with("/tmp/test_scanned.pdf")
