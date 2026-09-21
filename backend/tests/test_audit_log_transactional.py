"""GH #344 Task 2 — audit accumulator + @transactional insertion (spec §4.1, §4.4).

Integration tests against the real test DB:

* actor wiring — the shared ``resolve_authed`` core stages the request
  contextvar (strict guard + lenient resolver covered at once, §4.1);
* pre-commit insertion — the OWNING wrapper inserts staged rows into the
  same session before ``commit()``: one commit for action + journal;
* no author → no insertion (spec §4.1 rule);
* method error → action and journal roll back together (§4.4);
* nested decorated levels → ONE insertion per transaction (ownership
  token, §4.4) — the inner wrapper inserts nothing;
* self-less scenario-style wrappers open the accumulator empty and, when
  outermost, own the insertion.
"""

import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from src.events import audit
from src.services.decorators import transactional

pytestmark = pytest.mark.integration

# ─── Test doubles: decorated writers that stage audit rows explicitly ─────────


class _Writer:
    """Decorated service whose method writes a tag row AND stages a journal row."""

    entity_name = "tags"  # resolvable by the wrapper's auto-mark machinery

    @transactional
    async def write_and_mark(
        self,
        db_session,
        tag_id: str,
        title: str,
        *,
        fail: bool = False,
        changes: dict | None = None,
    ) -> None:
        await db_session.execute(
            text(
                "INSERT INTO tags (id, title, created_at, updated_at) "
                "VALUES (:id, :title, datetime('now'), datetime('now'))"
            ),
            {"id": tag_id, "title": title},
        )
        audit.mark_audit(
            entity="tags",
            action="create",
            entity_id=tag_id,
            entity_label=f"Тег {title}",
            changes=changes,
        )
        if fail:
            raise RuntimeError("boom — method error must roll back action + journal")


class _InnerService:
    entity_name = "tags"

    @transactional
    async def inner_mark(self, db_session) -> None:
        # Inner decorated level: NOT the accumulator owner — must only stage.
        audit.mark_audit(
            entity="tags",
            action="update",
            entity_id="inner-1",
            entity_label="Inner",
            changes=None,
        )


class _OuterService:
    entity_name = "records"

    @transactional
    async def outer_marks(self, db_session) -> None:
        audit.mark_audit(
            entity="records",
            action="create",
            entity_id="outer-1",
            entity_label="Outer",
            changes=None,
        )
        await _InnerService().inner_mark(db_session)
        audit.mark_audit(
            entity="records",
            action="update",
            entity_id="outer-1",
            entity_label="Outer 2",
            changes=None,
        )


@transactional
async def _scenario_write(db_session) -> str:
    """Self-less scenario-style wrapper: opens the accumulator EMPTY, owns it."""
    tag_id = "tag-scenario-1"
    await db_session.execute(
        text(
            "INSERT INTO tags (id, title, created_at, updated_at) "
            "VALUES (:id, :title, datetime('now'), datetime('now'))"
        ),
        {"id": tag_id, "title": "scenario-tag"},
    )
    audit.mark_audit(
        entity="tags",
        action="create",
        entity_id=tag_id,
        entity_label="Сценарный тег",
        changes=None,
    )
    return tag_id


# ─── Helpers ──────────────────────────────────────────────────────────────────


@pytest.fixture
def audit_rows():
    """Factory: read all audit_logs rows (fresh sync connection per call)."""
    from tests.conftest import query_db

    def read() -> list[dict]:
        return query_db(
            "SELECT user_id, user_role, action, entity, entity_id, "
            "entity_label, changes FROM audit_logs ORDER BY rowid"
        )

    return read


@pytest.fixture
def real_user():
    """A real users row (FK target for audit_logs.user_id)."""
    from tests.conftest import insert_user

    return insert_user("+79990009999", "x", role="admin")


@pytest.fixture
def actor(real_user):
    """Open the actor contextvar around a test."""
    token = audit.set_actor(user_id=real_user["id"], role="admin")
    yield real_user
    audit.reset_actor(token)


# ─── Actor wiring via resolve_authed (spec §4.1 — shared core) ────────────────


class TestResolveAuthedActor:
    async def test_valid_session_stages_actor(self, api_client) -> None:
        from src.auth.permissions import SESSION_COOKIE, resolve_authed

        token = api_client.cookies.get(SESSION_COOKIE)
        assert token, "api_client must hold a memo_session cookie"
        authed = await resolve_authed(token)
        assert authed is not None

        staged = audit.current_actor()
        assert staged == audit.AuditActor(user_id=authed.id, role="admin")

    async def test_unknown_token_stages_no_actor(self) -> None:
        from src.auth.permissions import resolve_authed

        assert await resolve_authed("no-such-token") is None
        assert audit.current_actor() is None

    async def test_none_token_stages_no_actor(self) -> None:
        from src.auth.permissions import resolve_authed

        assert await resolve_authed(None) is None
        assert audit.current_actor() is None


# ─── @transactional insertion (spec §4.4) ─────────────────────────────────────


class TestTransactionalInsert:
    async def test_owner_inserts_pre_commit_with_serialized_changes(
        self, db_session, actor, audit_rows
    ) -> None:
        changes = {
            "price": [Decimal("3500.00"), Decimal("4000.00")],
            "start": [datetime(2026, 9, 20, 12, 0, tzinfo=UTC)],
            "title": ["a", "b"],
        }
        await _Writer().write_and_mark(
            db_session, "tag-audit-1", "audit-one", changes=changes
        )

        rows = audit_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row["user_id"] == actor["id"]
        assert row["user_role"] == "admin"
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "create", "tags", "tag-audit-1",
        )
        assert row["entity_label"] == "Тег audit-one"
        stored = json.loads(row["changes"])
        assert stored["price"] == ["3500.00", "4000.00"]  # Decimal → str
        assert stored["start"] == ["2026-09-20T12:00:00+00:00"]  # date → ISO
        assert stored["title"] == ["a", "b"]
        # The action itself is committed by the same wrapper.
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = 'tag-audit-1'")
        )
        assert kept.scalar_one() == "audit-one"

    async def test_no_actor_no_insert(self, db_session, audit_rows) -> None:
        assert audit.current_actor() is None  # no session principal staged
        await _Writer().write_and_mark(db_session, "tag-noactor-1", "no-author")

        assert audit_rows() == []  # no author → no journal row (§4.1)
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = 'tag-noactor-1'")
        )
        assert kept.scalar_one() == "no-author"  # the action itself stands

    async def test_method_error_rolls_back_action_and_journal_together(
        self, db_session, actor, audit_rows
    ) -> None:
        with pytest.raises(RuntimeError, match="boom"):
            await _Writer().write_and_mark(
                db_session, "tag-fail-1", "doomed", fail=True
            )
        await db_session.rollback()  # what get_db_session does on error

        assert audit_rows() == []  # journal rolled back with the action
        gone = await db_session.execute(
            text("SELECT COUNT(*) FROM tags WHERE id = 'tag-fail-1'")
        )
        assert gone.scalar_one() == 0
        assert audit.pending_rows() is None  # accumulator discarded in finally

    async def test_nested_decorated_levels_single_insert(
        self, db_session, actor, audit_rows, monkeypatch
    ) -> None:
        from src.services import decorators

        calls: list[int] = []
        original = decorators._insert_audit_rows

        def spy(session):
            pending = audit.pending_rows() or []
            calls.append(len(pending))
            original(session)

        monkeypatch.setattr(decorators, "_insert_audit_rows", spy)

        await _OuterService().outer_marks(db_session)

        assert calls == [3]  # ONE insertion for the whole transaction
        rows = audit_rows()
        assert {(r["entity"], r["entity_id"]) for r in rows} == {
            ("tags", "inner-1"),
            ("records", "outer-1"),
            ("records", "outer-1"),  # create + update — two marks, same id
        }

    async def test_selfless_scenario_owns_insertion(
        self, db_session, actor, audit_rows
    ) -> None:
        # Module-level scenario convention: explicit leading None (unused
        # self slot) + keyword args (see src/usecases/records.py docstring).
        tag_id = await _scenario_write(None, db_session=db_session)

        rows = audit_rows()
        assert len(rows) == 1
        assert rows[0]["entity_id"] == tag_id
        assert rows[0]["user_id"] == actor["id"]
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = :id"), {"id": tag_id}
        )
        assert kept.scalar_one() == "scenario-tag"
