"""Canned suggestion generator for Phase 1.

In Phase 4 this is replaced with a Gemini-backed generator that takes
a transcript window + running summary and streams suggestions back.
The public interface (`canned_suggestion_stream`) will be renamed then,
but the shape — an async iterator of SuggestionMessage — stays the same.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from sales_copilot_gateway.protocol import SuggestionMessage

_CANNED_BANK: tuple[tuple[str, str, int, float], ...] = (
    ("discovery", "Ask what metrics they use to measure success today.", 0, 0.78),
    ("qualify_budget", "Confirm budget range before showing pricing.", 1, 0.82),
    (
        "handle_objection",
        "Acknowledge the concern, then share a relevant customer story.",
        -1,
        0.74,
    ),
)


async def canned_suggestion_stream(
    tick_seconds: float = 5.0,
) -> AsyncIterator[SuggestionMessage]:
    """Yield a SuggestionMessage every `tick_seconds`, cycling the bank forever.

    Pass `tick_seconds=0.0` in tests to drain immediately.
    """
    i = 0
    while True:
        if tick_seconds > 0:
            await asyncio.sleep(tick_seconds)
        else:
            # Cooperative yield so tests can break out
            await asyncio.sleep(0)

        intent, suggestion, sentiment, confidence = _CANNED_BANK[i % len(_CANNED_BANK)]
        yield SuggestionMessage(
            tick_at_ms=int(time.time() * 1000),
            sentiment=sentiment,
            intent=intent,
            suggestion=suggestion,
            confidence=confidence,
        )
        i += 1
