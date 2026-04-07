"""FastAPI app entrypoint."""

import logging
import secrets
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from sales_copilot_gateway import __version__
from sales_copilot_gateway.protocol import (
    ProtocolError,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    parse_client_message,
    serialize_server_message,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="sales-copilot-gateway", version=__version__)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}


def _new_session_id() -> str:
    return f"sess_{secrets.token_urlsafe(12)}"


def _now_ms() -> int:
    return int(time.time() * 1000)


@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    """Phase 1 WebSocket handler: accept, greet, log incoming client messages."""
    await ws.accept()
    session_id = _new_session_id()
    started_at_ms = _now_ms()
    logger.info("session_open session_id=%s", session_id)

    await ws.send_text(
        serialize_server_message(
            ServerSessionStartedMessage(session_id=session_id, started_at_ms=started_at_ms)
        )
    )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = parse_client_message(raw)
            except ProtocolError as exc:
                logger.warning("session_id=%s invalid_message: %s", session_id, exc)
                await ws.send_text(
                    serialize_server_message(
                        ServerErrorMessage(code="invalid_message", message=str(exc))
                    )
                )
                continue

            logger.info("session_id=%s client_message=%s", session_id, type(msg).__name__)

            if msg.type == "end_session":
                logger.info("session_id=%s end_session reason=%s", session_id, msg.reason)
                break
    except WebSocketDisconnect:
        logger.info("session_id=%s disconnect", session_id)
