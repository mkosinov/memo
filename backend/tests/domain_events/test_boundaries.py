"""Import-direction guards for the domain-events seam (#580 Task 8).

The canonical seam list is ONE (spec 2026-11-08-domain-events-service-580
-design.md §8, rev.2 panel decision — «двойная бухгалтерия границ» risk:
no second, divergent boundary definition). These tests pin it:

- ``src/domain_events`` NEVER imports ``src.notification`` — the service module
  is standalone; notification is its first consumer, not a dependency;
- ``src/streams`` (the shared transport core, §3.6) imports NEITHER notification
  NOR domain_events — it sits below both;
- notification — the subscriber — imports from domain_events ONLY the subscriber
  seam: ``subscribe``, ``types`` (the registry) and ``models`` (the row
  shape is the scenario-handler payload contract — the dispatcher feeds
  handlers a transient ``DomainEvent`` stand-in built from the record);
- the producer (``src/usecases``, ``src/services``) imports ONLY the
  producer seam: ``journal`` (the mark), ``types`` (the registry) and
  ``models`` (the ``@transactional`` flush constructs rows) — never
  ``subscribe``/``relay``;
- ``src/models`` registers ``domain_events.models`` like any other model
  (registration import only);
- NOBODY else in ``src`` imports domain_events at all: the relay is a
  standalone process (``python -m src.domain_events.relay``), not an
  import target.

Collection is AST-based over every ``import``/``from`` statement in the
tree — module level, function level (lazy imports) and ``TYPE_CHECKING``
blocks alike: a boundary violation does not become benign by being
annotation-only. Relative imports are resolved to absolute paths.
Docstrings/comments naming modules are not import statements and never
trigger (``src/streams`` docstrings legitimately mention both packages).
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[2] / "src"

NOTIFY = "src.notification"
DOMAIN_EVENTS = "src.domain_events"

# ── the canonical seam (spec §8): domain_events submodules per consumer ────
NOTIFY_ALLOWED = frozenset({"types", "subscribe", "models"})
PRODUCER_ALLOWED = frozenset({"types", "journal", "models"})
MODELS_REGISTRATION = frozenset({"models"})

PRODUCER_PACKAGES = ("usecases", "services")
# packages with their own allowlists; everything else under src/ is banned
SEAL_PACKAGES = ("notification", "models", *PRODUCER_PACKAGES)


def _src_files() -> list[Path]:
    return sorted(SRC_DIR.rglob("*.py"))


def _package_of(py: Path) -> list[str]:
    """Dotted package of the file (``src/notification/channels/x.py`` →
    ``['src', 'notification', 'channels']``; ``src/notification/__init__.py`` → the
    package the init belongs to)."""
    rel = py.relative_to(SRC_DIR).with_suffix("")
    parts = ["src", *rel.parts]
    parts.pop()  # module name — or `__init__`: either way, the containing package
    return parts


def _imported_targets(py: Path) -> list[tuple[str, int]]:
    """Absolute module paths of every import statement, with line numbers.

    For ``from X import a, b`` only ``X.a``/``X.b`` are recorded (each name
    is a submodule-or-attribute; the first path component under a guarded
    package is stable either way). Plain ``import X`` records ``X`` itself.
    """
    tree = ast.parse(py.read_text(encoding="utf-8"))
    package = _package_of(py)
    targets: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            targets += [(alias.name, node.lineno) for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            level = node.level or 0
            if level == 0:
                assert node.module is not None  # `from a import b` — always set
                prefix = node.module
            else:
                drop = level - 1
                if drop > len(package):
                    continue  # relative import above src/ — not ours
                prefix = ".".join(package[: len(package) - drop])
                if node.module:  # `from ..pkg.mod import X` keeps pkg.mod in path
                    prefix += f".{node.module}"
            targets += [(f"{prefix}.{alias.name}", node.lineno) for alias in node.names]
    return targets


def _seam_submodule(target: str, package: str) -> str | None:
    """First submodule of ``package`` the target touches.

    ``None`` — does not touch the package; ``""`` — the bare package
    itself (``import src.domain_events``), i.e. an unscoped import.
    """
    if target == package:
        return ""
    if target.startswith(package + "."):
        return target[len(package) + 1 :].split(".")[0]
    return None


def _violations(py: Path, package: str, allowed: frozenset[str] | None) -> list[str]:
    """Offending imports of ``package`` in ``py`` against ``allowed``.

    ``allowed=None`` — any touch of ``package`` is a violation.
    """
    rel = py.relative_to(SRC_DIR)
    found = []
    for target, lineno in _imported_targets(py):
        sub = _seam_submodule(target, package)
        if sub is None:
            continue
        if allowed is not None and sub in allowed:
            continue
        scope = f"only {sorted(allowed)}" if allowed is not None else "banned"
        found.append(f"{rel}:{lineno} imports {target} (allowed: {scope})")
    return found


class TestDomainEventsNeverImportsNotify:
    """Seam rule 1 — the service module is standalone (spec §8)."""

    def test_no_notify_imports_inside_domain_events(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] != "domain_events":
                continue
            offenders += _violations(py, NOTIFY, allowed=None)
        assert not offenders, (
            "src/domain_events must not import src.notification (spec §8 — the "
            "carve-out direction; notification is the consumer, not a "
            f"dependency): {offenders}"
        )


class TestStreamsImportsNeitherSide:
    """Seam rule 2 — the transport core sits below both (spec §3.6/§8)."""

    def test_no_notify_or_domain_events_imports_inside_streams(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] != "streams":
                continue
            offenders += _violations(py, NOTIFY, allowed=None)
            offenders += _violations(py, DOMAIN_EVENTS, allowed=None)
        assert not offenders, (
            "src/streams is the shared transport core — it must not import "
            "src.notification or src/domain_events (spec §3.6, domain rules "
            f"'src/streams'): {offenders}"
        )


class TestConsumerSeamAllowlists:
    """Seam rules 3-6 — one canonical allowlist per consumer (spec §8)."""

    def test_notify_imports_only_the_subscriber_seam(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] == "notification":
                offenders += _violations(py, DOMAIN_EVENTS, NOTIFY_ALLOWED)
        assert not offenders, (
            "notification (the subscriber) may import from src/domain_events "
            f"only {sorted(NOTIFY_ALLOWED)} — subscribe + the registry, plus "
            "the row shape as the handler payload (spec §8): "
            f"{offenders}"
        )

    def test_producer_imports_only_the_producer_seam(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] in PRODUCER_PACKAGES:
                offenders += _violations(py, DOMAIN_EVENTS, PRODUCER_ALLOWED)
        assert not offenders, (
            "the producer (src/usecases, src/services) may import from "
            f"src/domain_events only {sorted(PRODUCER_ALLOWED)} — the mark, "
            "the registry, the row (spec §8): "
            f"{offenders}"
        )

    def test_models_only_registers_the_row(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] == "models":
                offenders += _violations(py, DOMAIN_EVENTS, MODELS_REGISTRATION)
        assert not offenders, (
            "src/models touches src/domain_events for model registration "
            f"only ({sorted(MODELS_REGISTRATION)}): {offenders}"
        )

    def test_no_domain_events_imports_elsewhere(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            rel = py.relative_to(SRC_DIR)
            if rel.parts[0] in {"domain_events", "streams", *SEAL_PACKAGES}:
                continue
            offenders += _violations(py, DOMAIN_EVENTS, allowed=None)
        assert not offenders, (
            "only the sealed consumers (notification, the producer, the model "
            "registry) import src/domain_events; the relay is a standalone "
            "process, not an import target (spec §8): "
            f"{offenders}"
        )
