"""Tests for the /ws/session WebSocket endpoint."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sales_copilot_gateway.auth import SessionUser
from sales_copilot_gateway.main import SUGGESTION_TICK_SECONDS_ENV, app

# Cap drain loops so a regression that stops emitting the expected frame
# fails the test in seconds rather than hanging the entire CI job.
_MAX_DRAIN_FRAMES = 50

# In Phase 2 the gateway expects a client_hello before it sends session_started.
# Anonymous tests still need to send one — just without an idToken.
_ANON_HELLO = json.dumps({"type": "client_hello", "clientVersion": "0.1.0"})


def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(_ANON_HELLO)
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)


def test_ws_rejects_unknown_message_type() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(_ANON_HELLO)
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "bogus"}))
        for _ in range(_MAX_DRAIN_FRAMES):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "error":
                break
        else:
            pytest.fail(
                f"never received error frame within {_MAX_DRAIN_FRAMES} messages"
            )
        assert msg["code"] == "invalid_message"


def test_ws_streams_canned_suggestions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")

    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(_ANON_HELLO)
        first = json.loads(ws.receive_text())
        assert first["type"] == "session_started"

        suggestions: list[dict[str, Any]] = []
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


def test_ws_end_session_closes_cleanly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(_ANON_HELLO)
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "end_session", "reason": "test"}))

        from fastapi.websockets import WebSocketDisconnect as WSD

        with pytest.raises(WSD):
            for _ in range(_MAX_DRAIN_FRAMES):
                ws.receive_text()


def test_ws_anonymous_session_when_no_id_token() -> None:
    """A client_hello without idToken produces an anonymous session."""
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(_ANON_HELLO)
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "session_started"


def test_ws_authed_session_when_valid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """A client_hello with a valid idToken attaches the user to the session.

    We monkeypatch validate_id_token to return a known SessionUser without
    touching real Firebase.
    """
    fake_user = SessionUser(
        uid="u_test", email="test@example.com", display_name="Test User"
    )

    def fake_validate(token: str | None) -> SessionUser | None:
        if token == "good-token":
            return fake_user
        return None

    monkeypatch.setattr(
        "sales_copilot_gateway.main.validate_id_token", fake_validate
    )

    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "client_hello",
                    "clientVersion": "0.1.0",
                    "idToken": "good-token",
                }
            )
        )
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "session_started"


def test_ws_anonymous_fallback_when_invalid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An invalid token does NOT close the connection — Phase 2 is permissive."""

    def fake_validate(token: str | None) -> SessionUser | None:
        return None  # Always invalid

    monkeypatch.setattr(
        "sales_copilot_gateway.main.validate_id_token", fake_validate
    )

    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "client_hello",
                    "clientVersion": "0.1.0",
                    "idToken": "bogus-token",
                }
            )
        )
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "session_started"
