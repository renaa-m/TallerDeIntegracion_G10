from unittest.mock import patch

from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_readiness_check():
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_check_supabase_ok():
    """Cuando Supabase responde, /ready devuelve 200."""
    with patch("app.api.routes.health.get_supabase_client") as mock_client:
        mock_table = mock_client.return_value.table.return_value
        mock_table.select.return_value.limit.return_value.execute.return_value = None
        response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_check_supabase_falla():
    """Cuando Supabase no está disponible, /ready devuelve 503."""
    with patch("app.api.routes.health.get_supabase_client") as mock_client:
        mock_client.return_value.table.side_effect = Exception("connection refused")
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
