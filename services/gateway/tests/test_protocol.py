"""Tests for the WebSocket protocol message types."""

import json

from sales_copilot_gateway.protocol import (
    ClientHelloMessage,
    EndSessionMessage,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    SuggestionMessage,
    parse_client_message,
    serialize_server_message,
)


def test_client_hello_round_trip() -> None:
    raw = json.dumps({"type": "client_hello", "clientVersion": "0.1.0"})
    msg = parse_client_message(raw)
    assert isinstance(msg, ClientHelloMessage)
    assert msg.client_version == "0.1.0"


def test_end_session_round_trip() -> None:
    raw = json.dumps({"type": "end_session", "reason": "user_clicked_end"})
    msg = parse_client_message(raw)
    assert isinstance(msg, EndSessionMessage)
    assert msg.reason == "user_clicked_end"


def test_session_started_serializes() -> None:
    msg = ServerSessionStartedMessage(session_id="sess_abc123", started_at_ms=1_712_500_000_000)
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {
        "type": "session_started",
        "sessionId": "sess_abc123",
        "startedAtMs": 1_712_500_000_000,
    }


def test_suggestion_serializes() -> None:
    msg = SuggestionMessage(
        tick_at_ms=1_712_500_005_000,
        sentiment=1,
        intent="qualify_budget",
        suggestion="Ask about decision timeline.",
        confidence=0.82,
    )
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {
        "type": "suggestion",
        "tickAtMs": 1_712_500_005_000,
        "sentiment": 1,
        "intent": "qualify_budget",
        "suggestion": "Ask about decision timeline.",
        "confidence": 0.82,
    }


def test_error_serializes() -> None:
    msg = ServerErrorMessage(code="invalid_message", message="Unknown type 'foo'")
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {"type": "error", "code": "invalid_message", "message": "Unknown type 'foo'"}


def test_parse_unknown_type_raises() -> None:
    import pytest

    from sales_copilot_gateway.protocol import ProtocolError

    with pytest.raises(ProtocolError):
        parse_client_message(json.dumps({"type": "totally_made_up"}))
