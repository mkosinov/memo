"""Declarative registry of domain-event types (#580 spec §3.2).

The registry is a DECLARATIVE dictionary right here — rev.2: NO
import-side-effect self-registrations. Behavior must not depend on the
import graph: consumer tests see the same type set WITHOUT importing
any producer module (a producer registering its type as an import side
effect would make an unimported producer's type silently missing).
``register_type`` is the single declaration verb, called from THIS
module's declarative block; tests may register synthetic double types
through the same verb on an isolated copy of the registry.

Stream naming (spec §3.2/§4.1): one stream per type,
``domain_events:<code>`` — :func:`stream_key` is the single formatter.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EventType:
    """One registered event type: the machine ``code`` + a human
    ``description`` (logs/admin surfaces — never parsed)."""

    code: str
    description: str


# The registry itself. Module-private by design: the only writers are
# register_type declarations (this module's block below, plus isolated
# test copies — never producer imports).
_REGISTRY: dict[str, EventType] = {}


def register_type(code: str, description: str) -> None:
    """Declare one event type (spec §3.2).

    Called from this module's declarative block; tests may register
    synthetic double types on an isolated copy. Identical
    re-registration is an idempotent no-op; the same ``code`` with a
    DIFFERENT description is a declaration conflict — a loud
    ``ValueError`` (a silent overwrite would hide a typo).
    """
    existing = _REGISTRY.get(code)
    if existing is not None and existing.description != description:
        raise ValueError(
            f"domain event type {code!r} is already registered with a "
            f"different description: {existing.description!r} != {description!r}"
        )
    _REGISTRY[code] = EventType(code=code, description=description)


def registered_codes() -> frozenset[str]:
    """The declared type codes (registry completeness probes, §3.2)."""
    return frozenset(_REGISTRY)


def require_type(code: str) -> None:
    """Raise ``ValueError`` unless ``code`` is a registered event type.

    Called at the producer mark (``journal.mark_domain_event``, §3.2):
    an unknown type is a programming error — the price is an immediate
    in-transaction failure that rolls the domain change back WITH the
    event, not silence in the journal.
    """
    if code not in _REGISTRY:
        raise ValueError(f"unknown domain event type {code!r} — registered: {sorted(_REGISTRY)}")


def stream_key(code: str) -> str:
    """The Redis stream name of a type: ``domain_events:<code>`` (§3.2/§4.1)."""
    return f"domain_events:{code}"


# ── Declarative registry (rev.2 — THE type set of the system) ────────────────

# Pilot: the only event type today (#580 §3.2).
register_type("new_record", "Новая запись на мастер-класс")
