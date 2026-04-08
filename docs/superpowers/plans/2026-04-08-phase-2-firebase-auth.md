# Phase 2 — Firebase Auth (Permissive Plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the entire Firebase Auth pipeline (Google sign-in on the web, ID-token validation on the gateway) without enforcing it. Anonymous visitors keep seeing today's experience; signed-in users get their identity attached to `session.user` for Phase 3+ to gate later.

**Architecture:** Firebase Auth issues an ID token (a JWT signed by Google, auto-refreshed every ~55 min) on the browser side. The browser passes the token in the `client_hello` WebSocket message. The gateway calls `firebase_admin.auth.verify_id_token()` and either attaches a `SessionUser` to the new `Session`, or treats the connection as anonymous (permissive — no rejection in Phase 2). The connection-init flow changes from "send `session_started` immediately on accept" to "wait up to 5s for `client_hello`, validate, then create the session and send `session_started`".

**Tech Stack:**
- **Gateway:** `firebase-admin>=6.5.0` (Python)
- **Web:** `firebase>=11` (JavaScript SDK), specifically `firebase/app` and `firebase/auth`
- **No new test frameworks.** Existing pytest + vitest patterns continue.

**Spec:** [`docs/superpowers/specs/2026-04-08-phase-2-firebase-auth-design.md`](../specs/2026-04-08-phase-2-firebase-auth-design.md)

**What this plan does NOT cover** (deferred to later phases):
- Connection rejection on invalid token (Phase 3+4)
- Per-user quotas, rate limiting (Phase 4+)
- Persistence of users / sessions (Phase 5)
- Auth alerting, audit logging, SLOs (Phase 6)

---

## File Structure

After Phase 2 the repo gains 5 new files and modifies 13 existing ones:

```
sales-copilot/
├── services/
│   ├── gateway/
│   │   ├── pyproject.toml                                    (modify: +firebase-admin)
│   │   ├── uv.lock                                           (auto-update)
│   │   ├── src/sales_copilot_gateway/
│   │   │   ├── auth.py                                       (CREATE)
│   │   │   ├── protocol.py                                   (modify: +id_token field)
│   │   │   ├── session.py                                    (modify: +user field)
│   │   │   └── main.py                                       (modify: wait-for-client_hello flow)
│   │   └── tests/
│   │       ├── test_auth.py                                  (CREATE)
│   │       ├── test_protocol.py                              (modify: +id_token test)
│   │       ├── test_session.py                               (modify: +user field test)
│   │       └── test_ws_endpoint.py                           (modify: +client_hello in 4 tests, +3 new tests)
│   └── web/
│       ├── package.json                                      (modify: +firebase)
│       ├── package-lock.json                                 (auto-update)
│       ├── Dockerfile                                        (modify: +3 ARG/ENV pairs)
│       ├── cloudbuild.yaml                                   (modify: +3 substitutions)
│       └── src/
│           ├── lib/
│           │   ├── firebaseClient.ts                         (CREATE)
│           │   ├── protocol.ts                               (modify: +idToken on ClientMessage)
│           │   ├── wsClient.ts                               (modify: sendClientHello accepts optional idToken)
│           │   └── wsClient.test.ts                          (modify: +idToken test)
│           ├── hooks/
│           │   └── useAuth.ts                                (CREATE)
│           ├── components/
│           │   ├── AuthControls.tsx                          (CREATE)
│           │   ├── SessionPanel.tsx                          (modify: +authSlot prop)
│           │   └── SessionPanel.test.tsx                     (modify: +authSlot test)
│           └── app/
│               └── page.tsx                                  (modify: useAuth + idToken)
```

**Boundaries:**
- `auth.py` is a leaf module — only depends on `firebase_admin` and stdlib. Pure validation logic, no HTTP/WS knowledge.
- `firebaseClient.ts` is a leaf — only depends on `firebase/app` and `firebase/auth`. Module-level singleton with graceful "not configured" fallback.
- `useAuth.ts` is the only React-side place that touches Firebase. `AuthControls.tsx` calls it; `page.tsx` calls it.
- `SessionPanel.tsx` stays purely presentational — it never imports Firebase or `useAuth`. The `authSlot` prop is the only seam.
- The protocol mirror discipline from Phase 1 holds: `protocol.py` and `protocol.ts` change in lockstep.

---

## Phase A — Gateway Groundwork

### Task 1: Add firebase-admin dependency to gateway

**Files:**
- Modify: `services/gateway/pyproject.toml`
- Auto-update: `services/gateway/uv.lock`

- [ ] **Step 1.1: Add firebase-admin to runtime dependencies**

Edit `services/gateway/pyproject.toml`. In the `[project]` table's `dependencies` array, add `"firebase-admin>=6.5.0"` after the existing entries:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "firebase-admin>=6.5.0",
]
```

- [ ] **Step 1.2: Sync the lockfile**

```bash
cd services/gateway
uv sync
```

Expected: `uv` installs `firebase-admin` and its transitive deps (`google-cloud-firestore`, `google-auth`, etc.) and updates `uv.lock`. The whole tree is roughly 20-30 packages.

- [ ] **Step 1.3: Verify nothing broke**

```bash
uv run pytest -v
```

Expected: all 20 existing tests still pass.

```bash
uv run ruff check .
```

Expected: clean.

- [ ] **Step 1.4: Commit**

```bash
git add services/gateway/pyproject.toml services/gateway/uv.lock
git commit -m "feat(gateway): add firebase-admin dependency for Phase 2 auth"
```

---

### Task 2: Create `auth.py` with `SessionUser` and `validate_id_token`

This is the gateway's core auth logic, in isolation. Tests use monkeypatch to avoid touching real Firebase.

**Files:**
- Create: `services/gateway/src/sales_copilot_gateway/auth.py`
- Create: `services/gateway/tests/test_auth.py`

- [ ] **Step 2.1: Write the failing auth tests**

Create `services/gateway/tests/test_auth.py`:

```python
"""Tests for Firebase ID token validation.

These tests monkeypatch firebase_admin.auth.verify_id_token directly.
We never make real network calls or initialize a real Firebase project
in CI — we test our wrapper's branching logic, not Google's JWT verification.
"""

from __future__ import annotations

from typing import Any

import pytest

from sales_copilot_gateway.auth import SessionUser, validate_id_token


def test_returns_none_when_token_missing() -> None:
    assert validate_id_token(None) is None


def test_returns_none_when_token_empty_string() -> None:
    assert validate_id_token("") is None


def test_returns_session_user_on_valid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_verify(token: str, **kwargs: Any) -> dict[str, Any]:
        return {"uid": "u_123", "email": "alice@example.com", "name": "Alice"}

    monkeypatch.setattr(
        "sales_copilot_gateway.auth.fb_auth.verify_id_token", fake_verify
    )
    monkeypatch.setattr(
        "sales_copilot_gateway.auth._firebase_app", lambda: None
    )

    user = validate_id_token("any-token-string")
    assert user == SessionUser(
        uid="u_123", email="alice@example.com", display_name="Alice"
    )


def test_returns_none_when_firebase_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_verify(token: str, **kwargs: Any) -> dict[str, Any]:
        raise ValueError("expired token")

    monkeypatch.setattr(
        "sales_copilot_gateway.auth.fb_auth.verify_id_token", fake_verify
    )
    monkeypatch.setattr(
        "sales_copilot_gateway.auth._firebase_app", lambda: None
    )

    assert validate_id_token("expired-token") is None


def test_handles_token_with_no_email_or_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anonymous Firebase users have only uid; email/name are optional claims."""

    def fake_verify(token: str, **kwargs: Any) -> dict[str, Any]:
        return {"uid": "u_anon"}

    monkeypatch.setattr(
        "sales_copilot_gateway.auth.fb_auth.verify_id_token", fake_verify
    )
    monkeypatch.setattr(
        "sales_copilot_gateway.auth._firebase_app", lambda: None
    )

    user = validate_id_token("anon-token")
    assert user is not None
    assert user.uid == "u_anon"
    assert user.email is None
    assert user.display_name is None
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd services/gateway
uv run pytest tests/test_auth.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'sales_copilot_gateway.auth'`.

- [ ] **Step 2.3: Create `auth.py`**

Create `services/gateway/src/sales_copilot_gateway/auth.py`:

```python
"""Firebase ID token validation.

Phase 2 is permissive: invalid or missing tokens result in anonymous
sessions, NOT rejected connections. Phase 3+4 will add explicit
enforcement at the suggestion-sender level once there is an expensive
backend to gate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import firebase_admin
from firebase_admin import auth as fb_auth, credentials

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SessionUser:
    uid: str
    email: str | None
    display_name: str | None


@lru_cache(maxsize=1)
def _firebase_app() -> firebase_admin.App:
    """Initialize the Firebase Admin SDK once per process.

    On Cloud Run this uses Application Default Credentials automatically.
    For local dev, run `gcloud auth application-default login` once.
    """
    return firebase_admin.initialize_app(credentials.ApplicationDefault())


def validate_id_token(id_token: str | None) -> SessionUser | None:
    """Validate a Firebase ID token. Returns None on missing OR invalid token.

    Phase 2 is permissive — callers MUST NOT use a None return as a hard
    rejection. Treat None as 'unauthenticated/anonymous'.
    """
    if not id_token:
        return None
    try:
        _firebase_app()
        decoded = fb_auth.verify_id_token(id_token)
    except Exception as exc:
        logger.warning("invalid_id_token: %s", exc)
        return None
    return SessionUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        display_name=decoded.get("name"),
    )
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth.py -v
```

Expected: 5 tests pass.

- [ ] **Step 2.5: Run the full suite + ruff**

```bash
uv run pytest -v
uv run ruff check .
```

Expected: 25 tests pass (20 existing + 5 new), ruff clean.

- [ ] **Step 2.6: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/auth.py services/gateway/tests/test_auth.py
git commit -m "feat(gateway): add Firebase ID token validation (permissive mode)"
```

---

### Task 3: Add `id_token` field to `ClientHelloMessage` in `protocol.py`

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/protocol.py`
- Modify: `services/gateway/tests/test_protocol.py`

- [ ] **Step 3.1: Add the failing protocol test**

Edit `services/gateway/tests/test_protocol.py`. Add this test at the end of the file (after `test_parse_unknown_type_raises`):

```python
def test_client_hello_with_id_token() -> None:
    raw = json.dumps(
        {
            "type": "client_hello",
            "clientVersion": "0.1.0",
            "idToken": "fake-firebase-token",
        }
    )
    msg = parse_client_message(raw)
    assert isinstance(msg, ClientHelloMessage)
    assert msg.client_version == "0.1.0"
    assert msg.id_token == "fake-firebase-token"


def test_client_hello_without_id_token_defaults_to_none() -> None:
    raw = json.dumps({"type": "client_hello", "clientVersion": "0.1.0"})
    msg = parse_client_message(raw)
    assert isinstance(msg, ClientHelloMessage)
    assert msg.id_token is None
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd services/gateway
uv run pytest tests/test_protocol.py -v
```

Expected: the two new tests fail (`AttributeError: 'ClientHelloMessage' object has no attribute 'id_token'` or similar). The other 6 tests still pass.

- [ ] **Step 3.3: Update `ClientHelloMessage` and the parser**

Edit `services/gateway/src/sales_copilot_gateway/protocol.py`. Find the `ClientHelloMessage` dataclass and add the new field:

```python
@dataclass(frozen=True)
class ClientHelloMessage:
    type: Literal["client_hello"] = "client_hello"
    client_version: str = ""
    id_token: str | None = None
```

Then find `parse_client_message` and update the `client_hello` branch to read the wire `idToken`:

```python
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
        id_token_raw = data.get("idToken")
        return ClientHelloMessage(
            client_version=str(data.get("clientVersion", "")),
            id_token=str(id_token_raw) if id_token_raw else None,
        )
    if msg_type == "end_session":
        return EndSessionMessage(reason=str(data.get("reason", "")))

    raise ProtocolError(f"unknown message type: {msg_type!r}")
```

The `if id_token_raw else None` keeps empty strings, missing fields, and explicit `null` all collapsed to `None`.

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
uv run pytest tests/test_protocol.py -v
```

Expected: all 8 tests pass (6 existing + 2 new).

- [ ] **Step 3.5: Run the full suite + ruff**

```bash
uv run pytest -v
uv run ruff check .
```

Expected: 27 tests pass, ruff clean.

- [ ] **Step 3.6: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/protocol.py services/gateway/tests/test_protocol.py
git commit -m "feat(gateway): add optional id_token field to ClientHelloMessage"
```

---

### Task 4: Add `user` field to `Session`

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/session.py`
- Modify: `services/gateway/tests/test_session.py`

- [ ] **Step 4.1: Add the failing session tests**

Edit `services/gateway/tests/test_session.py`. Add these tests at the end of the file:

```python
def test_session_default_user_is_none() -> None:
    s = Session.start()
    assert s.user is None


def test_session_can_be_started_with_a_user() -> None:
    from sales_copilot_gateway.auth import SessionUser

    user = SessionUser(uid="u_42", email="bob@example.com", display_name="Bob")
    s = Session.start(user=user)
    assert s.user == user
    assert s.user.uid == "u_42"
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
cd services/gateway
uv run pytest tests/test_session.py -v
```

Expected: the two new tests fail with `AttributeError` (no `user` field) or `TypeError` (`start()` got unexpected keyword `user`).

- [ ] **Step 4.3: Update `Session`**

Edit `services/gateway/src/sales_copilot_gateway/session.py`. Replace the file contents with:

```python
"""Per-connection session state.

A Session tracks one live WebSocket call from start to end. In Phase 2
it holds id + timestamps + an optional authenticated user. Future
phases will add the transcript buffer, running summary, and prompt
builder.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

from sales_copilot_gateway.auth import SessionUser


def _new_session_id() -> str:
    return f"sess_{secrets.token_urlsafe(12)}"


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Session:
    id: str
    started_at_ms: int
    user: SessionUser | None = None
    ended_at_ms: int | None = field(default=None)

    @classmethod
    def start(cls, user: SessionUser | None = None) -> "Session":
        """Create and return a new active session, optionally tagged with a user."""
        return cls(id=_new_session_id(), started_at_ms=_now_ms(), user=user)

    @property
    def is_active(self) -> bool:
        return self.ended_at_ms is None

    def end(self) -> None:
        """Mark the session as ended. Idempotent."""
        if self.ended_at_ms is None:
            self.ended_at_ms = _now_ms()
```

Note the new `from sales_copilot_gateway.auth import SessionUser` import at the top.

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
uv run pytest tests/test_session.py -v
```

Expected: 7 tests pass (5 existing + 2 new).

- [ ] **Step 4.5: Run the full suite + ruff**

```bash
uv run pytest -v
uv run ruff check .
```

Expected: 29 tests pass, ruff clean.

- [ ] **Step 4.6: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/session.py services/gateway/tests/test_session.py
git commit -m "feat(gateway): attach optional SessionUser to Session"
```

---

### Task 5: Wait for `client_hello` at connect, validate, attach user

This is the largest gateway-side change. The connection-init flow flips from "send `session_started` immediately" to "wait for `client_hello`, validate, then create the session".

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/main.py`
- Modify: `services/gateway/tests/test_ws_endpoint.py`

- [ ] **Step 5.1: Update the existing test_ws_endpoint tests AND add the new auth tests (write tests first, then flip the implementation)**

Replace the contents of `services/gateway/tests/test_ws_endpoint.py` with:

```python
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
        # No assertion on user — gateway logs it but doesn't echo back
        # in Phase 2. The fact that session_started arrives is enough.


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
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
cd services/gateway
uv run pytest tests/test_ws_endpoint.py -v
```

Expected: every test fails because (a) the existing tests now send `client_hello` first and the current `main.py` doesn't expect that order to matter, and (b) `validate_id_token` isn't imported in `main.py` yet.

Actually, the tests that send `_ANON_HELLO` then read `session_started` will likely **timeout or hang** because the current `main.py` sends `session_started` immediately before reading the hello. Run with `--timeout=5` if you have `pytest-timeout` installed; otherwise just kill the run after a few seconds.

**Either way, this is the red step. Move on.**

- [ ] **Step 5.3: Rewrite `main.py` for the wait-for-client_hello flow**

Replace `services/gateway/src/sales_copilot_gateway/main.py` with:

```python
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
    except asyncio.TimeoutError:
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
```

Key changes from the previous main.py:
- New imports: `SessionUser`, `validate_id_token`, `ClientHelloMessage`
- New constant: `_CLIENT_HELLO_TIMEOUT_SECONDS = 5.0`
- New helper: `_await_client_hello(ws)` — handles the wait + validation, returns `SessionUser | None`
- The handler calls `_await_client_hello` BEFORE creating the session
- `Session.start(user=user)` passes the result through
- Log line includes the uid (or "anonymous")
- `_client_reader` ignores duplicate `ClientHelloMessage` instead of treating it as a generic message

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
uv run pytest tests/test_ws_endpoint.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5.5: Run the full suite multiple times for flakiness**

```bash
for i in 1 2 3; do uv run pytest -v 2>&1 | tail -3; done
```

Expected: 32 tests pass each run (29 + 3 new ws_endpoint tests). No flakiness.

- [ ] **Step 5.6: Run ruff**

```bash
uv run ruff check .
```

Expected: clean.

- [ ] **Step 5.7: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/main.py services/gateway/tests/test_ws_endpoint.py
git commit -m "feat(gateway): wait for client_hello + validate Firebase token at connect"
```

---

## Phase B — Web Groundwork

### Task 6: Add `firebase` dependency to web

**Files:**
- Modify: `services/web/package.json`
- Auto-update: `services/web/package-lock.json`

- [ ] **Step 6.1: Install firebase**

```bash
cd services/web
npm install firebase@^11
```

Expected: `firebase` and its transitive deps install. Adds ~2-3 MB to `node_modules`.

- [ ] **Step 6.2: Verify nothing broke**

```bash
npm test
npm run lint
npm run build
```

Expected: 16 tests still pass, lint clean, build clean.

- [ ] **Step 6.3: Commit**

```bash
git add services/web/package.json services/web/package-lock.json
git commit -m "feat(web): add firebase SDK dependency for Phase 2 auth"
```

---

### Task 7: Add `idToken` to `protocol.ts` + `wsClient.ts`

**Files:**
- Modify: `services/web/src/lib/protocol.ts`
- Modify: `services/web/src/lib/wsClient.ts`
- Modify: `services/web/src/lib/wsClient.test.ts`

- [ ] **Step 7.1: Add the failing wsClient test**

Edit `services/web/src/lib/wsClient.test.ts`. Add this test inside the `describe("SessionWebSocket", ...)` block, after the existing tests:

```ts
  it("includes idToken in client_hello when provided", () => {
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    ws.sendClientHello("0.1.0", "fake-firebase-token");

    expect(FakeWebSocket.instances[0].sent).toHaveLength(1);
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: "client_hello",
      clientVersion: "0.1.0",
      idToken: "fake-firebase-token",
    });
  });

  it("omits idToken from client_hello when not provided", () => {
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    ws.sendClientHello("0.1.0");

    const payload = JSON.parse(FakeWebSocket.instances[0].sent[0]);
    expect(payload).toEqual({
      type: "client_hello",
      clientVersion: "0.1.0",
    });
    expect(payload).not.toHaveProperty("idToken");
  });
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
cd services/web
npm test
```

Expected: the two new wsClient tests fail (`sendClientHello` only takes one argument; `idToken` is missing from the payload).

- [ ] **Step 7.3: Update `protocol.ts` to add the optional `idToken` field**

Edit `services/web/src/lib/protocol.ts`. Find the `ClientMessage` type union and add `idToken` to the `client_hello` variant:

```ts
export type ClientMessage =
  | { type: "client_hello"; clientVersion: string; idToken?: string }
  | { type: "end_session"; reason: string };
```

`serializeClientMessage` already uses `JSON.stringify(msg)`, which skips undefined values automatically — no change needed.

- [ ] **Step 7.4: Update `wsClient.ts` `sendClientHello` to accept the optional token**

Edit `services/web/src/lib/wsClient.ts`. Find `sendClientHello` and update it:

```ts
  sendClientHello(clientVersion: string, idToken?: string): void {
    this.send({ type: "client_hello", clientVersion, idToken });
  }
```

The `send` method already serializes via `serializeClientMessage`, which handles the optional field.

- [ ] **Step 7.5: Run tests to verify they pass**

```bash
npm test
```

Expected: 18 tests pass (16 existing + 2 new wsClient tests).

- [ ] **Step 7.6: Lint check**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 7.7: Commit**

```bash
git add services/web/src/lib/protocol.ts services/web/src/lib/wsClient.ts services/web/src/lib/wsClient.test.ts
git commit -m "feat(web): thread optional idToken through protocol + wsClient"
```

---

### Task 8: Create `firebaseClient.ts`

A module-level singleton that initializes Firebase. Gracefully degrades to `null` when env vars aren't set (so local docker-compose without Firebase config still works).

**Files:**
- Create: `services/web/src/lib/firebaseClient.ts`

- [ ] **Step 8.1: Create the module**

Create `services/web/src/lib/firebaseClient.ts`:

```ts
/**
 * Firebase client initialization.
 *
 * Reads NEXT_PUBLIC_FIREBASE_* env vars (baked into the client bundle at
 * build time by Next.js). Firebase API keys are PUBLIC by design — they
 * are identifiers, not secrets. Auth security comes from the authorized
 * domains list configured in the Firebase console.
 *
 * Gracefully degrades when env vars are missing: `auth` becomes null and
 * `isFirebaseConfigured` is false. The rest of the app should check
 * `isFirebaseConfigured` before showing sign-in UI.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

let app: FirebaseApp | null = null;

export const auth: Auth | null = (() => {
  if (!config.apiKey || !config.authDomain || !config.projectId) {
    return null;
  }
  app = getApps()[0] ?? initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
  });
  return getAuth(app);
})();

export const isFirebaseConfigured = auth !== null;
```

- [ ] **Step 8.2: Verify it compiles**

```bash
cd services/web
npm run build
```

Expected: build succeeds. No tests for this file (per spec — it's pure config).

- [ ] **Step 8.3: Lint check**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 8.4: Commit**

```bash
git add services/web/src/lib/firebaseClient.ts
git commit -m "feat(web): add Firebase client init module with graceful degradation"
```

---

### Task 9: Create `useAuth` hook

**Files:**
- Create: `services/web/src/hooks/useAuth.ts`

- [ ] **Step 9.1: Create the hooks directory and the hook file**

```bash
mkdir -p services/web/src/hooks
```

Create `services/web/src/hooks/useAuth.ts`:

```ts
"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import { auth, isFirebaseConfigured } from "@/lib/firebaseClient";

/**
 * React hook exposing the current Firebase Auth user and sign-in/out actions.
 *
 * - When Firebase is not configured (e.g., local docker-compose without env
 *   vars), `user` stays null and `isConfigured` is false. Sign-in functions
 *   become no-ops so callers don't have to special-case the local setup.
 * - `loading` starts true while the initial auth state is resolving and
 *   flips to false on the first onAuthStateChanged callback.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) return;
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;
    await fbSignOut(auth);
  }, []);

  return {
    user,
    loading,
    signInWithGoogle,
    signOut,
    isConfigured: isFirebaseConfigured,
  };
}
```

- [ ] **Step 9.2: Verify it compiles**

```bash
cd services/web
npm run build
```

Expected: build succeeds. No unit tests for this file (per spec — Firebase mocking is a rabbit hole, coverage comes from manual smoke test).

- [ ] **Step 9.3: Lint check**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 9.4: Commit**

```bash
git add services/web/src/hooks/useAuth.ts
git commit -m "feat(web): add useAuth hook wrapping Firebase Auth client SDK"
```

---

### Task 10: Create `AuthControls` component

**Files:**
- Create: `services/web/src/components/AuthControls.tsx`

- [ ] **Step 10.1: Create the component**

Create `services/web/src/components/AuthControls.tsx`:

```tsx
"use client";

import { useAuth } from "@/hooks/useAuth";

/**
 * Header sign-in / signed-in widget. Calls useAuth() directly.
 *
 * - Firebase not configured (local docker-compose): renders nothing.
 * - Loading: renders a tiny "..." placeholder so the layout doesn't jump.
 * - Signed out: renders a "▸ SIGN IN WITH GOOGLE" mono pill button.
 * - Signed in: renders avatar + display name + small sign-out link.
 */
export function AuthControls() {
  const { user, loading, signInWithGoogle, signOut, isConfigured } = useAuth();

  if (!isConfigured) {
    return null;
  }

  if (loading) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        ...
      </span>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => {
          void signInWithGoogle();
        }}
        className="inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-primary transition-colors hover:bg-primary/20 hover:border-primary/80"
      >
        <span aria-hidden>▸</span>
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
      {user.photoURL ? (
        // Use a plain img (not next/image) — Google profile photos are
        // small, served from gstatic.com, and we don't want to plumb a
        // remote loader through next.config for one image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.photoURL}
          alt=""
          className="h-5 w-5 rounded-full ring-1 ring-border"
        />
      ) : null}
      <span className="text-foreground/80 normal-case tracking-normal">
        {user.displayName ?? user.email ?? "Signed in"}
      </span>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Sign out"
      >
        × sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify it compiles**

```bash
cd services/web
npm run build
```

Expected: build succeeds.

- [ ] **Step 10.3: Lint check**

```bash
npm run lint
```

Expected: clean. (The eslint-disable comment for `no-img-element` is intentional — see the inline comment.)

- [ ] **Step 10.4: Commit**

```bash
git add services/web/src/components/AuthControls.tsx
git commit -m "feat(web): add AuthControls header widget (sign-in / signed-in)"
```

---

### Task 11: Add `authSlot` prop to `SessionPanel`

**Files:**
- Modify: `services/web/src/components/SessionPanel.tsx`
- Modify: `services/web/src/components/SessionPanel.test.tsx`

- [ ] **Step 11.1: Add the failing test**

Edit `services/web/src/components/SessionPanel.test.tsx`. Add this test inside the `describe("SessionPanel", ...)` block:

```tsx
  it("renders the auth slot in the header when provided", () => {
    render(
      <SessionPanel
        status="idle"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
        authSlot={<div data-testid="auth-slot">SLOT_CONTENT</div>}
      />,
    );
    const slot = screen.getByTestId("auth-slot");
    expect(slot).toBeInTheDocument();
    expect(slot).toHaveTextContent("SLOT_CONTENT");
  });
```

- [ ] **Step 11.2: Run tests to verify it fails**

```bash
cd services/web
npm test
```

Expected: the new test fails because `SessionPanel` doesn't accept an `authSlot` prop yet.

- [ ] **Step 11.3: Add the prop to `SessionPanel`**

Edit `services/web/src/components/SessionPanel.tsx`. In the `Props` interface, add the new optional prop after `errorMessage`:

```tsx
interface Props {
  status: SessionStatus;
  suggestions: RenderedSuggestion[];
  onStart: () => void;
  onEnd: () => void;
  errorMessage?: string;
  sessionId?: string;
  authSlot?: React.ReactNode;
}
```

In the function signature, destructure the new prop:

```tsx
export function SessionPanel({
  status,
  suggestions,
  onStart,
  onEnd,
  errorMessage,
  sessionId,
  authSlot,
}: Props) {
```

In the header JSX, find the metadata strip (the `<div className="flex items-center gap-3 font-mono ...">` block) and render `authSlot` at the START of it, before the session id:

```tsx
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]">
            {authSlot}
            {sessionId ? (
              <span className="text-muted-foreground">
                <span className="text-foreground/50">SESS</span>{" "}
                {sessionId.replace(/^sess_/, "")}
              </span>
            ) : null}
            <span
              className="text-muted-foreground"
              data-testid="status-line"
              aria-live="polite"
            >
              {/* ... existing status line ... */}
            </span>
          </div>
```

Leaving the rest of the file unchanged.

- [ ] **Step 11.4: Run tests to verify they pass**

```bash
npm test
```

Expected: 19 tests pass (16 existing web + 2 wsClient idToken from Task 7 + 1 SessionPanel authSlot — wait, 16 + 2 + 1 = 19. Right.)

- [ ] **Step 11.5: Lint check**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 11.6: Commit**

```bash
git add services/web/src/components/SessionPanel.tsx services/web/src/components/SessionPanel.test.tsx
git commit -m "feat(web): add authSlot prop to SessionPanel header"
```

---

### Task 12: Wire `useAuth` and `AuthControls` into `page.tsx`

**Files:**
- Modify: `services/web/src/app/page.tsx`

- [ ] **Step 12.1: Replace `page.tsx` with the auth-aware version**

Edit `services/web/src/app/page.tsx`. Replace its entire contents with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SessionPanel, type RenderedSuggestion, type SessionStatus } from "@/components/SessionPanel";
import { AuthControls } from "@/components/AuthControls";
import { captureMeetingTabAudio, AudioCaptureError } from "@/lib/audioCapture";
import { SessionWebSocket } from "@/lib/wsClient";
import type { ServerMessage } from "@/lib/protocol";
import { useAuth } from "@/hooks/useAuth";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8080/ws/session";

export default function HomePage() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<RenderedSuggestion[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const { user } = useAuth();

  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close("cleanup");
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    sessionStartedAtRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_started") {
      setStatus("active");
      setSessionId(msg.sessionId);
      sessionStartedAtRef.current = msg.startedAtMs;
      return;
    }
    if (msg.type === "suggestion") {
      const startedAt = sessionStartedAtRef.current;
      const offsetMs = startedAt !== null ? msg.tickAtMs - startedAt : undefined;
      setSuggestions((prev) => [
        ...prev,
        {
          id: `${msg.tickAtMs}-${prev.length}`,
          intent: msg.intent,
          suggestion: msg.suggestion,
          sentiment: msg.sentiment,
          tickOffsetMs: offsetMs,
        },
      ]);
      return;
    }
    if (msg.type === "error") {
      setErrorMessage(`${msg.code}: ${msg.message}`);
      return;
    }
  }, []);

  const handleStart = useCallback(async () => {
    setErrorMessage(undefined);
    setSuggestions([]);
    setSessionId(undefined);
    setStatus("connecting");

    try {
      streamRef.current = await captureMeetingTabAudio();
    } catch (err) {
      if (err instanceof AudioCaptureError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage((err as Error).message);
      }
      setStatus("error");
      return;
    }

    // Always re-fetch the ID token right before opening the WS — Firebase
    // silently refreshes if the cached one is near expiry.
    const idToken = user ? await user.getIdToken() : undefined;

    const ws = new SessionWebSocket({
      url: GATEWAY_URL,
      onOpen: () => {
        ws.sendClientHello("0.1.0", idToken);
      },
      onMessage: handleServerMessage,
      onClose: () => {
        cleanup();
        setStatus((prev) => (prev === "error" ? "error" : "ended"));
      },
      onError: () => {
        setErrorMessage("WebSocket error. Is the gateway running?");
        setStatus("error");
        cleanup();
      },
    });
    wsRef.current = ws;
    ws.connect();
  }, [cleanup, handleServerMessage, user]);

  const handleEnd = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.sendEndSession("user_clicked_end");
    }
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  return (
    <main className="min-h-screen">
      <SessionPanel
        status={status}
        suggestions={suggestions}
        onStart={handleStart}
        onEnd={handleEnd}
        errorMessage={errorMessage}
        sessionId={sessionId}
        authSlot={<AuthControls />}
      />
    </main>
  );
}
```

Two changes vs the previous version:
1. New `import { useAuth }` and `import { AuthControls }` lines, and the hook is called as `const { user } = useAuth();`.
2. `handleStart` now does `const idToken = user ? await user.getIdToken() : undefined;` and passes the token as the second arg to `ws.sendClientHello("0.1.0", idToken)`.
3. `handleStart`'s `useCallback` deps array gains `user` so the closure stays fresh on auth state changes.
4. The `<SessionPanel>` JSX now passes `authSlot={<AuthControls />}`.

- [ ] **Step 12.2: Verify lint, tests, and build all pass**

```bash
cd services/web
npm run lint
npm test
npm run build
```

Expected:
- Lint clean.
- All 19 tests pass.
- Build succeeds. The page bundle grows by a few KB for the Firebase client SDK.

- [ ] **Step 12.3: Commit**

```bash
git add services/web/src/app/page.tsx
git commit -m "feat(web): wire useAuth + AuthControls into HomePage"
```

---

## Phase C — Build / Deploy Plumbing

### Task 13: Update Dockerfile to accept Firebase build args

**Files:**
- Modify: `services/web/Dockerfile`

- [ ] **Step 13.1: Add the three new ARG/ENV pairs**

Edit `services/web/Dockerfile`. Find the existing build stage (around line 11-14) and add the new args alongside the existing `NEXT_PUBLIC_GATEWAY_WS_URL`:

```dockerfile
# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at runtime. Pass via --build-arg in CI / Cloud Build. The defaults
# are the local docker-compose values so the existing dev workflow keeps
# working without any extra env setup.
ARG NEXT_PUBLIC_GATEWAY_WS_URL=ws://localhost:8080/ws/session
ENV NEXT_PUBLIC_GATEWAY_WS_URL=$NEXT_PUBLIC_GATEWAY_WS_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY=
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
RUN npm run build
```

The empty defaults (`ARG NEXT_PUBLIC_FIREBASE_API_KEY=`) mean local `docker compose up` produces a build where Firebase is unconfigured — the AuthControls component renders nothing and the existing canned demo continues working unchanged.

- [ ] **Step 13.2: Verify the local docker build still works**

```bash
cd /Users/cultistsid/projects/sales-copilot
docker compose build web 2>&1 | tail -10
```

Expected: build succeeds without errors.

- [ ] **Step 13.3: Commit**

```bash
git add services/web/Dockerfile
git commit -m "feat(web): accept Firebase config as Docker build args"
```

---

### Task 14: Update `cloudbuild.yaml` with Firebase substitutions

**Files:**
- Modify: `services/web/cloudbuild.yaml`

- [ ] **Step 14.1: Add the three new substitutions**

Edit `services/web/cloudbuild.yaml`. Replace its contents with:

```yaml
# Cloud Build config for the web service.
#
# NEXT_PUBLIC_* env vars are baked into the Next.js client bundle at build
# time, so we have to pass the gateway URL AND the Firebase config as
# Docker build-args here rather than as Cloud Run env vars.
#
# Submit with:
#   gcloud builds submit --config=cloudbuild.yaml \
#     --substitutions=_GATEWAY_WS_URL=wss://gw/ws/session,\
# _FIREBASE_API_KEY=AIza...,\
# _FIREBASE_AUTH_DOMAIN=sales-copilot-04130.firebaseapp.com,\
# _FIREBASE_PROJECT_ID=sales-copilot-04130,\
# _TAG=phase2

substitutions:
  _GATEWAY_WS_URL: ws://localhost:8080/ws/session
  _FIREBASE_API_KEY: ""
  _FIREBASE_AUTH_DOMAIN: ""
  _FIREBASE_PROJECT_ID: ""
  _TAG: phase2

steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --build-arg
      - NEXT_PUBLIC_GATEWAY_WS_URL=${_GATEWAY_WS_URL}
      - --build-arg
      - NEXT_PUBLIC_FIREBASE_API_KEY=${_FIREBASE_API_KEY}
      - --build-arg
      - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${_FIREBASE_AUTH_DOMAIN}
      - --build-arg
      - NEXT_PUBLIC_FIREBASE_PROJECT_ID=${_FIREBASE_PROJECT_ID}
      - -t
      - us-central1-docker.pkg.dev/$PROJECT_ID/sales-copilot/web:${_TAG}
      - .

images:
  - us-central1-docker.pkg.dev/$PROJECT_ID/sales-copilot/web:${_TAG}
```

- [ ] **Step 14.2: Commit**

```bash
git add services/web/cloudbuild.yaml
git commit -m "feat(web): add Firebase config substitutions to cloudbuild.yaml"
```

---

## Phase D — GCP / Firebase Setup + Deployment

### Task 15: Firebase console setup (one-time, manual)

This task is a manual checklist. No code changes, no commit. Each step has a verification you can run to confirm it stuck.

**Project:** `sales-copilot-04130`

- [ ] **Step 15.1: Enable the Identity Toolkit API**

```bash
gcloud services enable identitytoolkit.googleapis.com --project=sales-copilot-04130
```

Expected: silent success.

Verify:

```bash
gcloud services list --enabled --project=sales-copilot-04130 2>&1 | grep identitytoolkit
```

Expected: one matching line.

- [ ] **Step 15.2: Initialize Firebase on the project**

Open <https://console.firebase.google.com>, click **Add project**, select **sales-copilot-04130** from the dropdown of existing GCP projects (instead of creating a new project). Skip Google Analytics. Wait for "Your new project is ready" → Continue.

- [ ] **Step 15.3: Create a Web app in Firebase**

In the Firebase console for the project: Project Overview (the gear icon top-left → Project settings) → scroll down to "Your apps" → click the **`</>` (Web)** icon.

- App nickname: `sales-copilot-web`
- Do NOT enable Firebase Hosting
- Click **Register app**

You'll see a `firebaseConfig` object on the next screen:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "sales-copilot-04130.firebaseapp.com",
  projectId: "sales-copilot-04130",
  storageBucket: "sales-copilot-04130.firebasestorage.app",
  messagingSenderId: "...",
  appId: "1:..."
};
```

**Copy `apiKey`, `authDomain`, and `projectId` to a scratch file** — you'll use them in Task 18.

Click **Continue to console**.

- [ ] **Step 15.4: Enable the Google sign-in provider**

Firebase console → **Authentication** (left nav) → **Get started** → **Sign-in method** tab → click **Google** in the provider list → toggle **Enable** → set the support email to your own → **Save**.

- [ ] **Step 15.5: Add Cloud Run domain to authorized domains**

Firebase console → **Authentication** → **Settings** tab → **Authorized domains** → **Add domain** → enter:

```
sales-copilot-web-360277569038.us-central1.run.app
```

Click **Add**.

Verify the list now includes:
- `localhost` (default)
- `sales-copilot-04130.firebaseapp.com` (default)
- `sales-copilot-04130.web.app` (default)
- `sales-copilot-web-360277569038.us-central1.run.app` (just added)

- [ ] **Step 15.6: Save the config in /tmp for the next tasks**

```bash
cat > /tmp/sc-firebase.env <<'EOF'
FIREBASE_API_KEY=PASTE_apiKey_FROM_STEP_15.3
FIREBASE_AUTH_DOMAIN=sales-copilot-04130.firebaseapp.com
FIREBASE_PROJECT_ID=sales-copilot-04130
EOF
```

Then edit the file and replace `PASTE_apiKey_FROM_STEP_15.3` with the real API key. Tasks 17 and 18 source this file.

This file is ephemeral — `/tmp/` not the repo. The API key is publicly visible in the deployed bundle by Firebase design, but there's no need to commit it.

---

### Task 16: Build + push the gateway image

**No code changes — pure deploy step.**

- [ ] **Step 16.1: Build and push via Cloud Build**

```bash
cd /Users/cultistsid/projects/sales-copilot/services/gateway
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/sales-copilot-04130/sales-copilot/gateway:phase2 \
  --project=sales-copilot-04130 \
  2>&1 | tail -10
```

Expected: SUCCESS, image pushed to AR.

---

### Task 17: Deploy the gateway with `FIREBASE_PROJECT_ID`

- [ ] **Step 17.1: Deploy a new revision**

```bash
gcloud run deploy sales-copilot-gateway \
  --image=us-central1-docker.pkg.dev/sales-copilot-04130/sales-copilot/gateway:phase2 \
  --region=us-central1 \
  --project=sales-copilot-04130 \
  --port=8080 \
  --allow-unauthenticated \
  --timeout=3600 \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars="LOG_LEVEL=INFO,SUGGESTION_TICK_SECONDS=2.0,FIREBASE_PROJECT_ID=sales-copilot-04130" \
  2>&1 | tail -10
```

Expected: revision deployed, URL unchanged.

- [ ] **Step 17.2: Verify health and a real WSS round-trip**

```bash
curl -sf https://sales-copilot-gateway-360277569038.us-central1.run.app/health
```

Expected: `{"status":"ok","version":"0.1.0"}`

```bash
cd /Users/cultistsid/projects/sales-copilot/services/gateway
uv run python - <<'PY'
import asyncio, json
import websockets

async def main():
    url = 'wss://sales-copilot-gateway-360277569038.us-central1.run.app/ws/session'
    async with websockets.connect(url) as ws:
        # Phase 2: gateway waits for client_hello before sending session_started
        await ws.send(json.dumps({'type': 'client_hello', 'clientVersion': '0.1.0'}))
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert msg['type'] == 'session_started', msg
        print('OK session_started:', msg['sessionId'])
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert msg['type'] == 'suggestion', msg
        print('OK suggestion:', msg['intent'])
        await ws.send(json.dumps({'type': 'end_session', 'reason': 'phase2-smoke'}))
        try:
            await asyncio.wait_for(ws.recv(), timeout=3)
        except websockets.ConnectionClosed:
            print('OK clean close')

asyncio.run(main())
PY
```

Expected: `OK session_started: sess_...`, `OK suggestion: <intent>`, `OK clean close`. Also verify in the gateway logs:

```bash
gcloud run services logs read sales-copilot-gateway \
  --region=us-central1 --project=sales-copilot-04130 --limit=10 2>&1 | grep "session_open"
```

Expected: a `session_open session_id=sess_xxx uid=anonymous` line (because the smoke test didn't pass a real Firebase token).

---

### Task 18: Build + push the web image with Firebase config

- [ ] **Step 18.1: Submit Cloud Build with all four substitutions**

```bash
. /tmp/sc-firebase.env
cd /Users/cultistsid/projects/sales-copilot/services/web

gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_GATEWAY_WS_URL=wss://sales-copilot-gateway-360277569038.us-central1.run.app/ws/session,_FIREBASE_API_KEY=$FIREBASE_API_KEY,_FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN,_FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,_TAG=phase2" \
  --project=sales-copilot-04130 \
  2>&1 | tail -10
```

Expected: SUCCESS, image pushed to AR with tag `phase2`.

---

### Task 19: Deploy the web image

- [ ] **Step 19.1: Deploy a new revision**

```bash
gcloud run deploy sales-copilot-web \
  --image=us-central1-docker.pkg.dev/sales-copilot-04130/sales-copilot/web:phase2 \
  --region=us-central1 \
  --project=sales-copilot-04130 \
  2>&1 | tail -10
```

Expected: revision deployed, URL unchanged.

- [ ] **Step 19.2: Verify the page renders**

```bash
curl -sf https://sales-copilot-web-360277569038.us-central1.run.app/ -o /tmp/sc-phase2.html -w "HTTP %{http_code}, %{size_download} bytes\n"
grep -oE "Sales Copilot|Start Session|Sign in with Google|Standby" /tmp/sc-phase2.html | sort -u
```

Expected: HTTP 200, output includes `Sales Copilot`, `Start Session`, `Sign in with Google`, `Standby`.

- [ ] **Step 19.3: Verify the Firebase config is baked into the JS bundle**

```bash
CHUNK=$(grep -oE '/_next/static/chunks/app/page-[^"]*\.js' /tmp/sc-phase2.html | head -1)
curl -sf "https://sales-copilot-web-360277569038.us-central1.run.app$CHUNK" \
  | grep -oE "AIza[A-Za-z0-9_-]{20,}" | head -1
```

Expected: prints the Firebase API key (which is public-by-design and identical to what's in `/tmp/sc-firebase.env`).

---

## Phase E — Smoke Test + Documentation

### Task 20: Manual end-to-end smoke test

This is the Phase 2 equivalent of Task 18 from Phase 1. It exercises the full pipeline including the Google sign-in popup, which can't be automated from CLI. No commit for this task — it's verification only.

- [ ] **Step 20.1: Open the deployed web URL in Chrome or Edge**

<https://sales-copilot-web-360277569038.us-central1.run.app>

Verify: page loads, "▸ SIGN IN WITH GOOGLE" button appears in the header next to the status pill, status shows `IDLE`.

- [ ] **Step 20.2: Open a second tab to share**

<http://example.com> in another tab.

- [ ] **Step 20.3: Anonymous flow first — verify it still works**

Click **Start Session**, pick the example.com tab in the picker, **check "Share tab audio"**, click Share. Confirm:

- Status flips `connecting` → `active` within ~1 second
- A suggestion card appears within ~3 seconds (`SUGGESTION_TICK_SECONDS=2.0` on the gateway)
- Click **End Session**, status flips to `ended`

In another terminal, check the gateway logs:

```bash
gcloud run services logs read sales-copilot-gateway \
  --region=us-central1 --project=sales-copilot-04130 --limit=20 2>&1 | grep session_open
```

Expected: the most recent `session_open` line shows `uid=anonymous`.

- [ ] **Step 20.4: Sign in with Google**

Back in the browser, click **▸ SIGN IN WITH GOOGLE**. A Google OAuth popup appears. Sign in with any Google account.

Verify:
- The popup closes
- The header now shows your Google avatar + display name + "× sign out" link
- The **Start Session** button is still enabled

- [ ] **Step 20.5: Authenticated session — verify the gateway sees the user**

Click **Start Session**, share the example.com tab again. Confirm the session runs as before (status active, suggestions stream).

In the terminal:

```bash
gcloud run services logs read sales-copilot-gateway \
  --region=us-central1 --project=sales-copilot-04130 --limit=20 2>&1 | grep session_open
```

Expected: the most recent `session_open` line shows `uid=<your-firebase-uid>` (a string starting with random characters), NOT `uid=anonymous`.

- [ ] **Step 20.6: Sign out and verify the next session is anonymous again**

Click **End Session**, then click **× sign out**.

Verify the header reverts to "▸ SIGN IN WITH GOOGLE".

Click **Start Session**, share the tab. After it runs, check the logs again:

```bash
gcloud run services logs read sales-copilot-gateway \
  --region=us-central1 --project=sales-copilot-04130 --limit=20 2>&1 | grep session_open
```

Expected: the latest `session_open` line is `uid=anonymous`.

- [ ] **Step 20.7: Verify the canned demo URL still works for first-time visitors**

Open the URL in an incognito window. Verify:
- Page loads
- Status shows `IDLE`
- "▸ SIGN IN WITH GOOGLE" is visible (Firebase IS configured) but NOT required
- Clicking **Start Session** works exactly as before — visitor sees canned suggestions without ever signing in

- [ ] **Step 20.8: (Optional) Token refresh edge case**

If you have time: after step 20.5 (signed-in session ran successfully), leave the tab open for >65 minutes. Then click **Start Session** again. Firebase's `getIdToken()` should silently refresh the expired token and the new session should work normally. If it fails, that's a real bug — Phase 2 is supposed to handle this transparently.

---

### Task 21: Update README to mention Phase 2

**Files:**
- Modify: `README.md`

- [ ] **Step 21.1: Update the roadmap row + add an env var note**

Edit `README.md`. In the **Roadmap** table, change the Phase 2 row's Status from "Planned" to "✅ Shipped":

```markdown
| **Phase 2** | Identity Platform auth, short-lived signed WS tokens (Firebase Google sign-in, permissive plumbing for Phase 3+4 to gate later) | ✅ Shipped |
```

In the **Web (Next.js)** development section, add the new env vars to the table:

```markdown
Env vars:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GATEWAY_WS_URL` | `ws://localhost:8080/ws/session` | Baked at **build time** — see [`services/web/Dockerfile`](services/web/Dockerfile) |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | (empty) | Firebase web API key. Public by design. Empty disables sign-in (graceful degradation). |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | (empty) | Firebase auth domain (e.g. `sales-copilot-04130.firebaseapp.com`). |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | (empty) | Firebase project id. |
```

In the **Gateway (Python)** section, add the new env var:

```markdown
Env vars:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Root logging level |
| `SUGGESTION_TICK_SECONDS` | `5.0` | Seconds between canned suggestions |
| `FIREBASE_PROJECT_ID` | (unset) | If set, the gateway can validate Firebase ID tokens passed in `client_hello`. Permissive — invalid/missing tokens still result in anonymous sessions. |
```

In the **Manual smoke test** section, add an optional sign-in step:

```markdown
**Optional: try the signed-in flow.**
4a. Click **▸ Sign in with Google** in the header (only visible if Firebase env vars are set).
4b. Sign in with any Google account → verify the avatar appears in the header.
4c. Start a session as before — gateway logs will show `uid=<your-firebase-uid>` instead of `uid=anonymous`.
```

- [ ] **Step 21.2: Commit**

```bash
git add README.md
git commit -m "docs: mark Phase 2 shipped + document Firebase env vars"
```

- [ ] **Step 21.3: Push to origin**

```bash
git push origin main
```

Expected: pushes the entire Phase 2 sequence (Tasks 1-21) to GitHub.

---

## Done

After Task 21, Phase 2 is complete:

- 5 new files (`auth.py`, `test_auth.py`, `firebaseClient.ts`, `useAuth.ts`, `AuthControls.tsx`)
- 13 modified files
- Gateway test count: 20 → 32 (+5 auth, +2 protocol, +2 session, +3 ws_endpoint)
- Web test count: 16 → 19 (+2 wsClient, +1 SessionPanel)
- Both Cloud Run services redeployed with new revisions
- Manual smoke test confirms the full anonymous + signed-in flows work end-to-end
- README updated with Phase 2 status and env var documentation

Phase 3 (real Chirp 2 STT) is the next plan to write. It will be the first phase that adds an enforcement check on `session.user`.
