"""
Imprime un resumen de cuotas de Cloud Vision (Service Usage API).

Uso:
    cd backend
    source .venv/bin/activate
    PYTHONPATH=. python scripts/print_vision_quota.py

Requiere .env con GCP_PROJECT_ID y credenciales GCP (mismo flujo que el OCR).
"""

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / ".env")
sys.path.insert(0, str(_root))

from app.config import settings  # noqa: E402
from app.services.vision_quota import fetch_vision_quota_summary  # noqa: E402


def main() -> None:
    pid = (settings.gcp_project_id or "").strip()
    out = fetch_vision_quota_summary(pid)
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
