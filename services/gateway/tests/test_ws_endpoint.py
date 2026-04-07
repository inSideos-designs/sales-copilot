"""Tests for the /ws/session WebSocket endpoint (bare connection)."""

import json

from fastapi.testclient import TestClient

from sales_copilot_gateway.main import app


def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)

        # Now the client can say hello; server should not error
        ws.send_text(json.dumps({"type": "client_hello", "clientVersion": "0.1.0"}))


def test_ws_rejects_unknown_message_type() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        # Server sends session_started first
        ws.receive_text()
        ws.send_text(json.dumps({"type": "bogus"}))
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "error"
        assert msg["code"] == "invalid_message"
