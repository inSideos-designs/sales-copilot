"""FastAPI app entrypoint — wires Session + suggestions into the /ws/session handler."""

import asyncio
import contextlib
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from sales_copilot_gateway import __version__
from sales_copilot_gateway.auth import SessionUser, validate_id_token
from sales_copilot_gateway.protocol import (
    ClientHelloMessage,
    EndSessionMessage,
    ProtocolError,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    parse_client_message,
    serialize_server_message,
)
from sales_copilot_gateway.session import Session
from sales_copilot_gateway.suggestions import canned_suggestion_stream

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)

app = FastAPI(title="sales-copilot-gateway", version=__version__)

SUGGESTION_TICK_SECONDS_ENV = "SUGGESTION_TICK_SECONDS"
_DEFAULT_TICK_SECONDS = 5.0
_CLIENT_HELLO_TIMEOUT_SECONDS = 5.0


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


async def _await_client_hello(ws: WebSocket) -> SessionUser | None:
    """Wait for the mandatory client_hello frame, validate the optional id_token,
    and return the resulting SessionUser (or None for anonymous).

    Phase 2 is permissive: any error path here (timeout, malformed JSON,
    wrong message type, invalid token) results in an anonymous session
    rather than a connection close.
    """
    try:
        first_raw = await asyncio.wait_for(
            ws.receive_text(), timeout=_CLIENT_HELLO_TIMEOUT_SECONDS
        )
    except TimeoutError:
        logger.warning("missing_client_hello — proceeding anonymous")
        return None
    except WebSocketDisconnect:
        raise

    try:
        first_msg = parse_client_message(first_raw)
    except ProtocolError as exc:
        logger.warning("invalid first message: %s — proceeding anonymous", exc)
        return None

    if not isinstance(first_msg, ClientHelloMessage):
        logger.warning(
            "expected client_hello, got %s — proceeding anonymous",
            type(first_msg).__name__,
        )
        return None

    return validate_id_token(first_msg.id_token)


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
    except (WebSocketDisconnect, RuntimeError, OSError) as exc:
        # send_text on a half-closed/torn-down socket can surface as
        # WebSocketDisconnect, RuntimeError ("close already sent"), or
        # OSError (BrokenPipeError, ConnectionResetError). All mean "stop
        # sending" — log at debug and return cleanly.
        logger.debug("session_id=%s sender stopped: %s", session.id, exc)
        return


async def _client_reader(ws: WebSocket, session: Session) -> None:
    """Read client messages until end_session or disconnect.

    Note: client_hello is consumed BEFORE this reader starts (see
    `_await_client_hello`), so a client_hello arriving here would be a
    duplicate / protocol error from the client side. We log and ignore it.
    """
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

        logger.info(
            "session_id=%s client_message=%s", session.id, type(msg).__name__
        )

        if isinstance(msg, EndSessionMessage):
            logger.info(
                "session_id=%s end_session reason=%s", session.id, msg.reason
            )
            session.end()
            return

        if isinstance(msg, ClientHelloMessage):
            logger.warning(
                "session_id=%s duplicate client_hello after session start", session.id
            )
            continue


@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    await ws.accept()

    try:
        user = await _await_client_hello(ws)
    except WebSocketDisconnect:
        logger.info("session disconnect during client_hello wait")
        return

    session = Session.start(user=user)
    logger.info(
        "session_open session_id=%s uid=%s",
        session.id,
        session.user.uid if session.user else "anonymous",
    )

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
