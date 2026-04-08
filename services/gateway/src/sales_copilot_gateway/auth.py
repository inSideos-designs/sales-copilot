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
from firebase_admin import auth as fb_auth
from firebase_admin import credentials

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
