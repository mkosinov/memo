"""GH #529 Task 1 — naive-UTC instant helper ``utc_now()`` (pure unit).

Spec §1: ``utc_now()`` is THE helper for instants (TTL, created/updated
stamps, journal, audit) — a naive datetime equal to the UTC instant.
Wall-clock schedule time is a different helper —
``src/notify/time.py::business_now()`` (business zone, also naive).
Aware datetimes and zones are #498; until then all values are naive.
"""

from datetime import UTC, datetime

import pytest

from src.util.utc import utc_now

pytestmark = [pytest.mark.unit, pytest.mark.pure_unit]


def test_utc_now_is_naive() -> None:
    """utc_now() returns a naive datetime: tzinfo is None."""
    assert utc_now().tzinfo is None


def test_utc_now_matches_utc_instant_within_2s() -> None:
    """utc_now() equals the UTC instant (≤2 s tolerance for test runtime)."""
    reference = datetime.now(UTC).replace(tzinfo=None)
    delta = abs((utc_now() - reference).total_seconds())
    assert delta <= 2
