"""GH #344 — audit accumulator: request-scoped staging for journal rows (spec §4).

Mirrors the #239 name accumulator (``emitter.py``) mechanically: a
request-scoped contextvar opened/closed with an ownership token. The
``@transactional`` wrapper is the ONLY writer point — it opens the
accumulator before the method runs, and the wrapper that OPENED it (the
transaction's outer boundary) inserts the accumulated rows into the same
session after a successful method return, BEFORE ``commit()`` (spec §4.4):
one commit for action + journal; a method error rolls both back together.

Components:

* **Actor** — ``{user_id, role}`` request contextvar set by the shared
  ``resolve_authed`` core (spec §4.1): both the strict guard and the
  lenient optional resolver put it there; no extra DB hits. The author
  comes ONLY from the server session — never from request data. Rule:
  no actor → no journal insertion (seeds, CLI, session-less fixtures,
  anonymous record creation are not journaled, spec §12).

* **Accumulator** — the list of raw row dicts staged by
  :func:`mark_audit` (explicit marks per spec §4.3) and
  :func:`stage_auto` (repository auto-collection, spec §4.2 — Task 3).
  ``mark_audit``/``stage_auto`` outside an open accumulator is a no-op
  with a debug log (same contract as ``mark_changed``). The accumulator
  also carries the transaction's TARGET entity (the service entity the
  ``@transactional`` wrapper resolved): ``stage_auto`` writes only on
  an exact match — cascade children of corridor-2 scenarios never
  match and are silently dropped (spec §4.2 "one action — one row").
  Seniority (spec §4.2): an explicit ``mark_audit`` for the same row
  (entity + entity_id) DISPLACES the auto-collected record — in either
  order — so one operation never yields two journal rows for one row.

Serialization (spec §4.2/§5.1) happens at MARK time so the pending row
is always JSON-insertable: dates → ISO strings, decimals → strings,
enums → values. Masking: ``phone``/``phone_digits`` → ``mask_phone``
(last 4 digits), ``email`` → masked without the full string. Free-text
fields (notes/comments/descriptions) NEVER enter the snapshot. String
scalars in ``changes`` are clipped at 500 chars with an ``…`` suffix;
``entity_label`` is clipped at 255.

Signature dictionary (spec §5.1/§12): ``ENTITY_SIGNATURES`` maps every
canonical #239 entity to its journal signature — Russian header +
label fields + snapshot key fields. ``mark_audit`` derives
``entity_label`` from it when none is supplied explicitly (unnamed
entities get a типовая подпись: «Платёж 3500, card»); Task 3's
repository consumes :func:`entity_snapshot_fields` for ``create``
snapshots.

.. WARNING:: IMPORT-CYCLE HAZARD (precedent: ``entities.py``)
    ``mask_phone`` is imported LAZILY inside the masking helper: a
    top-level import would form the cycle ``permissions → audit →
    scope → permissions`` (``src.auth.permissions`` imports this module
    top-level to stage the actor). Consumers inside ``src/services/``
    (``decorators.py``) MUST import this module lazily — same rule as
    ``src.events.entities``.
"""

from __future__ import annotations

import contextvars
import logging
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any

logger = logging.getLogger("memo.audit")


# ─── Per-entity signature dictionary (spec §5.1, §12) ────────────────────────


@dataclass(frozen=True)
class EntitySignature:
    """One entity's journal signature (§5.1): header + carrying fields.

    * ``title`` — the Russian entity header («Клиент», «Платёж», …); used
      alone when no field values are available, and as the prefix for
      entities without a human name (payments: «Платёж 3500, card»).
    * ``titled_label`` — prefix the title when composing the label from
      values (§12: unnamed entities get a типовая подпись «Платёж …»);
      named entities (clients/staff/things with a title) render bare.
    * ``label_fields`` — up to 4 fields that form ``entity_label``
      (name-parts/title first; phone/email are masked when rendered).
      Empty for entities whose label is just the header (user_settings).
    * ``snapshot_fields`` — the key fields the repository snapshots for
      ``create``/``delete`` rows (Task 3 consumes this via
      :func:`entity_snapshot_fields`).
    """

    title: str
    label_fields: tuple[str, ...]
    snapshot_fields: tuple[str, ...]
    titled_label: bool = False


# Canonical #239 entity name → signature. Label fields match real model
# columns (see src/models/*); free-text fields never appear here (§5.1).
ENTITY_SIGNATURES: dict[str, EntitySignature] = {
    "clients": EntitySignature(
        title="Клиент",
        label_fields=("name", "phone"),
        snapshot_fields=("name", "phone", "email", "channel"),
    ),
    "visitors": EntitySignature(
        title="Посетитель",
        label_fields=("name", "age"),
        snapshot_fields=("client_id", "name", "age"),
    ),
    "services": EntitySignature(
        title="Услуга",
        label_fields=("title", "specialty"),
        snapshot_fields=("title", "specialty", "duration", "is_active"),
    ),
    "locations": EntitySignature(
        title="Локация",
        label_fields=("title",),
        snapshot_fields=("title", "short_title", "capacity", "is_active"),
    ),
    "materials": EntitySignature(
        title="Материал",
        label_fields=("title",),
        snapshot_fields=("title",),
    ),
    "tags": EntitySignature(
        title="Тег",
        label_fields=("title",),
        snapshot_fields=("title",),
    ),
    "positions": EntitySignature(
        title="Должность",
        label_fields=("title",),
        snapshot_fields=("title", "is_system"),
    ),
    "activities": EntitySignature(
        title="Занятие",
        label_fields=("start", "duration"),
        snapshot_fields=("master_id", "service_id", "start", "duration"),
        titled_label=True,
    ),
    "records": EntitySignature(
        title="Запись",
        label_fields=("status", "seats"),
        snapshot_fields=("activity_id", "client_id", "status", "seats"),
        titled_label=True,
    ),
    "visits": EntitySignature(
        title="Визит",
        label_fields=("status", "price"),
        snapshot_fields=("record_id", "visitor_id", "status", "price"),
        titled_label=True,
    ),
    "payments": EntitySignature(
        title="Платёж",
        label_fields=("amount", "method"),
        snapshot_fields=("record_id", "amount", "method"),
        titled_label=True,
    ),
    "photos": EntitySignature(
        title="Фото",
        label_fields=("filename",),
        snapshot_fields=("filename", "is_public"),
    ),
    "staff": EntitySignature(
        title="Сотрудник",
        label_fields=("last_name", "first_name"),
        snapshot_fields=("first_name", "last_name"),
    ),
    "users": EntitySignature(
        title="Пользователь",
        label_fields=("phone",),
        snapshot_fields=("phone", "role"),
        titled_label=True,
    ),
    "masters": EntitySignature(
        title="Мастер",
        label_fields=("specialty",),
        snapshot_fields=("staff_id", "specialty", "color"),
        titled_label=True,
    ),
    # NB: no `tariffs`/`user_profiles` entries — not canonical #239 entities
    # (tariffs are cascade children of services, profile writes are marked
    # as "staff"); a journal row never carries those entity names.
    "user_settings": EntitySignature(
        title="Настройки",
        label_fields=(),
        snapshot_fields=("user_id", "theme", "language"),
    ),
}


def entity_snapshot_fields(entity: str) -> tuple[str, ...]:
    """Key fields for a ``create``/``delete`` snapshot; empty for unknown."""
    return ENTITY_SIGNATURES.get(entity, EntitySignature("", (), ())).snapshot_fields

# Entities whose label fields are name parts joined by a space
# («Иванов Иван»), not a comma list.
_NAME_PARTS_ENTITIES: frozenset[str] = frozenset({"staff"})

# Free-text fields NEVER enter the snapshot (spec §5.1/Open Questions:
# notes and descriptions can contain anything — excluded wholesale).
FREE_TEXT_FIELDS: frozenset[str] = frozenset(
    {"comment", "note", "notes", "description", "record_info"}
)
# Contact fields masked before entering the snapshot (spec §5.1).
PHONE_FIELDS: frozenset[str] = frozenset({"phone", "phone_digits"})
EMAIL_FIELDS: frozenset[str] = frozenset({"email"})

# Column-width ceilings: entity_label String(255); string scalars in
# changes capped at 500 chars (clipped with an ellipsis suffix).
_LABEL_MAX = 255
_SCALAR_MAX = 500

# None = no actor in this context → journal insertion is skipped (§4.1).
_actor: contextvars.ContextVar[AuditActor | None] = contextvars.ContextVar(
    "audit_actor", default=None
)
# None = no open accumulator in this context → mark_audit is a no-op.
_pending: contextvars.ContextVar[list[dict[str, Any]] | None] = (
    contextvars.ContextVar("audit_pending", default=None)
)
# The transaction's TARGET entity (the service entity the owning
# ``@transactional`` wrapper resolved, spec §4.2): repository
# auto-collection stages rows only on an exact match. Written/cleared
# together with ``_pending`` by open_audit/reset_audit; ``None`` for a
# selfless scenario wrapper → auto-collection is off (cascade children
# of corridor-2 scenarios are never journaled).
_target: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "audit_target", default=None
)

# Row-dict key marking repository AUTO-collected rows (spec §4.2);
# stripped by ``draw_rows()`` before insertion — explicit rows never
# carry it, and the seniority rule keys on it.
_AUTO_FLAG = "_auto"


@dataclass(frozen=True)
class AuditActor:
    """The journaling author — snapshot of the session principal (§4.1)."""

    user_id: str
    role: str


# ─── Actor contextvar (set by the shared resolve_authed core, §4.1) ───────────


def set_actor(user_id: str, role: str) -> contextvars.Token[AuditActor | None]:
    """Stage the request-scoped audit actor (role snapshotted at action time)."""
    return _actor.set(AuditActor(user_id=user_id, role=role))


def reset_actor(token: contextvars.Token[AuditActor | None]) -> None:
    """Close the actor context (owner's ``finally``)."""
    _actor.reset(token)


def current_actor() -> AuditActor | None:
    """The staged actor; ``None`` when the request has no session principal."""
    return _actor.get()


# ─── Accumulator (token ownership, mirrors emitter.start/reset_accumulation) ──


def open_audit(
    target: str | None = None,
) -> tuple[contextvars.Token[list[dict[str, Any]] | None],
           contextvars.Token[str | None]] | None:
    """Open a fresh accumulator; ``None`` when one is already open.

    ``target`` is the transaction's TARGET entity (spec §4.2) — the
    canonical service entity the owning ``@transactional`` wrapper
    resolved. Repository auto-collection (:func:`stage_auto`) stages
    rows only when the mutated table's entity matches it; ``None``
    (selfless scenario wrapper) keeps auto-collection off entirely.

    The ``None`` return is the ownership signal for nested decorated
    wrappers (spec §4.4): only the wrapper whose ``open_audit()`` returned
    a token is the transaction's outer boundary — it alone inserts and
    resets the accumulator; inner wrappers see ``None`` and do nothing.
    """
    if _pending.get() is not None:
        return None  # sentinel: an accumulator is already open — not the owner
    pending_token = _pending.set([])
    target_token = _target.set(target)
    return pending_token, target_token


def reset_audit(
    token: tuple[contextvars.Token[list[dict[str, Any]] | None],
                 contextvars.Token[str | None]] | None,
) -> None:
    """Close the accumulator (owner wrapper ``finally``); ``None`` is a no-op."""
    if token is not None:
        _pending.reset(token[0])
        _target.reset(token[1])


def pending_rows() -> list[dict[str, Any]] | None:
    """The staged rows; ``None`` outside an open accumulator."""
    return _pending.get()


def draw_rows() -> list[dict[str, Any]] | None:
    """Take all staged rows (owner wrapper, pre-commit); clears the list.

    ``None`` when no accumulator is open; otherwise the (now emptied)
    list is returned for insertion into the owning session. The internal
    auto-collection marker (``_auto``) is stripped from every row — the
    inserting wrapper builds ``AuditLog(**row)`` and must not see it.
    """
    rows = _pending.get()
    if rows is None:
        return None
    drawn = [
        {key: value for key, value in row.items() if key != _AUTO_FLAG}
        for row in rows
    ]
    rows.clear()
    return drawn


def derive_entity_label(entity: str, fields: dict[str, Any] | None) -> str | None:
    """Derive ``entity_label`` from the signature dictionary + values (§5.1).

    ``fields`` is a mapping of column → value: repositories pass raw row
    values (``after`` preferred), ``mark_audit`` passes the ``changes``
    mapping (each ``[before, after]`` pair resolves to its after-value,
    falling back to before — a delete has no after). ``None`` when the
    entity has no signature or no label field carries a value; callers
    fall back to the bare entity name.

    Rendering: name-parts (``name``/``*_name``/``first_name``) join with
    a space, everything else with ``, ``; entities without a human name
    (payments, records, …) get the entity title as the prefix (§12:
    «Платёж 3500, card»). Phone/email fields are masked, other values go
    through the canonical encoder (dates → ISO, decimals → str).
    """
    sig = ENTITY_SIGNATURES.get(entity)
    if sig is None:
        return None
    parts: list[str] = []
    joiner = " " if entity in _NAME_PARTS_ENTITIES else ", "
    for field in sig.label_fields:
        value = _pair_value(fields.get(field) if fields else None)
        if value is None:
            continue
        if field in PHONE_FIELDS:
            rendered = _mask_phone_value(value)
        elif field in EMAIL_FIELDS:
            rendered = _mask_email_value(value)
        else:
            rendered = _canonical(value)
        if rendered is not None and str(rendered) != "":
            parts.append(str(rendered))
    if not parts:
        return sig.title or None
    if sig.titled_label:
        return f"{sig.title} {joiner.join(parts)}"
    return joiner.join(parts)


# [before, after] pair → the value to render (after wins; delete keeps before).
def _pair_value(value: Any) -> Any:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        after = value[1]
        return after if after is not None else value[0]
    return value


def mark_audit(
    *,
    entity: str,
    action: str,
    entity_id: str | None,
    entity_label: str | None = None,
    changes: dict[str, Any] | None,
) -> None:
    """Stage one journal row in the current transaction's accumulator.

    Explicit marks (spec §4.3 — scenarios and non-repository mutations)
    SUPERSEDE repository auto-collection for the same row: a matching
    staged auto row (same entity + entity_id) is removed first, and a
    later ``stage_auto`` for the same row is skipped (§4.2 seniority
    rule) — one operation never yields two rows for one target row.
    No-op with a debug log when no accumulator is open (outside
    ``@transactional``, or a task spawned before the transaction opened).

    The row is a plain dict keyed by ``AuditLog`` column names (the model
    import stays with the inserting wrapper — this module imports no
    models). ``changes`` is canonically serialized + masked NOW so the
    row is always JSON-insertable. ``entity_label`` defaults to the
    dictionary-derived label (§5.1); an explicit label wins (§4.3).
    """
    rows = _pending.get()
    if rows is None:
        logger.debug(
            "mark_audit(%s/%s) outside a transaction — ignored", entity, action
        )
        return
    _displace_auto(rows, entity, entity_id)
    actor = _actor.get()
    if entity_label is None:
        entity_label = derive_entity_label(entity, changes) or entity
    rows.append(
        {
            "user_id": actor.user_id if actor else None,
            "user_role": actor.role if actor else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "entity_label": (
                entity_label[:_LABEL_MAX] if entity_label else entity_label
            ),
            "changes": _serialize_changes(changes),
        }
    )


def stage_auto(
    *,
    entity: str,
    action: str,
    entity_id: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    entity_label: str | None = None,
) -> None:
    """Stage one AUTO-collected row from the repository (spec §4.2).

    The repository stages the RAW record — ``{entity, action, entity_id,
    before, after}`` with old values read off the row before mutation
    (``before=None`` for ``create``, ``after=None`` for ``delete``) — and
    this module owns every accumulator-side rule plus the finalization:

    * TARGET ENTITY — the row is staged only when ``entity`` matches the
      accumulator's target (the corridor-1 service entity); mismatched
      cascade children are dropped, and a target-less accumulator
      (selfless scenario) stages nothing.
    * SENIORITY — when an explicit ``mark_audit`` row already covers the
      same (entity, entity_id), this row is NOT staged (§4.2).
    * FINALIZATION — ``{field: [before, after]}`` pairs are composed
      from the raw dicts, the label is derived from the signature
      dictionary, and serialization/masking run through the same
      canonical pipeline as ``mark_audit`` (override ``entity_label``
      for reorder's «N объектов»).
    """
    rows = _pending.get()
    if rows is None:
        logger.debug(
            "stage_auto(%s/%s) outside a transaction — ignored", entity, action
        )
        return
    if entity != _target.get():
        return  # not the transaction's target entity — cascade child
    if _explicit_covers(rows, entity, entity_id):
        return  # an explicit mark supersedes auto-collection (§4.2)
    actor = _actor.get()
    changes = _compose_pairs(before, after)
    if entity_label is None:
        entity_label = derive_entity_label(entity, changes) or entity
    rows.append(
        {
            "user_id": actor.user_id if actor else None,
            "user_role": actor.role if actor else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "entity_label": (
                entity_label[:_LABEL_MAX] if entity_label else entity_label
            ),
            "changes": _serialize_changes(changes),
            _AUTO_FLAG: True,
        }
    )


def _compose_pairs(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Compose the ``{field: [before, after]}`` snapshot from raw dicts.

    ``create`` carries only ``after`` (pairs as ``[None, value]``),
    ``delete`` only ``before`` (``[value, None]``), ``update`` both
    (same keys — the repository's field diff); ``None``/``None`` (the
    reorder operation row) composes to ``None`` (no snapshot, §4.6).
    """
    if before is None and after is None:
        return None
    fields = after or before or {}  # narrowed: at least one is non-None
    return {
        field: [
            before.get(field) if before is not None else None,
            after.get(field) if after is not None else None,
        ]
        for field in fields
    }


def _explicit_covers(
    rows: list[dict[str, Any]], entity: str, entity_id: str | None
) -> bool:
    """An explicit (non-auto) staged row already journals this row?"""
    return any(
        row.get("entity") == entity
        and row.get("entity_id") == entity_id
        and _AUTO_FLAG not in row
        for row in rows
    )


def _displace_auto(
    rows: list[dict[str, Any]], entity: str, entity_id: str | None
) -> None:
    """Drop staged AUTO rows for this target — the explicit mark wins."""
    rows[:] = [
        row
        for row in rows
        if not (
            row.get("entity") == entity
            and row.get("entity_id") == entity_id
            and _AUTO_FLAG in row
        )
    ]


# ─── Canonical serializer + masking (spec §4.2, §5.1) ─────────────────────────


def _serialize_changes(changes: dict[str, Any] | None) -> dict[str, Any] | None:
    """Serialize + mask a raw ``{field: [before, after]}`` snapshot.

    Free-text fields are dropped wholesale; phone-like and email fields
    are masked on every value of the pair; everything else goes through
    the canonical scalar encoder (dates → ISO, decimals → str,
    enums → value, strings clipped at 500).
    """
    if changes is None:
        return None
    out: dict[str, Any] = {}
    for key, value in changes.items():
        if key in FREE_TEXT_FIELDS:
            continue  # never enters the snapshot
        if key in PHONE_FIELDS:
            out[key] = _map_pair(value, _mask_phone_value)
        elif key in EMAIL_FIELDS:
            out[key] = _map_pair(value, _mask_email_value)
        else:
            out[key] = _canonical(value)
    return out


def _map_pair(value: Any, fn: Any) -> Any:
    """Apply ``fn`` to every element of a [before, after] pair (or scalar)."""
    if isinstance(value, (list, tuple)):
        return [fn(v) for v in value]
    return fn(value)


def _canonical(value: Any) -> Any:
    """Canonical JSON-safe encoding for one snapshot value (§4.2).

    date/datetime/time → ISO string; Decimal → string; Enum → its value
    (recursively canonical); str → clipped at ``_SCALAR_MAX`` with ``…``;
    lists (e.g. ``tag_ids``) map recursively; everything else passes as-is.
    """
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return _canonical(value.value)
    if isinstance(value, str):
        if len(value) > _SCALAR_MAX:
            return value[: _SCALAR_MAX - 1] + "…"
        return value
    if isinstance(value, (list, tuple)):
        return [_canonical(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _canonical(v) for k, v in value.items()}
    return value


def _mask_phone_value(value: Any) -> Any:
    """``mask_phone`` on a phone-like value (last 4 digits visible, §5.1)."""
    if value is None:
        return None
    if not isinstance(value, str):
        return _canonical(value)
    # LAZY import — cycle hazard (see module WARNING): a top-level import
    # would form permissions → audit → scope → permissions.
    from src.auth.scope import mask_phone

    return mask_phone(value)


def _mask_email_value(value: Any) -> Any:
    """Mask an email without keeping the full string (§5.1).

    ``ivan@example.com`` → ``i***@e***.com``: first char of the local
    part and of the domain name survive, TLD intact — enough to recognize
    the contact, not enough to reconstruct it.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        return _canonical(value)
    local, sep, domain = value.partition("@")
    if not sep:
        return _canonical(value)
    local_masked = (local[0] + "***") if local else "***"
    domain_name, dot, tld = domain.rpartition(".")
    if not dot or not domain_name:
        domain_masked = (domain[:1] + "***") if domain else "***"
    else:
        domain_masked = domain_name[0] + "***" + "." + tld
    return f"{local_masked}@{domain_masked}"
