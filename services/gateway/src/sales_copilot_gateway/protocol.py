"""WebSocket protocol for sales-copilot live sessions.

Messages are JSON objects with a `type` discriminator. Field names use
camelCase on the wire (matching the TypeScript client) but snake_case
in Python. Keep this file in sync with services/web/src/lib/protocol.ts.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Literal


class ProtocolError(ValueError):
    """Raised when a message cannot be parsed or validated."""


# ---- Client → Server ----


@dataclass(frozen=True)
class ClientHelloMessage:
    type: Literal["client_hello"] = "client_hello"
    client_version: str = ""


@dataclass(frozen=True)
class EndSessionMessage:
    type: Literal["end_session"] = "end_session"
    reason: str = ""


ClientMessage = ClientHelloMessage | EndSessionMessage


# ---- Server → Client ----


@dataclass(frozen=True)
class ServerSessionStartedMessage:
    session_id: str
    started_at_ms: int
    type: Literal["session_started"] = "session_started"


@dataclass(frozen=True)
class SuggestionMessage:
    tick_at_ms: int
    sentiment: int
    intent: str
    suggestion: str
    confidence: float
    type: Literal["suggestion"] = "suggestion"


@dataclass(frozen=True)
class ServerErrorMessage:
    code: str
    message: str
    type: Literal["error"] = "error"


ServerMessage = (
    ServerSessionStartedMessage | SuggestionMessage | ServerErrorMessage
)


# ---- Parse / serialize ----


def parse_client_message(raw: str) -> ClientMessage:
    """Parse an incoming JSON string into a typed client message."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ProtocolError("message must be a JSON object")

    msg_type = data.get("type")
    if msg_type == "client_hello":
        return ClientHelloMessage(client_version=str(data.get("clientVersion", "")))
    if msg_type == "end_session":
        return EndSessionMessage(reason=str(data.get("reason", "")))

    raise ProtocolError(f"unknown message type: {msg_type!r}")


_FIELD_SNAKE_TO_CAMEL = {
    "session_id": "sessionId",
    "started_at_ms": "startedAtMs",
    "tick_at_ms": "tickAtMs",
}


def _to_camel(snake: str) -> str:
    return _FIELD_SNAKE_TO_CAMEL.get(snake, snake)


def serialize_server_message(msg: ServerMessage) -> str:
    """Serialize a server message to the JSON wire format."""
    payload = {_to_camel(k): v for k, v in asdict(msg).items()}
    return json.dumps(payload)
