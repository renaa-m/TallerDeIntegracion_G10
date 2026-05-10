"""
Script standalone para probar el pipeline de generación de grafo localmente,
SIN pasar por Supabase, FastAPI ni autenticación.

Toma N documentos locales (.txt o .pdf digital), extrae su texto, arma la
carpeta que Wukong necesita usando el data_model por defecto del proyecto,
ejecuta Wukong y deja el .qm en una ruta accesible para inspección.

Uso:
    cd backend
    source .venv/bin/activate
    python scripts/probar_grafo.py /ruta/doc1.txt /ruta/doc2.pdf /ruta/doc3.txt

Salida:
    /tmp/wukong-debug-<timestamp>/
        ├── docs/text/preview/<doc>.txt    ← textos extraídos
        ├── data_model.json                ← copiado del default
        └── exports/mdb/*.qm               ← grafo generado por Wukong
"""

import argparse
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import fitz

DEFAULT_DATA_MODEL = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "services"
    / "default_data_model.json"
)

# Wukong busca config/default.toml relativo al CWD, no al package instalado.
# Le pasamos el path absoluto al toml que viene con el repo.
WUKONG_DEFAULT_CONFIG = (
    Path(__file__).resolve().parent.parent
    / "wukong-engine"
    / "config"
    / "default.toml"
)


def extract_text(path: Path) -> str:
    """Extrae texto de un archivo según su extensión (.txt o .pdf digital)."""
    if path.suffix.lower() == ".txt":
        return path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".pdf":
        doc = fitz.open(str(path))
        try:
            pages = [doc[i].get_text() for i in range(len(doc))]
        finally:
            doc.close()
        full_text = "\n\n".join(pages)
        if len(full_text.strip()) < 100:
            raise ValueError(
                f"{path.name}: el PDF parece escaneado (poco texto extraído). "
                f"Esta prueba aislada no soporta OCR — usá un PDF con texto digital."
            )
        return full_text
    raise ValueError(f"Formato no soportado: {path.suffix} ({path.name})")


def build_workdir(workdir: Path, files: list[Path]) -> int:
    """Arma la estructura que pide Wukong y devuelve la cantidad de docs escritos."""
    text_dir = workdir / "docs" / "text" / "preview"
    text_dir.mkdir(parents=True, exist_ok=True)

    n = 0
    for src in files:
        print(f"  → extrayendo {src.name}...")
        try:
            text = extract_text(src)
        except Exception as exc:
            print(f"    ⚠️  saltado: {exc}")
            continue

        dst = text_dir / f"{src.stem}.txt"
        dst.write_text(text, encoding="utf-8")
        n += 1
        print(f"    ✓ {len(text):,} caracteres → {dst.relative_to(workdir)}")

    if not DEFAULT_DATA_MODEL.is_file():
        raise FileNotFoundError(
            f"No se encontró el data_model en {DEFAULT_DATA_MODEL}"
        )
    shutil.copy(DEFAULT_DATA_MODEL, workdir / "data_model.json")
    print(f"  → data_model.json copiado desde {DEFAULT_DATA_MODEL.name}")

    return n


def run_wukong(workdir: Path, timeout: int = 1800) -> int:
    """Ejecuta Wukong como subprocess. Devuelve el exit code."""
    print(f"\n[2/3] Ejecutando Wukong sobre {workdir}...")
    print(f"      (esto puede tardar varios minutos según el largo de los docs)\n")
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "wukong_engine",
            str(workdir),
            "--config",
            str(WUKONG_DEFAULT_CONFIG),
        ],
        timeout=timeout,
    )
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prueba el pipeline de generación de grafo localmente."
    )
    parser.add_argument(
        "files",
        nargs="+",
        help="Rutas de los archivos .txt o .pdf a procesar",
    )
    parser.add_argument(
        "--keep-failed",
        action="store_true",
        help="Mantener la carpeta de trabajo aunque Wukong falle",
    )
    args = parser.parse_args()

    files = [Path(f).expanduser().resolve() for f in args.files]
    for f in files:
        if not f.is_file():
            print(f"❌ No existe: {f}", file=sys.stderr)
            return 1

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    workdir = Path("/tmp") / f"wukong-debug-{timestamp}"
    workdir.mkdir()

    print(f"📁 Carpeta de trabajo: {workdir}\n")
    print(f"[1/3] Extrayendo texto de {len(files)} archivo(s)...")
    n_ok = build_workdir(workdir, files)
    if n_ok == 0:
        print("❌ Ningún archivo se extrajo correctamente.", file=sys.stderr)
        return 1

    exit_code = run_wukong(workdir)
    print(f"\n[3/3] Wukong terminó con exit code {exit_code}\n")

    if exit_code != 0 and not args.keep_failed:
        print(
            f"⚠️  Wukong falló. Pasá --keep-failed si querés inspeccionar "
            f"{workdir}"
        )
        return exit_code

    exports = workdir / "exports"
    if exports.is_dir():
        qm_files = list(exports.rglob("*.qm"))
        if qm_files:
            print(f"✅ Grafo generado:")
            for qm in qm_files:
                size_kb = qm.stat().st_size / 1024
                print(f"   {qm}  ({size_kb:.1f} KB)")
        else:
            print(f"⚠️  No se encontraron archivos .qm en {exports}")
            print(f"    Contenido de exports/:")
            for p in exports.rglob("*"):
                print(f"      {p.relative_to(exports)}")

    print(f"\n📁 Para inspeccionar todo: {workdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
