#!/usr/bin/env python3
"""
Genera un PDF optimizado para probar el flujo OCR (HU-03).

El archivo final no tiene capa de texto extraíble por PyMuPDF: solo una imagen
bitmap (raster de un texto dibujado en un PDF temporal). Así
`detect_file_type` lo clasifica como pdf_scanned y `process_pdf_document`
usa Google Cloud Vision.

Uso:
  cd backend
  python scripts/make_ocr_test_pdf.py                    # -> ocr_test_scan_like.pdf
  python scripts/make_ocr_test_pdf.py /ruta/salida.pdf
"""

import sys

import fitz


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "ocr_test_scan_like.pdf"
    label = "Prueba OCR Wukong"

    # 1) Texto en un PDF auxiliar (sí tiene capa de texto).
    tmp = fitz.open()
    page_tmp = tmp.new_page(width=595, height=200)
    page_tmp.insert_text((72, 100), label, fontsize=22)

    # 2) Rasterizar a pixmap (imagen).
    pix = page_tmp.get_pixmap(dpi=200, alpha=False)
    tmp.close()

    # 3) PDF final: solo insert_image → get_text() devuelve casi nada → ruta OCR.
    doc = fitz.open()
    page = doc.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, pixmap=pix)
    doc.save(out)
    doc.close()
    print(f"Escrito: {out} (imagen sin capa de texto seleccionable).")


if __name__ == "__main__":
    main()
