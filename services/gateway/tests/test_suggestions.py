"""Tests for the canned suggestion generator."""

import asyncio

from sales_copilot_gateway.protocol import SuggestionMessage
from sales_copilot_gateway.suggestions import canned_suggestion_stream


async def test_emits_suggestions_with_expected_shape() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.0)  # zero for speed
    got: list[SuggestionMessage] = []
    async for msg in stream:
        got.append(msg)
        if len(got) >= 3:
            break

    assert len(got) == 3
    for msg in got:
        assert isinstance(msg, SuggestionMessage)
        assert msg.intent
        assert msg.suggestion
        assert -2 <= msg.sentiment <= 2
        assert 0.0 <= msg.confidence <= 1.0


async def test_rotates_through_canned_bank() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.0)
    got: list[str] = []
    async for msg in stream:
        got.append(msg.suggestion)
        if len(got) >= 6:
            break

    # With 3 canned lines, we should see each at least once in 6 ticks
    assert len(set(got)) >= 3


async def test_respects_tick_seconds_delay() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.05)
    t0 = asyncio.get_event_loop().time()
    n = 0
    async for _msg in stream:
        n += 1
        if n >= 3:
            break
    elapsed = asyncio.get_event_loop().time() - t0
    # Three ticks * 0.05s = 0.15s minimum, allow generous margin
    assert elapsed >= 0.10
