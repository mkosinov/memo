"""GH #482 Task 8 (spec §3.4; family #476 §4.2/§4.4): ``new_record`` scenario.

The scenario registry maps event type codes to handlers; the pilot entry
is ``new_record``. The handler receives the event (snapshot), a session
and the queue port, does its own commit boundaries (task + ``processed_at``
in ONE transaction; enqueue AFTER commit) and materializes its decision
as a ``notify_tasks`` row.

Covered (spec §5, US-2/US-3):

- deleted record → ``processed_at`` WITHOUT a task (nothing to send);
- four skip reasons, one per predicate branch, FIXED order
  ``notify_off → no_recipient → no_consent → past_event`` (first branch
  wins on multi-fail);
- success → task ``queued`` of the FIRST priority channel with the
  FROZEN render payload + channel template + address (rev.5, ADR 014),
  payload §4.2 in FakeQueue, ``processed_at`` set;
- idempotency (§4.4): reprocessing an event creates no duplicate task;
- RenderError PROPAGATES (not caught into a skip) — the 3-attempts
  policy of Task 9 owns it.
"""

import importlib.util
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.models.record import Record
from src.notify.models import DomainEvent, NotifyTask, NotifyTemplate
from src.notify.queue import FakeQueue
from src.notify.render import RenderError
from src.notify.scenarios import SCENARIOS, handle_new_record
from src.notify.snapshots import build_new_record_snapshot
from tests.conftest import query_db_params

pytestmark = pytest.mark.integration

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_MIGRATION_FILE = (
    _BACKEND_DIR / "alembic" / "versions" / "c970adc6b3d6_notify_subsystem_tables.py"
)

# The actual §3.5 seed body — the success-path text assertions run against
# the REAL default template, not a test-local substitute.
def _load_default_body() -> str:
    spec = importlib.util.spec_from_file_location("notify_seed_migration", _MIGRATION_FILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._DEFAULT_TEMPLATE_BODY


_UTC_ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


async def _seed_default_template(db_session) -> None:
    db_session.add(
        NotifyTemplate(
            event_type="new_record",
            title="seed default",
            body=_load_default_body(),
            is_default=True,
        )
    )
    await db_session.commit()


async def _tasks(db_session) -> list[NotifyTask]:
    return list((await db_session.execute(select(NotifyTask))).scalars().all())


async def _fetch_event(db_session, event_id: str) -> DomainEvent:
    # plain re-select (no expire_all — it would expire OTHER identity-map
    # objects, e.g. the task row, whose later attribute access would then
    # hit lazy IO outside greenlet)
    event = (
        await db_session.execute(select(DomainEvent).where(DomainEvent.id == event_id))
    ).scalar_one()
    assert event is not None
    return event


# Relative time bounds (repo precedent — conftest.py activity factory).
# The 1-day margin dwarfs the Europe/Moscow shift of business_now()
# (§3.2), so past/future predicates hold on any run date — no expiry.
_PAST = datetime.now(UTC) - timedelta(days=1)
_FUTURE = datetime.now(UTC) + timedelta(days=1)


async def _stage_event(
    db_session,
    create_activity,
    create_record,
    *,
    start: datetime,
    notify: bool = True,
    client: dict | None = None,
    visits: list[dict] | None = None,
) -> tuple[DomainEvent, dict]:
    """Create the full chain via API and journal a ``new_record`` event.

    ``start`` is the SNAPSHOT's activity start: the activity row is
    flipped to it via SQL AFTER the record is created (booking rules see
    a valid future activity; the predicate reads the snapshot, spec §3.4).
    """
    payload_visits = visits if visits is not None else [
        {"name": "Гость", "price": 3500, "status": "waiting"},
    ]
    # booking rules see a valid future activity; the snapshot start is
    # shaped by the SQL flip below
    activity = create_activity(start=_FUTURE)
    record_overrides: dict = {"notify": notify}
    if client is not None:
        record_overrides["client_id"] = client["id"]
    record = create_record(
        activity_id=activity["id"], visits=payload_visits, **record_overrides
    )

    # shape the snapshot's activity.start without fighting booking rules
    query_db_params(
        "UPDATE activities SET start = :s WHERE id = :aid",
        {"s": start.strftime("%Y-%m-%d %H:%M:%S"), "aid": record["activity_id"]},
    )

    db_session.expire_all()
    rec = await db_session.get(Record, record["id"])
    assert rec is not None
    snapshot = await build_new_record_snapshot(db_session, rec)
    event = DomainEvent(
        type="new_record",
        occurred_at=datetime.now(UTC).replace(tzinfo=None),
        snapshot=snapshot,
    )
    db_session.add(event)
    await db_session.commit()
    return event, record


class TestRegistry:
    def test_pilot_entry_is_new_record_handler(self) -> None:
        assert {"new_record": handle_new_record} == SCENARIOS


class TestDeletedRecord:
    async def test_deleted_record_closes_event_without_task(
        self, db_session, create_activity, create_record
    ) -> None:
        event, record = await _stage_event(
            db_session, create_activity, create_record, start=_FUTURE
        )
        # the record is gone by processing time (hard delete: records
        # have no soft-delete flag)
        query_db_params("DELETE FROM visits WHERE record_id = :rid", {"rid": record["id"]})
        query_db_params("DELETE FROM records WHERE id = :rid", {"rid": record["id"]})

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        assert await _tasks(db_session) == []  # nothing to send — NO task row
        closed = await _fetch_event(db_session, event.id)
        assert closed.processed_at is not None
        assert queue.tasks == []


class TestSkipReasons:
    """One test per predicate branch (US-2); skip → task row + processed_at
    in one transaction, nothing enqueued."""

    async def test_notify_off(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, notify=False, client=client,
        )

        queue = FakeQueue()
        # through the registry — the Task 9 dispatcher calls handlers
        # generically by type code
        await SCENARIOS["new_record"](event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        task = tasks[0]
        assert task.status == "skipped"
        assert task.skip_reason == "notify_off"
        assert task.scenario == "new_record"
        assert task.event_id == event.id
        assert task.client_id == client["id"]
        # a skipped task carries no channel payload (rev.5)
        assert task.channel is None and task.address is None
        assert task.payload is None and task.template_body is None
        assert (await _fetch_event(db_session, event.id)).processed_at is not None
        assert queue.tasks == []

    @pytest.mark.parametrize(
        "break_recipient",
        ["soft_deleted", "phone_none", "phone_whitespace", "row_deleted"],
    )
    async def test_no_recipient(
        self, db_session, create_activity, create_record, create_client, break_recipient
    ) -> None:
        client = create_client(phone="+79990001122")
        event, record = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, client=client,
        )

        cid = client["id"]
        if break_recipient == "soft_deleted":
            query_db_params("UPDATE clients SET is_active = 0 WHERE id = :c", {"c": cid})
        elif break_recipient == "phone_none":
            query_db_params("UPDATE clients SET phone = NULL WHERE id = :c", {"c": cid})
        elif break_recipient == "phone_whitespace":
            query_db_params("UPDATE clients SET phone = '   ' WHERE id = :c", {"c": cid})
        else:  # row_deleted — the live read by snapshot client.id finds nothing
            query_db_params(
                "UPDATE records SET client_id = NULL WHERE id = :r", {"r": record["id"]}
            )
            query_db_params("DELETE FROM visits WHERE record_id = :r", {"r": record["id"]})
            query_db_params("DELETE FROM visitors WHERE client_id = :c", {"c": cid})
            query_db_params("DELETE FROM clients WHERE id = :c", {"c": cid})

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        task = tasks[0]
        assert task.status == "skipped"
        assert task.skip_reason == "no_recipient"
        # FK integrity: client_id never dangles on a deleted client row
        if break_recipient == "row_deleted":
            assert task.client_id is None
        else:
            assert task.client_id == cid
        assert (await _fetch_event(db_session, event.id)).processed_at is not None
        assert queue.tasks == []

    async def test_no_consent(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, client=client,
        )
        query_db_params(
            "UPDATE clients SET notify_enabled = 0 WHERE id = :c", {"c": client["id"]}
        )

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert tasks[0].status == "skipped"
        assert tasks[0].skip_reason == "no_consent"
        assert (await _fetch_event(db_session, event.id)).processed_at is not None
        assert queue.tasks == []

    async def test_past_event(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_PAST, client=client,
        )

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert tasks[0].status == "skipped"
        assert tasks[0].skip_reason == "past_event"
        assert (await _fetch_event(db_session, event.id)).processed_at is not None
        assert queue.tasks == []


class TestFixedReasonOrder:
    """Multiple failures at once — the FIRST branch of the fixed order
    wins (notify_off → no_recipient → no_consent → past_event)."""

    async def test_all_four_fail_first_branch_wins(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_PAST, notify=False, client=client,
        )
        query_db_params("UPDATE clients SET is_active = 0 WHERE id = :c", {"c": client["id"]})
        query_db_params(
            "UPDATE clients SET notify_enabled = 0 WHERE id = :c", {"c": client["id"]}
        )

        await handle_new_record(event, db_session, FakeQueue())

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert tasks[0].skip_reason == "notify_off"

    async def test_recipient_beats_consent_and_past(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_PAST, client=client,
        )
        query_db_params(
            "UPDATE clients SET notify_enabled = 0, is_active = 0 WHERE id = :c",
            {"c": client["id"]},
        )

        await handle_new_record(event, db_session, FakeQueue())

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert tasks[0].skip_reason == "no_recipient"

    async def test_consent_beats_past(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_PAST, client=client,
        )
        query_db_params(
            "UPDATE clients SET notify_enabled = 0 WHERE id = :c", {"c": client["id"]}
        )

        await handle_new_record(event, db_session, FakeQueue())

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert tasks[0].skip_reason == "no_consent"


class TestSuccessPath:
    """US-3: future + flag + consent + phone → queued task, rendered text,
    frozen channels, §4.2 payload in the queue, processed_at set."""

    async def test_success_creates_queued_task_and_enqueues(
        self,
        db_session,
        api_client,
        create_master,
        create_service,
        create_location,
        create_client,
        create_activity,
        create_record,
    ) -> None:
        await _seed_default_template(db_session)

        master = create_master(first_name="Мария", last_name="Иванова")
        service = create_service(title="Гончарный мастер-класс")
        location = create_location(
            title="Студия «Горы»",
            address="ул. Ленина, 1",
            yandex_map_url="https://map.yandex.example/hory",
        )
        activity = create_activity(
            master_id=master["id"],
            service_id=service["id"],
            location_id=location["id"],
            start=_FUTURE,
        )
        client = create_client(name="Анна", phone="+79990001122")
        record = create_record(
            activity_id=activity["id"],
            client_id=client["id"],
            notify=True,
            visits=[
                {"name": "Анна", "price": 3500, "status": "waiting"},
                {"name": "Гость", "price": 2500, "status": "waiting"},
            ],
        )
        # attach tariffs to the visits (snapshots-test precedent)
        for visit, title, price in (
            (record["visits"][0], "Взрослый", 3500),
            (record["visits"][1], "Детский", 2500),
        ):
            tariff_id = f"tariff-{uuid.uuid4().hex[:8]}"
            query_db_params(
                "INSERT INTO tariffs (id, service_id, title, price, is_active, "
                "created_at, updated_at) VALUES (:id, :sid, :title, :price, 1, "
                "datetime('now'), datetime('now'))",
                {"id": tariff_id, "sid": service["id"], "title": title, "price": price},
            )
            query_db_params(
                "UPDATE visits SET tariff_id = :t WHERE id = :v",
                {"t": tariff_id, "v": visit["id"]},
            )

        db_session.expire_all()
        rec = await db_session.get(Record, record["id"])
        snapshot = await build_new_record_snapshot(db_session, rec)
        event = DomainEvent(
            type="new_record", occurred_at=datetime.now(UTC).replace(tzinfo=None), snapshot=snapshot
        )
        db_session.add(event)
        await db_session.commit()

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        task = tasks[0]
        assert task.status == "queued"
        assert task.skip_reason is None
        assert task.scenario == "new_record"
        assert task.event_id == event.id
        assert task.client_id == client["id"]
        assert task.reenqueues == 0

        # rev.5 (ADR 014): the task of the FIRST priority channel with
        # the FROZEN render payload, template and address — the worker
        # assembles the text; nothing is rendered here
        assert task.channel == "telegram"
        assert task.address == "+79990001122"
        assert task.root_task_id == task.id
        assert task.parent_task_id is None
        assert task.payload is not None
        # payload = the §4.1 snapshot verbatim (all top-level keys)
        for key in (
            "event", "client", "activity", "service",
            "tariffs", "total_price", "location", "master",
        ):
            assert key in task.payload, f"payload lost the {key!r} snapshot key"
        assert task.payload["service"]["title"] == "Гончарный мастер-класс"
        assert task.template_body == _load_default_body()
        assert task.template_id is not None
        # the frozen template's ORIGIN (#485 Task 4, spec §6.2): the
        # default template is UNIVERSAL (channel NULL) — the origin
        # rides the row/payload to the worker's parse-mode decision
        assert task.template_channel is None

        assert (await _fetch_event(db_session, event.id)).processed_at is not None

        # payload §4.2 rev.5 in FakeQueue — exact shape, frozen values
        assert len(queue.tasks) == 1
        payload = queue.tasks[0]
        assert set(payload) == {
            "task_id",
            "channel",
            "address",
            "payload",
            "template_id",
            "template_body",
            "template_channel",
            "root_task_id",
            "created_at",
            "resend_of",
        }
        assert payload["task_id"] == task.id
        assert payload["channel"] == task.channel
        assert payload["address"] == task.address
        assert payload["payload"] == task.payload
        assert payload["template_body"] == task.template_body
        assert payload["template_channel"] == task.template_channel
        assert payload["root_task_id"] == task.id
        assert payload["resend_of"] is None
        assert _UTC_ISO_Z.match(payload["created_at"]), payload["created_at"]

    async def test_channel_template_freezes_its_origin(
        self,
        db_session,
        create_master,
        create_service,
        create_location,
        create_client,
        create_activity,
        create_record,
    ) -> None:
        """#485 Task 4 (spec §3.7/§6.2): a CHANNEL template wins the
        lookup over the universal one, and its origin (``"telegram"``)
        is frozen into the task — the worker sends it with the channel's
        parse mode (HTML), not as plain text."""
        from src.notify.models import NotifyTemplate

        # both tiers seeded: a telegram-channel template AND the default
        # universal row — the lookup must pick the channel tier.
        db_session.add(
            NotifyTemplate(
                event_type="new_record",
                channel="telegram",
                title="Канальный шаблон",
                body="Канальный текст: {{ client.name }}",
                is_default=False,
            )
        )
        await _seed_default_template(db_session)

        master = create_master(first_name="Мария", last_name="Иванова")
        service = create_service(title="Гончарный мастер-класс")
        location = create_location(title="Студия «Горы»", address="ул. Ленина, 1")
        activity = create_activity(
            master_id=master["id"],
            service_id=service["id"],
            location_id=location["id"],
            start=_FUTURE,
        )
        client = create_client(name="Анна", phone="+79990001122")
        record = create_record(
            activity_id=activity["id"],
            client_id=client["id"],
            notify=True,
            visits=[{"name": "Анна", "price": 3500, "status": "waiting"}],
        )
        db_session.expire_all()
        rec = await db_session.get(Record, record["id"])
        snapshot = await build_new_record_snapshot(db_session, rec)
        event = DomainEvent(
            type="new_record", occurred_at=datetime.now(UTC).replace(tzinfo=None), snapshot=snapshot
        )
        db_session.add(event)
        await db_session.commit()

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        task = tasks[0]
        assert task.template_body == "Канальный текст: {{ client.name }}"
        assert task.template_channel == "telegram"
        payload = queue.tasks[0]
        assert payload["template_channel"] == "telegram"


class TestIdempotency:
    """§4.4: (event, scenario) is unique — reprocessing creates no dup."""

    async def test_success_reprocess_creates_no_duplicate(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        await _seed_default_template(db_session)
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, client=client,
        )

        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)
        # re-fetch as the dispatcher would and process again
        stale = await _fetch_event(db_session, event.id)
        await handle_new_record(stale, db_session, queue)

        tasks = await _tasks(db_session)
        assert len(tasks) == 1
        assert queue.tasks and len(queue.tasks) == 1

    async def test_skip_reprocess_creates_no_duplicate(
        self, db_session, create_activity, create_record
    ) -> None:
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, notify=False,
        )
        queue = FakeQueue()
        await handle_new_record(event, db_session, queue)
        stale = await _fetch_event(db_session, event.id)
        await handle_new_record(stale, db_session, queue)

        assert len(await _tasks(db_session)) == 1
        assert queue.tasks == []


class TestRenderErrorPropagates:
    """A render failure is NOT a skip branch — it propagates for the
    Task 9 attempts policy; no task, no processed_at."""

    async def test_render_error_propagates(
        self, db_session, create_activity, create_record, create_client
    ) -> None:
        # deliberately NO template seeded → render_event raises RenderError
        client = create_client(phone="+79990001122")
        event, _ = await _stage_event(
            db_session, create_activity, create_record,
            start=_FUTURE, client=client,
        )

        queue = FakeQueue()
        with pytest.raises(RenderError):
            await handle_new_record(event, db_session, queue)

        assert await _tasks(db_session) == []
        assert (await _fetch_event(db_session, event.id)).processed_at is None
        assert queue.tasks == []
