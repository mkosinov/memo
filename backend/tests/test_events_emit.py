"""GH #239 — post-commit emit integration tests (spec §3.3, §5, §2.4).

Exercises the REAL services against the real test DB (integration patterns:
``api_client`` + factories), subscribing to the module-level ``hub`` and
asserting the published ``(entities, origin)`` payloads:

* rollback silence — a failed mutation publishes NOTHING (spec §5);
* own entity — auto-mark of the service's ``entity_name`` (spec §3.3);
* cascades — the binding §3.3 table sets (visit hooks, activity delete,
  record delete, record create nested, resolve_delete executor, master
  archive/restore user cascade);
* origin — ``X-Memo-Tab-Id`` on mutating requests becomes the origin
  envelope; absent header → ``None`` (spec §2.4/§4.2).

Every test drains the hub queue afterwards so cross-test bleed is impossible.
"""

import uuid
from pathlib import Path

import pytest

from src.events.hub import hub

pytestmark = pytest.mark.integration

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def subscriber():
    """Subscribe to the hub for the duration of ONE test; drain on exit."""
    q = hub.subscribe()
    try:
        yield q
    finally:
        # Drain anything the test left behind, then unsubscribe — keeps
        # stray events from bleeding into later tests.
        hub.unsubscribe(q)


def _drain(q) -> list[tuple[set[str], object]]:
    """Collect everything currently sitting in the queue."""
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


# ─── rollback silence (spec §5: nothing published on rollback) ────────────────


class TestRollbackSilence:
    def test_failed_mutation_publishes_nothing(self, api_client, create_activity, subscriber) -> None:
        """A 4xx mutation (capacity overflow → rollback) publishes NOTHING."""
        # capacity=1 activity, first record fills it, second overflows → 409
        activity = create_activity(capacity=1)
        client_phone = f"+7999{uuid.uuid4().hex[:7]}"
        first = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": client_phone,
            "visits": [{"name": "A", "price": 1000, "status": "waiting"}],
        })
        assert first.status_code == 201
        drained_setup = _drain(subscriber)  # discard setup noise
        assert drained_setup, "setup mutations must have published"

        overflow = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "visits": [{"name": "B", "price": 1000, "status": "waiting"}],
        })
        assert overflow.status_code == 409
        assert _drain(subscriber) == [], "rollback must not publish"


# ─── own entity auto-mark (spec §3.3) ────────────────────────────────────────


class TestOwnEntityEmit:
    def test_create_tag_publishes_tags(self, api_client, subscriber) -> None:
        """POST /tags → subscriber receives exactly ``({"tags"}, None)``."""
        resp = api_client.post("/api/v1/tags", json={"tag": f"t-{uuid.uuid4().hex[:8]}"})
        assert resp.status_code == 201

        events = _drain(subscriber)
        assert events == [({"tags"}, None)]


# ─── cascades (spec §3.3 binding table) ───────────────────────────────────────


class TestVisitCascade:
    def test_visit_create_marks_records(self, api_client, create_record, subscriber) -> None:
        """Creating a visit recalcs the parent record → {visits, records}."""
        record = create_record()
        _drain(subscriber)  # discard setup noise

        resp = api_client.post("/api/v1/visits", json={
            "record_id": record["id"],
            "price": 1500,
            "status": "waiting",
        })
        assert resp.status_code == 201, resp.text

        events = _drain(subscriber)
        assert events == [({"visits", "records"}, None)]


class TestActivityDeleteCascade:
    def test_delete_activity_with_records_full_set(
        self, api_client, create_record, subscriber
    ) -> None:
        """Deleting an activity with records publishes the full §3.3 set."""
        record = create_record()
        _drain(subscriber)

        resp = api_client.delete(f"/api/v1/activities/{record['activity_id']}")
        assert resp.status_code == 204, resp.text

        events = _drain(subscriber)
        assert events == [(
            {"activities", "records", "visits", "payments", "photos", "tags"},
            None,
        )]


class TestRecordDeleteCascade:
    def test_delete_record_marks_visits_and_payments(
        self, api_client, create_record, subscriber
    ) -> None:
        """RecordService.delete raw-SQL path → {records, visits, payments}."""
        record = create_record()
        _drain(subscriber)

        # Execute mode: the unified DELETE route requires the resolutions
        # body when dependencies exist (visits here); RecordService.delete
        # is the executor and marks {visits, payments} (§3.3).
        resp = api_client.request(
            "DELETE", f"/api/v1/records/{record['id']}",
            json={"resolutions": {"visits": "cascade", "payments": "cascade"}},
        )
        assert resp.status_code == 204, resp.text

        events = _drain(subscriber)
        assert events == [({"records", "visits", "payments"}, None)]


class TestRecordCreateNested:
    def test_phone_flow_marks_created_clients_and_visitors(
        self, api_client, create_activity, subscriber
    ) -> None:
        """Phone flow creates client+visitor → conditional marks fire."""
        activity = create_activity()
        _drain(subscriber)

        resp = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "visits": [{"name": "Новый", "price": 2000, "status": "waiting"}],
        })
        assert resp.status_code == 201, resp.text

        events = _drain(subscriber)
        assert events == [({"records", "visits", "clients", "visitors"}, None)]


class TestResolveDeleteExecutor:
    def test_client_resolve_delete_marks_dispatched_deps(
        self, api_client, create_client, create_record, subscriber
    ) -> None:
        """Client resolve_delete (visitors cascade) marks every dispatched dep."""
        # Give the client a visitor with a visit
        client = create_client()
        visitor = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Виктор", "age": 30,
        })
        assert visitor.status_code == 201
        record = create_record(client_id=client["id"])
        resp = api_client.put(f"/api/v1/visitors/{visitor.json()['id']}", json={
            "client_id": client["id"], "name": "Виктор", "age": 30,
        })
        assert resp.status_code == 200
        # Link visit → visitor via PATCH
        visit_id = record["visits"][0]["id"]
        link = api_client.patch(f"/api/v1/visits/{visit_id}", json={"visitor_id": visitor.json()["id"]})
        assert link.status_code == 200, link.text
        _drain(subscriber)

        resp = api_client.request(
            "DELETE", f"/api/v1/clients/{client['id']}",
            json={"resolutions": {"records": "nullify", "visitors": "cascade"}},
        )
        assert resp.status_code == 204, resp.text

        events = _drain(subscriber)
        # Dispatched Client deps per FK_MATRIX: records (nullify), visitors
        # (cascade), client_tags (cascade), photos (nullify). The executor
        # marks dep.entity for EVERY dispatched handler regardless of count
        # (extra invalidations are cheap/correct, spec §2.7). Join-table
        # names ("client_tags") are published as-is — unknown names are
        # skipped silently by consumers (spec §5).
        assert events == [({"clients", "records", "visitors", "client_tags", "photos"}, None)]


class TestStaffArchiveCascade:
    def test_archive_staff_marks_users_and_masters(
        self, api_client, create_master, subscriber
    ) -> None:
        """StaffService.archive (D6 default checkboxes) also flips the
        masters extension + linked users → marks both entities."""
        master = create_master()  # card + master section (both active)
        import uuid as _uuid

        from tests.conftest import query_db

        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{_uuid.uuid4()}', '+79990009999', 'x', 'master', "
            f"'{master['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )
        _drain(subscriber)

        resp = api_client.post(f"/api/v1/staff/{master['id']}/archive", json={})
        assert resp.status_code == 200, resp.text

        events = _drain(subscriber)
        assert events == [({"staff", "masters", "users"}, None)]


# ─── origin propagation (spec §2.4/§4.2) ─────────────────────────────────────


class TestOriginPropagation:
    def test_tab_header_becomes_origin(self, api_client, subscriber) -> None:
        """Mutating request with X-Memo-Tab-Id → origin envelope {"tab", id}."""
        resp = api_client.post(
            "/api/v1/tags",
            json={"tag": f"t-{uuid.uuid4().hex[:8]}"},
            headers={"X-Memo-Tab-Id": "tab-123"},
        )
        assert resp.status_code == 201

        events = _drain(subscriber)
        assert events == [({"tags"}, {"type": "tab", "id": "tab-123"})]

    def test_no_header_means_null_origin(self, api_client, subscriber) -> None:
        """Same POST without the header → origin is None (external writer)."""
        resp = api_client.post("/api/v1/tags", json={"tag": f"t-{uuid.uuid4().hex[:8]}"})
        assert resp.status_code == 201

        events = _drain(subscriber)
        assert events == [({"tags"}, None)]


# ─── static source audit (cascade-drift CI guard) ─────────────────────────────


class TestCascadeSourceAudit:
    """Asserts the expected ``mark_changed("…")`` literals exist per source
    file, so deleting a mark fails CI even if the behavioural path above is
    skipped (spec §3.3 cascade-audit test)."""

    @staticmethod
    def _source(module_rel: str) -> str:
        return (BACKEND_DIR / module_rel).read_text(encoding="utf-8")

    def test_visit_marks_records(self) -> None:
        src = self._source("src/services/visit.py")
        assert 'mark_changed("records")' in src

    def test_activity_delete_marks_full_set(self) -> None:
        src = self._source("src/services/activity.py")
        for entity in ("records", "visits", "payments", "photos", "tags"):
            assert f'mark_changed("{entity}")' in src, f"activity.py lost mark_changed({entity!r})"

    def test_record_delete_marks_visits_payments(self) -> None:
        src = self._source("src/services/record.py")
        for entity in ("visits", "payments"):
            assert f'mark_changed("{entity}")' in src, f"record.py lost mark_changed({entity!r})"

    def test_record_create_nested_conditional_marks(self) -> None:
        src = self._source("src/services/record.py")
        for entity in ("visits", "clients", "visitors"):
            assert f'mark_changed("{entity}")' in src, f"record.py lost mark_changed({entity!r})"

    def test_deletion_executor_marks_dispatched_deps(self) -> None:
        """The generic resolve_delete executor marks dep.entity for every
        dispatched handler (one place — generic.py dispatch loops)."""
        src = self._source("src/services/generic.py")
        assert "mark_changed(dep.entity)" in src

    def test_staff_archive_marks_users(self) -> None:
        src = self._source("src/services/staff.py")
        assert 'mark_changed("users")' in src

    def test_emitter_accumulator_semantics(self) -> None:
        """Contextvar accumulator: token set/reset; mark outside = no-op
        (spec §3.3 documented contract)."""
        from src.events import emitter

        async def scenario() -> None:
            # Outside a transaction mark_changed is a silent no-op
            emitter.mark_changed("records")  # must not raise
            outside = emitter.accumulated() is None

            token = emitter.start_accumulation({"records"})
            emitter.mark_changed("visits")
            inside = emitter.accumulated() == {"records", "visits"}

            emitter.reset_accumulation(token)
            after_reset = emitter.accumulated() is None
            assert (outside, inside, after_reset) == (True, True, True)

        import asyncio

        asyncio.run(scenario())

    def test_decorator_carries_marker(self) -> None:
        """@transactional sets __memo_transactional__ for introspection."""
        from src.services.generic import GenericService

        assert getattr(GenericService.create, "__memo_transactional__", False) is True
        assert getattr(GenericService.list, "__memo_transactional__", False) is False
