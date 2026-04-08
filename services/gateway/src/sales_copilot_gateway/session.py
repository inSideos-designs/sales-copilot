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
    def start(cls, user: SessionUser | None = None) -> Session:
        """Create and return a new active session, optionally tagged with a user."""
        return cls(id=_new_session_id(), started_at_ms=_now_ms(), user=user)

    @property
    def is_active(self) -> bool:
        return self.ended_at_ms is None

    def end(self) -> None:
        """Mark the session as ended. Idempotent."""
        if self.ended_at_ms is None:
            self.ended_at_ms = _now_ms()
