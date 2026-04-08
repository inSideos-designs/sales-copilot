"""Tests for the Session lifecycle."""

from sales_copilot_gateway.session import Session


def test_session_has_unique_id_prefix() -> None:
    s = Session.start()
    assert s.id.startswith("sess_")
    assert len(s.id) > len("sess_")


def test_session_two_sessions_have_different_ids() -> None:
    s1 = Session.start()
    s2 = Session.start()
    assert s1.id != s2.id


def test_session_started_at_ms_is_set() -> None:
    s = Session.start()
    assert s.started_at_ms > 0


def test_session_is_active_after_start_and_inactive_after_end() -> None:
    s = Session.start()
    assert s.is_active
    s.end()
    assert not s.is_active


def test_session_end_is_idempotent() -> None:
    s = Session.start()
    s.end()
    first_ended = s.ended_at_ms
    s.end()
    assert s.ended_at_ms == first_ended


def test_session_default_user_is_none() -> None:
    s = Session.start()
    assert s.user is None


def test_session_can_be_started_with_a_user() -> None:
    from sales_copilot_gateway.auth import SessionUser

    user = SessionUser(uid="u_42", email="bob@example.com", display_name="Bob")
    s = Session.start(user=user)
    assert s.user == user
    assert s.user.uid == "u_42"
