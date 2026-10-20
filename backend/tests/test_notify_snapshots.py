"""#482 Task 5 (spec §3.2, family #476 §4.1): the ``new_record`` snapshot.

The snapshot builder runs BEFORE the scenario's commit (local reads in
the same transaction) and is the single owner of the §4.1 JSON shape:
every top-level key ALWAYS present, values may be null. Covered:

- full snapshot: every field populated (client, tariffs with titles,
  map url, master name «Фамилия Имя»);
- minimal snapshot: no client, no tariff, no map — null tolerance;
- ``record_total_price`` — Python parity with the SQL list total
  (``_total_price_sq``) on identical data, custom_price excluded.
"""

import json
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from src.models.record import Record
from src.models.visit import Visit
from src.notify.snapshots import build_new_record_snapshot
from src.services.record import _total_price_sq, record_total_price
from tests.conftest import query_db_params

# Family #476 §4.1 — the exact top-level key set (always ALL present).
SNAPSHOT_KEYS = {
    "event",
    "client",
    "activity",
    "service",
    "tariffs",
    "total_price",
    "location",
    "master",
}

# naive UTC serialized as ISO 8601 WITH the ``Z`` suffix (spec §3.2)
_UTC_ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


def _insert_tariff(service_id: str, title: str, price: int) -> str:
    """Insert a tariff row directly (no tariff write API) — FK-safe."""
    tariff_id = f"tariff-{uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT INTO tariffs (id, service_id, title, price, is_active, "
        "created_at, updated_at) VALUES (:id, :sid, :title, :price, 1, "
        "datetime('now'), datetime('now'))",
        {"id": tariff_id, "sid": service_id, "title": title, "price": price},
    )
    return tariff_id


def _post_activity(
    api_client,
    master: dict,
    service: dict,
    location: dict,
    start: datetime,
) -> dict:
    resp = api_client.post(
        "/api/v1/activities",
        json={
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
        },
    )
    assert resp.status_code == 201, f"activity create failed: {resp.text}"
    return resp.json()


async def _load_record(db_session, record_id: str) -> Record:
    db_session.expire_all()
    record = await db_session.get(Record, record_id)
    assert record is not None
    return record


class TestFullSnapshot:
    """All §4.1 fields populated on a fully-linked record."""

    async def test_full_snapshot_all_fields_populated(
        self,
        api_client,
        db_session,
        create_master,
        create_service,
        create_location,
        create_client,
    ) -> None:
        master = create_master(first_name="Ольга", last_name="Петрова")
        service = create_service(title="Картина маслом")
        location = create_location(
            title="Студия Альпика",
            address="ул. Тестовая, 1",
            yandex_map_url="https://map.yandex.example/alpha",
        )
        # naive local business time — carried into the snapshot AS IS
        start = datetime(2026, 11, 1, 18, 0)
        activity = _post_activity(api_client, master, service, location, start)

        client = create_client(name="Анна", phone="+79990001122")
        t_adult = _insert_tariff(service["id"], "Взрослый", 3500)
        t_kid = _insert_tariff(service["id"], "Детский", 2500)

        resp = api_client.post(
            "/api/v1/records",
            json={
                "activity_id": activity["id"],
                "client_id": client["id"],
                "visits": [
                    {"name": "Гость А", "price": 3500},
                    {"name": "Гость Б", "price": 2500},
                ],
            },
        )
        assert resp.status_code == 201, f"record create failed: {resp.text}"
        body = resp.json()
        # attach tariffs post-hoc (wiring of payload tariff_id is not this task)
        query_db_params(
            "UPDATE visits SET tariff_id = :tid WHERE id = :vid",
            {"tid": t_adult, "vid": body["visits"][0]["id"]},
        )
        query_db_params(
            "UPDATE visits SET tariff_id = :tid WHERE id = :vid",
            {"tid": t_kid, "vid": body["visits"][1]["id"]},
        )

        record = await _load_record(db_session, body["id"])
        snapshot = await build_new_record_snapshot(db_session, record)

        # exact §4.1 top-level key set — always ALL keys
        assert set(snapshot) == SNAPSHOT_KEYS

        # event block
        event = snapshot["event"]
        assert event["type"] == "new_record"
        assert event["record_id"] == body["id"]
        assert _UTC_ISO_Z.match(event["occurred_at"]), event["occurred_at"]
        parsed = datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00"))
        assert parsed.tzinfo is not None
        assert abs((parsed - datetime.now(UTC)).total_seconds()) < 300

        # client block
        assert snapshot["client"] == {
            "id": client["id"],
            "name": "Анна",
            "phone": "+79990001122",
        }

        # activity: stored naive start AS IS (no conversion, no Z)
        assert snapshot["activity"] == {"start": "2026-11-01T18:00:00", "duration": 90}

        assert snapshot["service"] == {"title": "Картина маслом"}

        # tariffs: one element per visit — tariff title + VISIT price
        assert sorted(snapshot["tariffs"], key=lambda t: t["price"]) == [
            {"title": "Детский", "price": 2500},
            {"title": "Взрослый", "price": 3500},
        ]

        assert snapshot["total_price"] == 6000

        assert snapshot["location"] == {
            "title": "Студия Альпика",
            "address": "ул. Тестовая, 1",
            "map_url": "https://map.yandex.example/alpha",
        }

        # master name — «Фамилия Имя» (display composite parity)
        assert snapshot["master"] == {"name": "Петрова Ольга"}

        # JSON-able (the snapshot lands in a JSON column)
        json.dumps(snapshot)


class TestMinimalSnapshot:
    """Null tolerance: no client, no tariff, no map url."""

    async def test_minimal_snapshot_null_tolerant(
        self,
        api_client,
        db_session,
        create_master,
        create_service,
        create_location,
    ) -> None:
        master = create_master()
        service = create_service()
        location = create_location(address=None, yandex_map_url=None)
        activity = _post_activity(
            api_client,
            master,
            service,
            location,
            datetime(2026, 11, 1, 12, 0),
        )

        # Client-less record: legal at the model level (client_id nullable)
        # but unreachable via POST /records — the name-based visit flow
        # find-or-creates a Visitor, and visitors.client_id is NOT NULL.
        # Direct SQL constructs the state (create_audit_log precedent).
        record_id = str(uuid.uuid4())
        query_db_params(
            "INSERT INTO records (id, activity_id, client_id, status, seats, "
            "notify, created_at, updated_at) VALUES (:id, :aid, NULL, "
            "'pending', 1, 0, datetime('now'), datetime('now'))",
            {"id": record_id, "aid": activity["id"]},
        )
        query_db_params(
            "INSERT INTO visits (id, record_id, visitor_id, tariff_id, price, "
            "custom_price, status, created_at, updated_at) VALUES (:id, :rid, "
            "NULL, NULL, 1500, NULL, 'waiting', datetime('now'), datetime('now'))",
            {"id": str(uuid.uuid4()), "rid": record_id},
        )

        record = await _load_record(db_session, record_id)
        snapshot = await build_new_record_snapshot(db_session, record)

        assert set(snapshot) == SNAPSHOT_KEYS
        assert snapshot["client"] is None
        # deleted/unattached tariff → title null, price = the visit's price
        assert snapshot["tariffs"] == [{"title": None, "price": 1500}]
        assert snapshot["total_price"] == 1500
        assert snapshot["location"]["map_url"] is None
        assert snapshot["location"]["address"] is None
        assert snapshot["location"]["title"] == location["title"]
        assert snapshot["activity"]["duration"] == 90
        assert snapshot["service"]["title"] == service["title"]
        assert snapshot["master"]["name"] == f"{master['last_name']} {master['first_name']}"
        assert snapshot["event"]["record_id"] == record_id
        json.dumps(snapshot)


class TestRecordTotalPrice:
    """DoD: Python helper == SQL ``_total_price_sq`` on identical data."""

    async def test_equals_sql_total_price_sq(
        self,
        api_client,
        db_session,
        create_record,
    ) -> None:
        record = create_record(
            visits=[
                {"name": "А", "price": 3500, "status": "waiting"},
                {"name": "Б", "price": 2500, "status": "waiting"},
                {"name": "В", "price": 0, "status": "waiting"},
            ]
        )

        db_session.expire_all()
        visits = (
            (await db_session.execute(select(Visit).where(Visit.record_id == record["id"])))
            .scalars()
            .all()
        )
        assert len(visits) == 3

        py_total = record_total_price(visits)
        sql_total = (
            await db_session.execute(
                select(_total_price_sq().label("total")).where(Record.id == record["id"])
            )
        ).scalar_one()

        assert py_total == sql_total == 6000

    async def test_custom_price_excluded_from_total(
        self,
        api_client,
        db_session,
        create_record,
    ) -> None:
        """``custom_price`` never enters the total (parity with lists)."""
        record = create_record(
            visits=[
                {"name": "А", "price": 1000, "status": "waiting"},
            ]
        )
        visit_id = record["visits"][0]["id"]
        query_db_params(
            "UPDATE visits SET custom_price = 999 WHERE id = :vid",
            {"vid": visit_id},
        )

        db_session.expire_all()
        visits = (
            (await db_session.execute(select(Visit).where(Visit.record_id == record["id"])))
            .scalars()
            .all()
        )
        sql_total = (
            await db_session.execute(
                select(_total_price_sq().label("total")).where(Record.id == record["id"])
            )
        ).scalar_one()

        assert record_total_price(visits) == sql_total == 1000

    def test_empty_visits_zero(self) -> None:
        """COALESCE(SUM(...), 0) parity: no visits → 0, not None."""
        assert record_total_price([]) == 0
