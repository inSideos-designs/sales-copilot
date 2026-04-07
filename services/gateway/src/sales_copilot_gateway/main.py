"""FastAPI app entrypoint — wires Session + suggestions into the /ws/session handler."""

import asyncio
import contextlib
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from sales_copilot_gateway import __version__
from sales_copilot_gateway.protocol import (
    EndSessionMessage,
    ProtocolError,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    parse_client_message,
    serialize_server_message,
)
from sales_copilot_gateway.session import Session
from sales_copilot_gateway.suggestions import canned_suggestion_stream

logger = logging.getLogger(__name__)

app = FastAPI(title="sales-copilot-gateway", version=__version__)

SUGGESTION_TICK_SECONDS_ENV = "SUGGESTION_TICK_SECONDS"
_DEFAULT_TICK_SECONDS = 5.0


def _tick_seconds() -> float:
    raw = os.environ.get(SUGGESTION_TICK_SECONDS_ENV)
    if raw is None:
        return _DEFAULT_TICK_SECONDS
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_TICK_SECONDS


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}


async def _suggestion_sender(ws: WebSocket, session: Session) -> None:
    """Drain the canned suggestion stream and push messages out the WebSocket."""
    tick = _tick_seconds()
    try:
        async for msg in canned_suggestion_stream(tick_seconds=tick):
            if not session.is_active:
                return
            await ws.send_text(serialize_server_message(msg))
    except asyncio.CancelledError:
        raise
    except WebSocketDisconnect:
        return


async def _client_reader(ws: WebSocket, session: Session) -> None:
    """Read client messages until end_session or disconnect."""
    while session.is_active:
        try:
            raw = await ws.receive_text()
        except WebSocketDisconnect:
            return

        try:
            msg = parse_client_message(raw)
        except ProtocolError as exc:
            logger.warning("session_id=%s invalid_message: %s", session.id, exc)
            await ws.send_text(
                serialize_server_message(
                    ServerErrorMessage(code="invalid_message", message=str(exc))
                )
            )
            continue

        logger.info("session_id=%s client_message=%s", session.id, type(msg).__name__)

        if isinstance(msg, EndSessionMessage):
            logger.info("session_id=%s end_session reason=%s", session.id, msg.reason)
            session.end()
            return


@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    await ws.accept()
    session = Session.start()
    logger.info("session_open session_id=%s", session.id)

    await ws.send_text(
        serialize_server_message(
            ServerSessionStartedMessage(
                session_id=session.id, started_at_ms=session.started_at_ms
            )
        )
    )

    sender = asyncio.create_task(_suggestion_sender(ws, session))
    reader = asyncio.create_task(_client_reader(ws, session))

    try:
        await asyncio.wait({sender, reader}, return_when=asyncio.FIRST_COMPLETED)
    except asyncio.CancelledError:
        pass
    finally:
        session.end()
        for task in (sender, reader):
            if not task.done():
                task.cancel()
        # The outer ASGI scope may already be cancelling us (e.g. client
        # disconnected). Swallow CancelledError from the cleanup awaits so
        # the sub-tasks still get drained and the socket is closed cleanly.
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.gather(sender, reader, return_exceptions=True)
        with contextlib.suppress(RuntimeError, asyncio.CancelledError):
            await ws.close()
        logger.info("session_close session_id=%s", session.id)
