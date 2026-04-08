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
