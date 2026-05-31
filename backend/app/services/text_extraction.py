import os
import tempfile

import fitz
from google.cloud import vision

from app.config import settings
from app.services.supabase_client import (
    get_supabase_client,
    save_document_text,
    update_document_status,
)

# Límite de píxeles de Cloud Vision para OCR (ancho × alto).
_VISION_MAX_PIXELS = 75_000_000
# Si el OCR devuelve menos caracteres, se reintenta con DPI elevado.
_OCR_MIN_CHARS_BEFORE_RETRY = 25
# Área mínima de página (pts²) para considerar layout grande (p. ej. A3).
_LARGE_PAGE_AREA_PT2 = 600_000
# DPI efectivo mínimo de imagen embebida; por debajo se trata como scan de baja calidad.
_LOW_EMBEDDED_DPI = 200


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


def _estimate_pixels_at_dpi(page: fitz.Page, dpi: int) -> int:
    scale = dpi / 72
    return int(page.rect.width * scale) * int(page.rect.height * scale)


def _clamp_dpi_for_vision(page: fitz.Page, dpi: int) -> int:
    """Reduce el DPI si la página superaría el límite de píxeles de Vision."""
    pixels = _estimate_pixels_at_dpi(page, dpi)
    if pixels <= _VISION_MAX_PIXELS:
        return dpi
    ratio = (_VISION_MAX_PIXELS / pixels) ** 0.5
    return max(150, int(dpi * ratio))


def _embedded_image_dpi(page: fitz.Page, xref: int) -> float | None:
    """Estima el DPI de una imagen embebida respecto al tamaño de la página."""
    try:
        info = page.parent.extract_image(xref)
    except Exception:
        return None
    width, height = info["width"], info["height"]
    if width <= 0 or height <= 0:
        return None
    rect = page.rect
    dpi_w = width / (rect.width / 72)
    dpi_h = height / (rect.height / 72)
    return min(dpi_w, dpi_h)


def page_needs_high_dpi(page: fitz.Page) -> bool:
    """
    Heurísticas para páginas complejas: scans de baja resolución, varias imágenes
    o formatos grandes (tablas, planos, documentos legales escaneados).
    """
    images = page.get_images(full=True)
    rect = page.rect
    if rect.width * rect.height >= _LARGE_PAGE_AREA_PT2:
        return True

    if not images:
        return False

    if len(images) >= 2:
        return True

    for img in images:
        dpi = _embedded_image_dpi(page, img[0])
        if dpi is not None and dpi < _LOW_EMBEDDED_DPI:
            return True

    return False


def choose_ocr_dpi(page: fitz.Page) -> int:
    """Selecciona DPI inicial según complejidad de la página."""
    base = settings.ocr_dpi_complex if page_needs_high_dpi(page) else settings.ocr_dpi_default
    return _clamp_dpi_for_vision(page, base)


def render_page_for_ocr(page: fitz.Page, dpi: int) -> fitz.Pixmap:
    """
    Renderiza una página optimizada para OCR: escala de grises, sin alpha,
    respetando el límite de píxeles de Vision.
    """
    dpi = _clamp_dpi_for_vision(page, dpi)
    return page.get_pixmap(dpi=dpi, alpha=False, colorspace=fitz.csGRAY)


def pixmap_to_ocr_bytes(pix: fitz.Pixmap) -> bytes:
    """PNG en escala de grises: lossless y más liviano que RGB para Vision."""
    return pix.tobytes("png")


def _vision_image_context() -> vision.ImageContext:
    hints = [
        lang.strip()
        for lang in settings.ocr_language_hints.split(",")
        if lang.strip()
    ]
    return vision.ImageContext(language_hints=hints or ["es"])


def _call_vision_ocr(client: vision.ImageAnnotatorClient, image_bytes: bytes) -> str:
    image = vision.Image(content=image_bytes)
    response = client.document_text_detection(
        image=image,
        image_context=_vision_image_context(),
    )
    if response.error.message:
        raise RuntimeError(response.error.message)
    if response.full_text_annotation and response.full_text_annotation.text:
        return response.full_text_annotation.text
    return ""


def _ocr_page_with_dpi(
    client: vision.ImageAnnotatorClient,
    page: fitz.Page,
    dpi: int,
) -> str:
    pix = render_page_for_ocr(page, dpi)
    try:
        return _call_vision_ocr(client, pixmap_to_ocr_bytes(pix))
    finally:
        pix = None


def ocr_pdf_page(
    client: vision.ImageAnnotatorClient,
    page: fitz.Page,
    page_num: int,
) -> str:
    """
    OCR de una página con DPI adaptativo y reintento a mayor resolución si el
    resultado es demasiado escaso (típico en scans densos o texto pequeño).
    """
    dpi = choose_ocr_dpi(page)
    try:
        text = _ocr_page_with_dpi(client, page, dpi)
    except RuntimeError as exc:
        raise RuntimeError(
            f"Cloud Vision error en página {page_num + 1}: {exc.args[0]}"
        ) from exc

    retry_dpi = _clamp_dpi_for_vision(page, settings.ocr_dpi_complex)
    if len(text.strip()) < _OCR_MIN_CHARS_BEFORE_RETRY and retry_dpi > dpi:
        try:
            text = _ocr_page_with_dpi(client, page, retry_dpi)
        except RuntimeError as exc:
            raise RuntimeError(
                f"Cloud Vision error en página {page_num + 1}: {exc.args[0]}"
            ) from exc

    if not text.strip():
        raise RuntimeError(
            f"Cloud Vision no extrajo texto en página {page_num + 1}"
        )
    return text


def extract_text_vision(file_path: str) -> str:
    """
    Extrae texto de un PDF escaneado usando Google Cloud Vision API.
    Estrategia: página por página como imagen PNG en escala de grises, con DPI
    adaptativo y reintento para documentos complejos.
    Si cualquier página falla, se lanza la excepción (fallo total del documento).
    El llamador es responsable de marcar el documento como 'error'.
    """
    client = vision.ImageAnnotatorClient()
    doc = fitz.open(file_path)
    pages_text = []

    try:
        for page_num in range(len(doc)):
            pages_text.append(ocr_pdf_page(client, doc[page_num], page_num))
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
