"""#485 Task 1 — per-channel delivery task model (ADR 014, spec §4).

The notify data model reshaped for «task = one channel»:

- ``NotifyTask``: ``channel``/``address``/``payload``/``template_id``/
  ``template_body`` frozen at creation; chain identity via
  ``root_task_id`` (first task: own id — ORM default) and
  ``parent_task_id`` (NULL on the first); ``delivery_outcome`` — the
  nullable chain result (``delivered | not_delivered``, written by the
  dispatcher chain, part 4 Task 5); ``resend_of`` — part 5 manual
  re-send reference (column + docstring only, the writer is not here
  yet). ``text``/``channels`` are GONE (ADR 014; the system is dark
  behind ``NOTIFY_ENABLED=false`` — no data compat).
- Spawn idempotency: ``UNIQUE(root_task_id, channel)`` (family §8.3).
- ``NotifyTemplate.channel`` — NULL = universal; uniqueness via the
  expression index ``(event_type, COALESCE(channel, ''))`` so the
  universal row participates (SQLite treats NULLs as distinct).
- ``NotifyTaskAttempt.sent_text`` — the actually transmitted text per
  attempt (spec §4.3).
- Template lookup rule (spec §3.7 rev.5): exact ``(event_type,
  channel)`` → ``(event_type, NULL)`` → ``is_default``.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.notify.models import DomainEvent, NotifyTask, NotifyTaskAttempt, NotifyTemplate
from src.notify.render import find_template

pytestmark = pytest.mark.integration


async def _event_id(db_session) -> str:
    """A real journal row — notify_tasks.event_id is a hard FK (tests run
    with FK enforcement on)."""
    event = DomainEvent(
        type="new_record",
        occurred_at=datetime.now(UTC).replace(tzinfo=None),
        snapshot={},
    )
    db_session.add(event)
    await db_session.flush()
    return event.id


def _template(
    *,
    event_type: str = "new_record",
    channel: str | None = None,
    body: str = "T {{ service.title }}",
    is_default: bool = False,
) -> NotifyTemplate:
    return NotifyTemplate(
        event_type=event_type,
        channel=channel,
        title=f"тест {uuid.uuid4().hex[:6]}",
        body=body,
        is_default=is_default,
    )


def _task(event_id: str, **overrides) -> NotifyTask:
    """A chain task with the mandatory-free defaults (all new columns
    are nullable — skipped tasks carry no channel payload)."""
    base = dict(
        event_id=event_id,
        scenario="new_record",
        status="queued",
        channel="telegram",
        address="+79990001122",
    )
    base.update(overrides)
    return NotifyTask(**base)


# ── NotifyTask: chain identity + spawn idempotency ──────────────────────────


class TestChainIdentity:
    async def test_first_task_defaults_root_task_id_to_own_id(self, db_session) -> None:
        """DoD: the first task of a chain gets ``root_task_id = id`` —
        an ORM-level default, so every construction site (scenario,
        dispatcher spawn) is safe without ceremony."""
        task = _task(await _event_id(db_session))
        db_session.add(task)
        await db_session.flush()

        assert task.id is not None
        assert task.root_task_id == task.id
        assert task.parent_task_id is None

    async def test_explicit_root_and_parent_preserved(self, db_session) -> None:
        """A chain CONTINUATION task (part 4 Task 5) sets root+parent
        explicitly — the ORM default must not overwrite them."""
        task = _task(
            await _event_id(db_session),
            root_task_id="root-1",
            parent_task_id="parent-1",
        )
        db_session.add(task)
        await db_session.flush()

        assert task.root_task_id == "root-1"
        assert task.parent_task_id == "parent-1"

    async def test_spawn_idempotency_unique_root_channel(
        self, db_session
    ) -> None:
        """DoD: a repeated (root_task_id, channel) insert violates
        ``UNIQUE(root_task_id, channel)`` — at-least-once report
        redelivery cannot duplicate a chain task (family §8.3)."""
        event_id = await _event_id(db_session)
        db_session.add(_task(event_id, root_task_id="root-1", channel="telegram"))
        await db_session.flush()

        db_session.add(_task(event_id, root_task_id="root-1", channel="telegram"))

        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_same_root_different_channels_allowed(self, db_session) -> None:
        """The chain itself: one root, several channel tasks."""
        event_id = await _event_id(db_session)
        db_session.add(_task(event_id, root_task_id="root-1", channel="telegram"))
        db_session.add(_task(event_id, root_task_id="root-1", channel="mock"))
        await db_session.flush()  # no IntegrityError

    async def test_skipped_task_lands_with_reason(self, db_session) -> None:
        """DoD skip-landing: ``skipped`` + ``skip_reason`` survive the
        reshape — no channel/address/payload on a skipped task."""
        task = _task(
            await _event_id(db_session),
            status="skipped",
            skip_reason="no_recipient",
            channel=None,
            address=None,
        )
        db_session.add(task)
        await db_session.flush()

        assert task.status == "skipped"
        assert task.skip_reason == "no_recipient"
        assert task.channel is None
        assert task.root_task_id == task.id

    async def test_resend_of_column_nullable_without_writer(self, db_session) -> None:
        """``resend_of`` ships as a column (part 5 contract) — nullable,
        no writer yet."""
        task = _task(await _event_id(db_session))
        db_session.add(task)
        await db_session.flush()

        assert task.resend_of is None

    async def test_text_and_channels_columns_are_gone(self, db_engine) -> None:
        """ADR 014: ``text``/``channels`` dropped from the model AND the
        schema (the session DB is migrated to head by the conftest)."""

        def _task_columns(conn) -> set[str]:
            from sqlalchemy import inspect

            inspector = inspect(conn)
            return {c["name"] for c in inspector.get_columns("notify_tasks")}

        async with db_engine.connect() as conn:
            columns = await conn.run_sync(_task_columns)
        assert "text" not in columns
        assert "channels" not in columns
        # the new per-channel shape is present
        assert {
            "channel",
            "address",
            "payload",
            "template_id",
            "template_body",
            "root_task_id",
            "parent_task_id",
            "delivery_outcome",
            "resend_of",
        } <= columns


# ── NotifyTemplate: channel dimension (spec §3.7 rev.5) ─────────────────────


class TestTemplateChannelDimension:
    async def test_channel_specific_and_universal_coexist(self, db_session) -> None:
        db_session.add(_template(channel="telegram", body="TG"))
        db_session.add(_template(channel=None, body="UNIVERSAL"))
        await db_session.flush()  # both land — COALESCE treats them apart

    async def test_duplicate_event_type_and_channel_rejected(
        self, db_session
    ) -> None:
        db_session.add(_template(channel="telegram"))
        await db_session.flush()

        db_session.add(_template(channel="telegram", body="DUP"))

        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_duplicate_universal_rejected_via_coalesce_index(
        self, db_session
    ) -> None:
        """The point of the COALESCE expression index: two universal
        rows of one event type are duplicates even though channel IS
        NULL (a plain unique index would let both in)."""
        db_session.add(_template(channel=None))
        await db_session.flush()

        db_session.add(_template(channel=None, body="DUP"))

        with pytest.raises(IntegrityError):
            await db_session.flush()


# ── NotifyTaskAttempt: sent_text (spec §4.3) ─────────────────────────────────


class TestAttemptSentText:
    async def test_sent_text_stored_and_nullable(self, db_session) -> None:
        task = _task(await _event_id(db_session))
        db_session.add(task)
        await db_session.flush()

        with_text = NotifyTaskAttempt(
            task_id=task.id,
            channel="telegram",
            stage="sent",
            outcome="delivered",
            sent_text="Отправленный текст",
            occurred_at=datetime.now(UTC).replace(tzinfo=None),
        )
        without_text = NotifyTaskAttempt(
            task_id=task.id,
            channel="telegram",
            stage="failed",
            outcome="unavailable",
            sent_text=None,
            occurred_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db_session.add_all([with_text, without_text])
        await db_session.flush()

        assert with_text.sent_text == "Отправленный текст"
        assert without_text.sent_text is None


# ── Template lookup: (event_type, channel) → (event_type, NULL) → default ────


class TestFindTemplateLookup:
    """Tier rule (spec §3.7 rev.5). NB: the default row of an event type
    IS its universal (NULL-channel) row — at most one NULL-channel row
    per event type fits the COALESCE index, so the fixtures below never
    plant two (defaults are universal, spec §4.2)."""

    async def test_exact_channel_match_wins(self, db_session) -> None:
        db_session.add(_template(channel="telegram", body="TG"))
        db_session.add(_template(body="DEFAULT", is_default=True))
        await db_session.flush()

        found = await find_template(db_session, "new_record", "telegram")

        assert found is not None and found.body == "TG"

    async def test_universal_used_when_no_channel_row(self, db_session) -> None:
        db_session.add(_template(event_type="evt2", channel=None, body="UNIVERSAL"))
        await db_session.flush()

        found = await find_template(db_session, "evt2", "telegram")

        assert found is not None and found.body == "UNIVERSAL"

    async def test_default_used_when_no_typed_rows(self, db_session) -> None:
        """Defaults are channel-agnostic (spec §4.2: «дефолты только
        универсальные») — the default row itself has channel NULL."""
        db_session.add(_template(event_type="other", channel=None, body="OTHER"))
        db_session.add(_template(body="DEFAULT", is_default=True))
        await db_session.flush()

        found = await find_template(db_session, "new_record", "telegram")

        assert found is not None and found.body == "DEFAULT"

    async def test_channel_row_ignored_for_other_event_type(self, db_session) -> None:
        """Tier 2 must match the SAME event type with channel NULL — a
        channel row of a different event type is not a fallback."""
        db_session.add(_template(event_type="other", channel="telegram", body="OTHER"))
        db_session.add(_template(body="DEFAULT", is_default=True))
        await db_session.flush()

        found = await find_template(db_session, "new_record", "telegram")

        assert found is not None and found.body == "DEFAULT"

    async def test_no_template_at_all_returns_none(self, db_session) -> None:
        assert await find_template(db_session, "new_record", "telegram") is None
