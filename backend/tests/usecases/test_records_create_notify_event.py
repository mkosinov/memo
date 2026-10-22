"""GH #482 Task 6 — scenario-side flag gate + ``new_record`` domain event.

``create_record`` (spec §3.1/§3.3):

* the ``notify`` flag is saved into ``records.notify`` ONLY when an
  audit actor is in context (§3.3.4) — no actor → forced false;
* after the seats/status recalculation the scenario marks the
  ``new_record`` domain event (§3.1): the ``@transactional`` wrapper
  inserts the journal row in the SAME commit — the row appears exactly
  when the record application commits;
* a scenario error after the mark rolls the entity and the event back
  together (§3.1 — one application = one commit = one event row).
"""

from __future__ import annotations

import json
from uuid import uuid4 as _uuid4

import pytest
from sqlalchemy import text

from src.models.activity import Activity
from src.notify import journal
from src.schemas.record import RecordCreate, VisitItem

pytestmark = pytest.mark.integration


async def _orm_activity(db_session, create_activity) -> Activity:
    """The API factory returns a dict; the scenario needs the ORM row."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


def _domain_event_rows() -> list[dict]:
    from tests.conftest import query_db

    return query_db(
        "SELECT type, snapshot FROM domain_events ORDER BY rowid"
    )


def _notify_column(record_id: str) -> int:
    from tests.conftest import query_db

    rows = query_db(f"SELECT notify FROM records WHERE id = '{record_id}'")
    assert len(rows) == 1
    return rows[0]["notify"]


class TestNotifyFlagActorGate:
    """§3.3.4 — the flag is respected only with an authenticated actor."""

    async def test_actor_in_context_saves_flag_true(
        self, db_session, create_activity
    ) -> None:
        from src.events import audit
        from src.usecases.records import create_record
        from tests.conftest import insert_user

        # A REAL users row — with an actor staged, the @transactional
        # wrapper journals the create into audit_logs whose user_id has
        # an FK to users.
        user = insert_user(f"+7999{_uuid4().hex[:7]}", "test", role="admin")
        activity = await _orm_activity(db_session, create_activity)
        token = audit.set_actor(user_id=user["id"], role="admin")
        try:
            record = await create_record(
                db_session=db_session,
                data=RecordCreate(
                    activity_id=activity.id,
                    phone="+79995551111",
                    notify=True,
                    visits=[VisitItem(name="Мария", price=1000)],
                ),
            )
        finally:
            audit.reset_actor(token)

        assert _notify_column(record.id) == 1

    async def test_no_actor_forces_flag_false(
        self, db_session, create_activity
    ) -> None:
        from src.events import audit
        from src.usecases.records import create_record

        assert audit.current_actor() is None  # scenario-level call — no actor
        activity = await _orm_activity(db_session, create_activity)
        record = await create_record(
            db_session=db_session,
            data=RecordCreate(
                activity_id=activity.id,
                phone="+79995551112",
                notify=True,  # hostile/anonymous true must not survive
                visits=[VisitItem(name="Аноним", price=1000)],
            ),
        )

        assert _notify_column(record.id) == 0


class TestNewRecordDomainEvent:
    """§3.1 — the scenario marks ``new_record`` inside the transaction."""

    async def test_commit_inserts_new_record_event(
        self, db_session, create_activity
    ) -> None:
        from src.usecases.records import create_record

        activity = await _orm_activity(db_session, create_activity)
        record = await create_record(
            db_session=db_session,
            data=RecordCreate(
                activity_id=activity.id,
                phone="+79995551113",
                visits=[VisitItem(name="Мария", price=1000)],
            ),
        )

        rows = _domain_event_rows()
        assert len(rows) == 1
        assert rows[0]["type"] == "new_record"
        snapshot = json.loads(rows[0]["snapshot"])
        # §4.1 contract: the event envelope carries the record id the
        # dispatcher will re-read live.
        assert snapshot["event"]["type"] == "new_record"
        assert snapshot["event"]["record_id"] == record.id

    async def test_scenario_rollback_discards_event_with_record(
        self, db_session, create_activity, monkeypatch
    ) -> None:
        from src.usecases.records import create_record

        activity = await _orm_activity(db_session, create_activity)
        activity_id = activity.id  # rollback expires ORM objects — keep the id

        # Fail AFTER the event was staged: the real mark runs (the row is
        # in the accumulator), then the scenario blows up — the wrapper
        # must skip the commit, so neither record nor event lands.
        real_mark = journal.mark_domain_event

        def stage_then_boom(event_type, snapshot):
            real_mark(event_type, snapshot)
            raise RuntimeError("boom — post-mark failure rolls back all")

        monkeypatch.setattr(journal, "mark_domain_event", stage_then_boom)

        with pytest.raises(RuntimeError, match="boom"):
            await create_record(
                db_session=db_session,
                data=RecordCreate(
                    activity_id=activity_id,
                    phone="+79995551114",
                    visits=[VisitItem(name="Гость", price=1000)],
                ),
            )
        await db_session.rollback()  # what the caller does on error

        assert _domain_event_rows() == []
        left = await db_session.execute(
            text("SELECT COUNT(*) FROM records WHERE activity_id = :aid"),
            {"aid": activity_id},
        )
        assert left.scalar_one() == 0
