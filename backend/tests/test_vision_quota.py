"""Tests para consulta best-effort de cuotas Vision (Service Usage API)."""

from unittest.mock import MagicMock, patch

from app.services.vision_quota import fetch_vision_quota_summary


def test_sin_project_id():
    out = fetch_vision_quota_summary("")
    assert out["ok"] is False
    assert "vacío" in out["error"].lower() or "GCP" in out["error"]


@patch("app.services.vision_quota.httpx.Client")
@patch("app.services.vision_quota.default")
def test_ok_parsea_metricas(mock_default, mock_client_cls):
    creds = MagicMock()
    creds.token = "fake-token"
    mock_default.return_value = (creds, None)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "metrics": [
            {
                "name": "projects/p/services/vision.googleapis.com/consumerQuotaMetrics/m1",
                "consumerQuotaLimits": [
                    {
                        "quotaBuckets": [
                            {"effectiveLimit": "1800", "defaultLimit": "1800"},
                        ],
                    },
                ],
            },
        ],
    }
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.__exit__.return_value = False
    mock_client.get.return_value = mock_resp
    mock_client_cls.return_value = mock_client

    out = fetch_vision_quota_summary("mi-proyecto")
    assert out["ok"] is True
    assert out["project_id"] == "mi-proyecto"
    assert len(out["quotas"]) >= 1
