"""GH #482 Task 4 — domain-event journal accumulator + @transactional splice.

Integration tests against the real test DB, mirroring the audit
accumulator's transactional suite (``test_audit_log_transactional.py``):

* pre-commit insertion — the OWNING wrapper inserts staged event rows
  into the same session before ``commit()``: one record application =
  one commit = one event row (spec §3.1);
* no actor required — unlike audit, domain events are DATA, not an
  action log: the insertion is unconditional (seeds, CLI included);
* method error → entity and event roll back together;
* nested decorated levels → ONE insertion per transaction (ownership
  token, single-owner rule);
* self-less scenario wrappers own the insertion when outermost;
* marks outside an open accumulator are a no-op (same contract as
  ``mark_audit`` / ``mark_changed``).
"""

import json
from datetime import datetime

import pytest
from sqlalchemy import text

from src.notify import journal
from src.services.decorators import transactional

pytestmark = pytest.mark.integration

# ─── Test doubles: decorated writers that mark domain events ──────────────────


class _Writer:
    """Decorated service whose method writes a tag row AND marks an event."""

    entity_name = "tags"  # resolvable by the wrapper's auto-mark machinery

    @transactional
    async def write_and_mark(
        self,
        db_session,
        tag_id: str,
        title: str,
        *,
        fail: bool = False,
        snapshot: dict | None = None,
    ) -> None:
        await db_session.execute(
            text(
                "INSERT INTO tags (id, title, created_at, updated_at) "
                "VALUES (:id, :title, datetime('now'), datetime('now'))"
            ),
            {"id": tag_id, "title": title},
        )
        journal.mark_domain_event(
            "new_record",
            snapshot if snapshot is not None else {"record_id": tag_id},
        )
        if fail:
            raise RuntimeError("boom — method error must roll back entity + event")


class _InnerService:
    entity_name = "tags"

    @transactional
    async def inner_mark(self, db_session) -> None:
        # Inner decorated level: NOT the accumulator owner — must only stage.
        journal.mark_domain_event("inner_event", {"inner": True})


class _OuterService:
    entity_name = "records"

    @transactional
    async def outer_marks(self, db_session) -> None:
        journal.mark_domain_event("new_record", {"outer": 1})
        await _InnerService().inner_mark(db_session)
        journal.mark_domain_event("new_record", {"outer": 2})


@transactional
async def _scenario_write(db_session) -> str:
    """Self-less scenario-style wrapper: opens the accumulator EMPTY, owns it."""
    tag_id = "tag-scenario-j1"
    await db_session.execute(
        text(
            "INSERT INTO tags (id, title, created_at, updated_at) "
            "VALUES (:id, :title, datetime('now'), datetime('now'))"
        ),
        {"id": tag_id, "title": "scenario-tag"},
    )
    journal.mark_domain_event("new_record", {"record_id": tag_id})
    return tag_id


# ─── Helpers ──────────────────────────────────────────────────────────────────


@pytest.fixture
def event_rows():
    """Factory: read all domain_events rows (fresh sync connection per call)."""
    from tests.conftest import query_db

    def read() -> list[dict]:
        return query_db(
            "SELECT type, occurred_at, snapshot, processed_at, attempts "
            "FROM domain_events ORDER BY rowid"
        )

    return read


# ─── Accumulator unit semantics (token ownership, mirror of audit) ────────────


class TestJournalTokenSemantics:
    def test_open_twice_second_call_gets_none(self) -> None:
        token = journal.open_journal()
        assert token is not None
        try:
            assert journal.open_journal() is None  # not the owner
        finally:
            journal.reset_journal(token)
        assert journal.pending_events() is None  # closed again

    def test_draw_drains_and_reset_closes(self) -> None:
        token = journal.open_journal()
        assert token is not None
        try:
            journal.mark_domain_event("new_record", {"a": 1})
            journal.mark_domain_event("inner_event", {"b": 2})
            drawn = journal.draw_events()
            assert drawn is not None
            assert [row["type"] for row in drawn] == [
                "new_record",
                "inner_event",
            ]
            assert journal.draw_events() == []  # drained — second draw is empty
        finally:
            journal.reset_journal(token)
        assert journal.pending_events() is None

    def test_reset_with_none_token_is_noop(self) -> None:
        journal.reset_journal(None)  # inner wrapper — must not raise

    def test_mark_outside_accumulator_is_noop(self, event_rows) -> None:
        assert journal.pending_events() is None  # no accumulator open
        journal.mark_domain_event("new_record", {"record_id": "orphan"})

        assert event_rows() == []  # nothing staged, nothing inserted
        assert journal.pending_events() is None


# ─── @transactional insertion (spec §3.1) ─────────────────────────────────────


class TestTransactionalInsert:
    async def test_owner_inserts_event_with_entity_in_one_commit(
        self, db_session, event_rows
    ) -> None:
        before = datetime.utcnow()
        await _Writer().write_and_mark(
            db_session,
            "tag-journal-1",
            "journal-one",
            snapshot={"record_id": "tag-journal-1", "total_price": 3500},
        )
        after = datetime.utcnow()

        rows = event_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row["type"] == "new_record"
        assert row["processed_at"] is None  # pending — for the polling loop
        assert row["attempts"] == 0
        stored = json.loads(row["snapshot"])
        assert stored["record_id"] == "tag-journal-1"
        assert stored["total_price"] == 3500
        # occurred_at — naive UTC stamped at mark time (repository
        # timestamp convention, mirrors the datetime.utcnow defaults).
        occurred = datetime.fromisoformat(row["occurred_at"])
        assert occurred.tzinfo is None
        assert before <= occurred <= after
        # The entity itself is committed by the same wrapper.
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = 'tag-journal-1'")
        )
        assert kept.scalar_one() == "journal-one"

    async def test_no_actor_still_inserts(self, db_session, event_rows) -> None:
        from src.events import audit

        assert audit.current_actor() is None  # no session principal staged
        await _Writer().write_and_mark(db_session, "tag-noactor-j1", "no-author")

        assert len(event_rows()) == 1  # data, not an action log — always written
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = 'tag-noactor-j1'")
        )
        assert kept.scalar_one() == "no-author"  # the entity stands too

    async def test_method_error_rolls_back_entity_and_event_together(
        self, db_session, event_rows
    ) -> None:
        with pytest.raises(RuntimeError, match="boom"):
            await _Writer().write_and_mark(
                db_session, "tag-fail-j1", "doomed", fail=True
            )
        await db_session.rollback()  # what get_db_session does on error

        assert event_rows() == []  # event rolled back with the entity
        gone = await db_session.execute(
            text("SELECT COUNT(*) FROM tags WHERE id = 'tag-fail-j1'")
        )
        assert gone.scalar_one() == 0
        assert journal.pending_events() is None  # accumulator discarded in finally

    async def test_nested_decorated_levels_single_insert(
        self, db_session, event_rows, monkeypatch
    ) -> None:
        from src.services import decorators

        calls: list[int] = []
        original = decorators._insert_event_rows

        def spy(session):
            pending = journal.pending_events() or []
            calls.append(len(pending))
            original(session)

        monkeypatch.setattr(decorators, "_insert_event_rows", spy)

        await _OuterService().outer_marks(db_session)

        assert calls == [3]  # ONE insertion for the whole transaction
        rows = event_rows()
        assert [r["type"] for r in rows] == [
            "new_record",
            "inner_event",
            "new_record",  # two marks, same outer level — both staged
        ]

    async def test_selfless_scenario_owns_insertion(
        self, db_session, event_rows
    ) -> None:
        # Module-level scenario convention: plain keyword args
        # (see src/usecases/records.py docstring).
        tag_id = await _scenario_write(db_session=db_session)

        rows = event_rows()
        assert len(rows) == 1
        assert rows[0]["type"] == "new_record"
        assert json.loads(rows[0]["snapshot"]) == {"record_id": tag_id}
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = :id"), {"id": tag_id}
        )
        assert kept.scalar_one() == "scenario-tag"
