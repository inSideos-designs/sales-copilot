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
