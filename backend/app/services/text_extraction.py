import os
import tempfile

import fitz
from google.cloud import vision

from app.services.supabase_client import (
    get_supabase_client,
    save_document_text,
    update_document_status,
)


def download_file_from_storage(storage_path: str) -> bytes:
    """Descarga un archivo desde Supabase Storage (bucket 'documentos')."""
    client = get_supabase_client()
    return client.storage.from_("documentos").download(storage_path)


def extract_text_from_txt(file_content: bytes) -> str:
    """Lee el contenido de un archivo TXT como texto plano."""
    return file_content.decode("utf-8")


def process_txt_document(
    document_id: str,
    user_id: str,
    collection_id: str,
    storage_path: str,
) -> dict:
    """
    Pipeline completo para un archivo TXT:
    1. Marca el documento como 'extracting_text'
    2. Descarga el archivo desde Supabase Storage
    3. Lee el contenido como texto plano
    4. Guarda el texto en la tabla document_texts
    5. Marca el documento como 'text_extracted'

    Si algo falla, marca el documento como 'error' con el mensaje.
    """
    try:
        update_document_status(document_id, user_id, "extracting_text")

        file_content = download_file_from_storage(storage_path)
        extracted_text = extract_text_from_txt(file_content)

        save_document_text(
            document_id=document_id,
            user_id=user_id,
            collection_id=collection_id,
            extracted_text=extracted_text,
            extraction_method="direct_read",
        )

        update_document_status(document_id, user_id, "text_extracted")

        return {"status": "ok", "document_id": document_id}

    except Exception as e:
        update_document_status(document_id, user_id, "error", error_message=str(e))
        return {"status": "error", "document_id": document_id, "error": str(e)}


def detect_file_type(file_path: str) -> str:
    """Detecta si un archivo es TXT, PDF digital o PDF escaneado."""
    if file_path.lower().endswith(".txt"):
        return "txt"
    doc = fitz.open(file_path)
    text = ""
    for page_num in range(min(3, len(doc))):
        text += doc[page_num].get_text()
    doc.close()
    return "pdf_digital" if len(text) > 100 else "pdf_scanned"


def extract_text_pymupdf(file_path: str) -> str:
    """Extrae el texto completo de un PDF digital usando PyMuPDF."""
    doc = fitz.open(file_path)
    pages = [doc[i].get_text() for i in range(len(doc))]
    doc.close()
    return "\n\n".join(pages)


def extract_text_vision(file_path: str) -> str:
    """
    Extrae texto de un PDF escaneado usando Google Cloud Vision API.
    Estrategia: página por página como imagen PNG.
    Si cualquier página falla, se lanza la excepción (fallo total del documento).
    El llamador es responsable de marcar el documento como 'error'.
    """
    client = vision.ImageAnnotatorClient()
    doc = fitz.open(file_path)
    pages_text = []

    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(dpi=300)
            image_bytes = pix.tobytes("png")

            image = vision.Image(content=image_bytes)
            response = client.document_text_detection(image=image)

            if response.error.message:
                raise RuntimeError(
                    f"Cloud Vision error en página {page_num + 1}: {response.error.message}"
                )

            pages_text.append(response.full_text_annotation.text)
    finally:
        doc.close()

    return "\n\n".join(pages_text)


def process_pdf_document(
    document_id: str,
    user_id: str,
    collection_id: str,
    storage_path: str,
) -> dict:
    """
    Pipeline completo para un archivo PDF digital:
    1. Marca el documento como 'extracting_text'
    2. Descarga el archivo desde Supabase Storage
    3. Escribe los bytes en un archivo temporal
    4. Detecta si es PDF digital o escaneado
    5. Extrae el texto con PyMuPDF
    6. Guarda el texto en la tabla document_texts
    7. Marca el documento como 'text_extracted'

    Si el PDF es escaneado, extrae el texto con Google Cloud Vision API (OCR).
    Si algo falla, marca el documento como 'error' con el mensaje.
    """
    tmp_path = None
    try:
        update_document_status(document_id, user_id, "extracting_text")

        file_content = download_file_from_storage(storage_path)

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name

        file_type = detect_file_type(tmp_path)

        if file_type == "pdf_scanned":
            extracted_text = extract_text_vision(tmp_path)
            save_document_text(
                document_id=document_id,
                user_id=user_id,
                collection_id=collection_id,
                extracted_text=extracted_text,
                extraction_method="ocr",
            )
            update_document_status(document_id, user_id, "text_extracted")
            return {"status": "ok", "document_id": document_id}

        extracted_text = extract_text_pymupdf(tmp_path)

        save_document_text(
            document_id=document_id,
            user_id=user_id,
            collection_id=collection_id,
            extracted_text=extracted_text,
            extraction_method="pymupdf",
        )

        update_document_status(document_id, user_id, "text_extracted")

        return {"status": "ok", "document_id": document_id}

    except Exception as e:
        update_document_status(document_id, user_id, "error", error_message=str(e))
        return {"status": "error", "document_id": document_id, "error": str(e)}

    finally:
        if tmp_path is not None:
            os.unlink(tmp_path)
