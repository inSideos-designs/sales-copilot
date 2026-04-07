"""Tests for the /ws/session WebSocket endpoint."""

import json

import pytest
from fastapi.testclient import TestClient

from sales_copilot_gateway.main import SUGGESTION_TICK_SECONDS_ENV, app

# Cap drain loops so a regression that stops emitting the expected frame
# fails the test in seconds rather than hanging the entire CI job.
_MAX_DRAIN_FRAMES = 50


def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)


def test_ws_rejects_unknown_message_type() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "bogus"}))
        # Under the concurrent handler the next message could be a suggestion
        # OR the error — drain until we see the error (bounded).
        for _ in range(_MAX_DRAIN_FRAMES):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "error":
                break
        else:
            pytest.fail(
                f"never received error frame within {_MAX_DRAIN_FRAMES} messages"
            )
        assert msg["code"] == "invalid_message"


def test_ws_streams_canned_suggestions(monkeypatch) -> None:
    # Force zero-tick for test speed
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")

    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        # Drop session_started
        first = json.loads(ws.receive_text())
        assert first["type"] == "session_started"

        # Read until we collect 3 suggestions (bounded so a regression
        # fails fast instead of hanging CI).
        suggestions = []
        for _ in range(_MAX_DRAIN_FRAMES):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "suggestion":
                suggestions.append(msg)
            if len(suggestions) >= 3:
                break
        else:
            pytest.fail(
                f"only received {len(suggestions)} suggestions in "
                f"{_MAX_DRAIN_FRAMES} frames"
            )

        assert len(suggestions) == 3
        for s in suggestions:
            assert s["intent"]
            assert s["suggestion"]
            assert -2 <= s["sentiment"] <= 2


def test_ws_end_session_closes_cleanly(monkeypatch) -> None:
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "end_session", "reason": "test"}))

        from fastapi.websockets import WebSocketDisconnect as WSD

        # Server closes after end_session. Drain any queued suggestions
        # racing the close until the disconnect is observed.
        with pytest.raises(WSD):
            for _ in range(_MAX_DRAIN_FRAMES):
                ws.receive_text()
