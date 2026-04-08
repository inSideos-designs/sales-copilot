"""Tests for the health endpoint."""

from fastapi.testclient import TestClient

from sales_copilot_gateway.main import app


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
