"""#580 Task 2 — the declarative type registry (spec §3.2).

Completeness: the pilot ``new_record`` must be declared by
``src/domain_events/types.py`` ITSELF — a fresh interpreter that
imports NOTHING but the registry module sees the full declared set
(rev.2: no import-side-effect registrations; behavior does not depend
on the import graph — consumer tests see the same types without
importing any producer module).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from src.domain_events.types import (
    register_type,
    registered_codes,
    require_type,
    stream_key,
)


@pytest.fixture
def isolated_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run one test on an isolated COPY of the registry.

    Only mutating tests use this: ``monkeypatch`` swaps the module dict
    for a copy and restores the real declarative registry afterwards —
    a synthetic type registered here never leaks into other tests.
    """
    from src.domain_events import types

    monkeypatch.setattr(types, "_REGISTRY", dict(types._REGISTRY))


class TestRegistryCompleteness:
    """The pilot type is declared by ``types.py`` alone (rev.2)."""

    def test_fresh_interpreter_registry_is_exactly_the_pilot_set(self) -> None:
        """A fresh python that imports ONLY the registry module sees the
        complete declared set — no producer import needed, no import
        side effects anywhere in the graph."""
        probe = (
            "from src.domain_events.types import registered_codes, require_type\n"
            "codes = registered_codes()\n"
            "assert 'new_record' in codes, sorted(codes)\n"
            "require_type('new_record')  # registered → no raise\n"
            "print(sorted(codes))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[2],
        )
        assert result.returncode == 0, result.stderr
        # Completeness: exactly the declared pilot set, nothing more.
        assert result.stdout.strip() == "['new_record']"


class TestRequireType:
    def test_unknown_code_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="no_such_event_type_xyz"):
            require_type("no_such_event_type_xyz")

    def test_registered_code_does_not_raise(self) -> None:
        require_type("new_record")  # the pilot — must not raise


class TestStreamKey:
    def test_key_format_is_domain_events_prefix(self) -> None:
        assert stream_key("new_record") == "domain_events:new_record"


class TestRegisterType:
    """The single declaration verb (spec §3.2 API)."""

    def test_declares_a_new_code(self, isolated_registry: None) -> None:
        register_type("probe_type", "synthetic probe type")

        require_type("probe_type")  # now registered → no raise
        assert "probe_type" in registered_codes()

    def test_identical_reregistration_is_idempotent(
        self, isolated_registry: None
    ) -> None:
        register_type("probe_type", "synthetic probe type")
        register_type("probe_type", "synthetic probe type")  # no raise

        assert "probe_type" in registered_codes()

    def test_conflicting_description_raises(
        self, isolated_registry: None
    ) -> None:
        register_type("probe_type", "first description")

        with pytest.raises(ValueError, match="probe_type"):
            register_type("probe_type", "a DIFFERENT description")
