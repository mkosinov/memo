"""#482 Task 2 (spec §3.9, §3.2): notify settings + business wall clock.

Pure unit tests — no DB, no app. Covers:
- the notify settings of parts 1 and 3 (defaults, spec §3.9; the part-3
  delivery-worker retry cap NOTIFY_SEND_RETRIES — family #476 §4.5);
- NOTIFY_ENABLED forced off in the testing profile (family #476 §3.3 /
  US-7: the standard test run must never boot the enabled subsystem —
  it would require Redis);
- business_now(): naive wall clock of the explicit BUSINESS_TIMEZONE,
  independent of the server TZ, re-read from settings at call time
  (spec §3.2 — panel finding: never the server TZ).
"""

import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from src.core.config import Settings, settings
from src.notify.time import business_now

pytestmark = pytest.mark.pure_unit

# Two back-to-back clock reads differ by microseconds; 2 s is generous
# yet far below any zone offset (3 h for Moscow vs UTC).
_TOLERANCE_SECONDS = 2


@contextmanager
def _server_tz(tz: str) -> Iterator[None]:
    """Pin the process-local TZ and restore it afterwards.

    ``time.tzset()`` is process-global; the restore in ``finally``
    returns the worker to its original zone, so sibling tests in the
    same process are unaffected.
    """
    old_tz = os.environ.get("TZ")
    os.environ["TZ"] = tz
    time.tzset()
    try:
        yield
    finally:
        if old_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old_tz
        time.tzset()


class TestNotifySettingsDefaults:
    """Spec §3.9 (part 1) + family §4.5 (part 3): the notify settings."""

    def test_defaults(self) -> None:
        s = Settings(_env_file=None)
        assert s.NOTIFY_ENABLED is False
        assert s.NOTIFY_POLL_INTERVAL == 1
        assert s.NOTIFY_CHANNEL_PRIORITY == "telegram"
        assert s.NOTIFY_REENQUEUE_AFTER == 120
        assert s.NOTIFY_SEND_RETRIES == 3
        assert s.BUSINESS_TIMEZONE == "Europe/Moscow"


class TestNotifyEnabledForcedOffInTesting:
    """US-7 / family §3.3: the testing profile never runs the subsystem."""

    def test_testing_profile_forces_off_even_if_env_says_true(self) -> None:
        s = Settings(_env_file=None, ENV="testing", NOTIFY_ENABLED=True)
        assert s.NOTIFY_ENABLED is False

    def test_development_keeps_explicit_true(self) -> None:
        s = Settings(_env_file=None, ENV="development", NOTIFY_ENABLED=True)
        assert s.NOTIFY_ENABLED is True


class TestBusinessNow:
    """Spec §3.2: naive wall clock of the explicit business zone."""

    def test_naive_wall_clock_of_business_zone_under_utc_server(self) -> None:
        with _server_tz("UTC"):
            now = business_now()

        expected = datetime.now(ZoneInfo("Europe/Moscow")).replace(tzinfo=None)
        assert now.tzinfo is None
        assert abs((now - expected).total_seconds()) < _TOLERANCE_SECONDS

    def test_independent_of_server_tz(self) -> None:
        """A server in Kamchatka still gets the Moscow wall clock.

        A naive ``datetime.now()`` implementation would drift 9 h here
        (3 h under the UTC test above) — far beyond the tolerance.
        """
        with _server_tz("Asia/Kamchatka"):
            now = business_now()

        expected = datetime.now(ZoneInfo("Europe/Moscow")).replace(tzinfo=None)
        assert abs((now - expected).total_seconds()) < _TOLERANCE_SECONDS

    def test_rereads_settings_timezone_at_call_time(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "BUSINESS_TIMEZONE", "Asia/Vladivostok")
        now = business_now()

        expected = datetime.now(ZoneInfo("Asia/Vladivostok")).replace(tzinfo=None)
        assert abs((now - expected).total_seconds()) < _TOLERANCE_SECONDS
