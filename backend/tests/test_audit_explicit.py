"""GH #344 Task 4 — explicit audit marks for non-standard mutations (spec §4.3/§4.5/§8).

Every §8 coverage path that auto-collection (Task 3) cannot reach gets a
representative here: the journal carries exactly ONE row per user action
with the correct action + label, no double rows (seniority), and no-ops
(re-archive of an archived row, restore of an active one, empty-body
PATCH) write nothing.

Covered families:

* archive/restore — ``ArchiveService`` generic + ``StaffService`` own
  implementations (§4.2: explicit ``archive``/``restore`` action, no
  field snapshot, displaces the auto ``update`` row; no-op not written);
* records scenarios (§4.3) — create/update/patch/delete rows; deferred
  delete journals the final DELETE (§4.5); cascade visits/payments never
  journal;
* standalone visits / photos / staff composite / profile / user
  settings — explicit marks where the service writes rows around the
  repository;
* ``resolve_delete`` (deferred-delete commit for clients/services/staff/
  tags) and ``ActivityService.delete`` — the deferred-delete commit path
  (§4.5);
* payments single CRUD — auto-collection representative (§8 row 1).

Service-level tests call real decorated services with a staged actor and
assert COMMITTED ``audit_logs`` rows (the Task 3 harness pattern).
"""

import json

import pytest

from src.events import audit

pytestmark = pytest.mark.integration


# ─── Harness (the Task 3 test_audit_autocollect.py pattern) ───────────────────


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

    return insert_user("+79990009997", "x", role="admin")


@pytest.fixture
def actor(real_user):
    """Open the actor contextvar around a test."""
    token = audit.set_actor(user_id=real_user["id"], role="admin")
    yield real_user
    audit.reset_actor(token)


def _insert_location(loc_id: str, title: str) -> None:
    """Seed a location row directly (no repository call → no auto row)."""
    from tests.conftest import query_db

    query_db(
        f"INSERT INTO locations (id, title, capacity, sort_order, is_active, "
        f"created_at, updated_at) VALUES ('{loc_id}', '{title}', 20, 0, 1, "
        f"datetime('now'), datetime('now'))"
    )


def _insert_staff_card(staff_id: str, first: str, last: str) -> None:
    """Seed an ACTIVE staff card + masters extension + linked user (D6 links)."""
    from tests.conftest import query_db

    query_db(
        f"INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        f"created_at, updated_at) VALUES ('{staff_id}', '{first}', '{last}', 0, "
        f"1, datetime('now'), datetime('now'))"
    )
    query_db(
        f"INSERT INTO masters (staff_id, specialty, color, is_active, "
        f"created_at, updated_at) VALUES ('{staff_id}', 'живопись', "
        f"'#5B8C7A', 1, datetime('now'), datetime('now'))"
    )
    query_db(
        f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
        f"email_is_confirmed, phone_is_confirmed, is_active, created_at, "
        f"updated_at) VALUES ('user-{staff_id}', '+79990006660', 'x', "
        f"'master', '{staff_id}', 0, 0, 1, datetime('now'), datetime('now'))"
    )


# ─── §4.2/§4.6: ArchiveService.archive/restore — generic archive family ───────


class TestArchiveServiceAudit:
    async def test_archive_writes_archive_row_not_update(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.location import get_location_service

        _insert_location("loc-arch", "Студия")
        ok = await get_location_service().archive(db_session, "loc-arch")
        assert ok is True
        rows = audit_rows()
        # Seniority (§4.2): the auto ``update`` row for the is_active flip
        # is DISPLACED — exactly ONE row, action ``archive``, no snapshot.
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "archive", "locations", "loc-arch",
        )
        assert row["entity_label"] == "Студия"
        assert json.loads(row["changes"]) is None
        assert row["user_id"] == actor["id"]
        assert row["user_role"] == "admin"

    async def test_restore_writes_restore_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.location import get_location_service

        _insert_location("loc-rest", "Студия")
        await get_location_service().archive(db_session, "loc-rest")
        ok = await get_location_service().restore(db_session, "loc-rest")
        assert ok is True
        rows = audit_rows()
        assert [r["action"] for r in rows] == ["archive", "restore"]
        restore = rows[1]
        assert (restore["entity"], restore["entity_id"]) == (
            "locations", "loc-rest",
        )
        assert restore["entity_label"] == "Студия"
        assert json.loads(restore["changes"]) is None

    async def test_rearchive_of_archived_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.location import get_location_service

        _insert_location("loc-noop", "Студия")
        await get_location_service().archive(db_session, "loc-noop")
        # Repeat archive on the already-archived row — a no-op, §4.6.
        ok = await get_location_service().archive(db_session, "loc-noop")
        assert ok is True
        rows = audit_rows()
        assert len(rows) == 1
        assert rows[0]["action"] == "archive"

    async def test_restore_of_active_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.location import get_location_service

        _insert_location("loc-live", "Студия")
        ok = await get_location_service().restore(db_session, "loc-live")
        assert ok is True
        assert audit_rows() == []

    async def test_archive_missing_row_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.location import get_location_service

        ok = await get_location_service().archive(db_session, "loc-none")
        assert ok is False
        assert audit_rows() == []


# ─── §4.2: StaffService.archive/restore — own implementations ─────────────────


class TestStaffArchiveAudit:
    async def test_archive_marks_staff_row_only(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.staff import get_staff_service
        from tests.conftest import query_db

        _insert_staff_card("staff-arch", "Иван", "Иванов")
        ok = await get_staff_service().archive(db_session, "staff-arch")
        assert ok is True
        rows = audit_rows()
        # ONE row for the person; the D6 checkbox cascades (masters/users
        # is_active flips) are child writes — never journaled (§4.2).
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "archive", "staff", "staff-arch",
        )
        assert row["entity_label"] == "Иванов Иван"
        assert json.loads(row["changes"]) is None
        # The cascade itself really happened…
        assert query_db(
            "SELECT is_active FROM masters WHERE staff_id = 'staff-arch'"
        )[0]["is_active"] == 0
        assert query_db(
            "SELECT is_active FROM users WHERE id = 'user-staff-arch'"
        )[0]["is_active"] == 0
        # …but produced no journal rows of its own.
        assert {r["entity"] for r in rows} == {"staff"}

    async def test_rearchive_of_archived_staff_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.staff import get_staff_service

        _insert_staff_card("staff-noop", "Пётр", "Петров")
        await get_staff_service().archive(db_session, "staff-noop")
        ok = await get_staff_service().archive(db_session, "staff-noop")
        assert ok is True
        rows = audit_rows()
        assert len(rows) == 1
        assert rows[0]["action"] == "archive"

    async def test_restore_marks_staff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.staff import get_staff_service

        _insert_staff_card("staff-res", "Сидор", "Сидоров")
        await get_staff_service().archive(db_session, "staff-res")
        ok = await get_staff_service().restore(db_session, "staff-res")
        assert ok is True
        rows = audit_rows()
        assert [r["action"] for r in rows] == ["archive", "restore"]
        assert rows[1]["entity_label"] == "Сидоров Сидор"
        assert json.loads(rows[1]["changes"]) is None

    async def test_restore_of_active_staff_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.staff import get_staff_service

        _insert_staff_card("staff-live", "Анна", "Аннина")
        ok = await get_staff_service().restore(db_session, "staff-live")
        assert ok is True
        assert audit_rows() == []


# ─── §4.3: records scenarios — the booking chain rows ─────────────────────────


def _seed_record_chain() -> None:
    """Seed the records FK chain directly (staff/master/service/location/
    activity/client) — the Task 3 scenario-test pattern."""
    from tests.conftest import query_db

    for sql in (
        "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        "created_at, updated_at) VALUES ('m-aud', 'А', 'Б', 0, 1, "
        "datetime('now'), datetime('now'))",
        "INSERT INTO masters (staff_id, specialty, color, is_active, "
        "created_at, updated_at) VALUES ('m-aud', 'живопись', '#5B8C7A', 1, "
        "datetime('now'), datetime('now'))",
        "INSERT INTO services (id, title, description, image_url, specialty, "
        "min_age, duration, record_info, is_active, created_at, updated_at) "
        "VALUES ('svc-aud', 'Аудит услуга', 'о', 'https://e.com/x.jpg', "
        "'живопись', 6, 90, 'и', 1, datetime('now'), datetime('now'))",
        "INSERT INTO locations (id, title, capacity, sort_order, is_active, "
        "created_at, updated_at) VALUES ('loc-aud', 'Аудит студия', 20, 0, 1, "
        "datetime('now'), datetime('now'))",
        "INSERT INTO activities (id, master_id, service_id, location_id, "
        "start, duration, capacity, is_private, created_at, updated_at) "
        "VALUES ('act-aud', 'm-aud', 'svc-aud', 'loc-aud', "
        "datetime('now', '+1 day'), 90, 10, 0, datetime('now'), "
        "datetime('now'))",
        "INSERT INTO clients (id, name, phone, channel, is_active, "
        "created_at, updated_at) VALUES ('cl-aud', 'Гость Аудит', "
        "'+79990001234', 'telegram', 1, datetime('now'), datetime('now'))",
    ):
        query_db(sql)


class TestRecordScenariosAudit:
    async def test_create_record_journals_record_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.record import RecordCreate, VisitItem
        from src.usecases.records import create_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud",
                client_id="cl-aud",
                visits=[VisitItem(name="Гость", price=3500)],
            ),
        )
        rows = audit_rows()
        # ONE row: the record. The find-or-created visitor/client and the
        # bulk-inserted visits are scenario children — never journaled.
        assert [r["entity"] for r in rows] == ["records"]
        row = rows[0]
        assert (row["action"], row["entity_id"]) == ("create", record.id)
        assert row["user_id"] == actor["id"]

    async def test_update_record_journals_update_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.record import RecordCreate, RecordUpdate, VisitItem
        from src.usecases.records import create_record, update_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud",
                client_id="cl-aud",
                visits=[VisitItem(name="Гость", price=3500)],
            ),
        )
        before = len(audit_rows())
        updated = await update_record(
            None,
            db_session=db_session,
            id=record.id,
            data=RecordUpdate(
                activity_id="act-aud",
                client_id="cl-aud",
                comment="Новое",
                visits=[VisitItem(name="Гость", price=3000)],
            ),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [r["entity"] for r in rows] == ["records"]
        assert rows[0]["action"] == "update"
        assert rows[0]["entity_id"] == record.id

    async def test_patch_record_journals_update_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.record import RecordCreate, RecordPatch
        from src.usecases.records import create_record, patch_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud",
                client_id="cl-aud",
                visits=[],
            ),
        )
        before = len(audit_rows())
        patched = await patch_record(
            None,
            db_session=db_session,
            id=record.id,
            data=RecordPatch(comment="Только комментарий"),
        )
        assert patched is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "records", record.id)
        ]

    async def test_patch_record_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        """Empty-body PATCH: no field changed → no journal row (§5.1)."""
        from src.schemas.record import RecordCreate, RecordPatch
        from src.usecases.records import create_record, patch_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud",
                client_id="cl-aud",
                visits=[],
                comment="Комментарий",
            ),
        )
        before = len(audit_rows())
        patched = await patch_record(
            None,
            db_session=db_session,
            id=record.id,
            data=RecordPatch(),  # nothing sent
        )
        assert patched is not None
        assert audit_rows()[before:] == []

    async def test_delete_record_journals_final_delete_row(
        self, db_session, actor, audit_rows
    ) -> None:
        """§4.5: the deferred-delete COMMIT writes the delete row; the
        cascade visits/payments never journal."""
        from sqlalchemy import text

        from src.schemas.record import RecordCreate, VisitItem
        from src.usecases.records import create_record, delete_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud",
                client_id="cl-aud",
                visits=[VisitItem(name="Гость", price=3500)],
            ),
        )
        await db_session.execute(
            text(
                "INSERT INTO payments (id, record_id, amount, method, "
                "created_at, updated_at) VALUES ('pay-aud', :rid, 500, "
                "'card', datetime('now'), datetime('now'))"
            ),
            {"rid": record.id},
        )
        await db_session.commit()
        before = len(audit_rows())
        ok = await delete_record(
            None,
            db_session=db_session,
            id=record.id,
            resolutions={"visits": "cascade", "payments": "cascade"},
            expected={
                "visits": [
                    v["id"]
                    for v in (
                        await db_session.execute(
                            text("SELECT id FROM visits WHERE record_id = :rid"),
                            {"rid": record.id},
                        )
                    ).mappings()
                ],
                "payments": ["pay-aud"],
            },
        )
        assert ok is True
        rows = audit_rows()[before:]
        # Final DELETE row only (§4.5) — cascade visits/payments silent.
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("delete", "records", record.id)
        ]


# ─── §4.3: standalone VisitService — visits rows ──────────────────────────────


class TestVisitServiceAudit:
    async def _seeded_record(self, db_session) -> str:
        from src.schemas.record import RecordCreate
        from src.usecases.records import create_record

        _seed_record_chain()
        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-aud", client_id="cl-aud", visits=[]
            ),
        )
        return record.id

    async def test_create_visit_journals_visit_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.visit import VisitCreate
        from src.services.visit import get_visit_service

        record_id = await self._seeded_record(db_session)
        before = len(audit_rows())
        visit = await get_visit_service().create(
            db_session,
            VisitCreate(record_id=record_id, price=3500),
        )
        assert visit is not None
        rows = audit_rows()[before:]
        # ONE visit row; the recompute hook's parent-record rewrite is a
        # cascade write — not journaled (§4.2).
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "visits", visit.id)
        ]

    async def test_update_visit_journals_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.visit import VisitCreate, VisitUpdate
        from src.services.visit import get_visit_service

        record_id = await self._seeded_record(db_session)
        visit = await get_visit_service().create(
            db_session, VisitCreate(record_id=record_id, price=3500),
        )
        before = len(audit_rows())
        updated = await get_visit_service().update(
            db_session,
            visit.id,
            VisitUpdate(record_id=record_id, price=7000),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "visits", visit.id)
        ]
        assert json.loads(rows[0]["changes"]) == {"price": [3500, 7000]}

    async def test_patch_visit_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.visit import VisitCreate, VisitPatch
        from src.services.visit import get_visit_service

        record_id = await self._seeded_record(db_session)
        visit = await get_visit_service().create(
            db_session, VisitCreate(record_id=record_id, price=3500),
        )
        before = len(audit_rows())
        patched = await get_visit_service().patch(
            db_session, visit.id, VisitPatch(),
        )
        assert patched is not None
        assert audit_rows()[before:] == []

    async def test_update_status_journals_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.visit import VisitCreate
        from src.services.visit import get_visit_service

        record_id = await self._seeded_record(db_session)
        visit = await get_visit_service().create(
            db_session, VisitCreate(record_id=record_id, price=3500),
        )
        before = len(audit_rows())
        updated = await get_visit_service().update_status(
            db_session, visit.id, "visited",
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "visits", visit.id)
        ]
        assert json.loads(rows[0]["changes"]) == {
            "status": ["waiting", "visited"]
        }

    async def test_delete_visit_journals_snapshot_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.visit import VisitCreate
        from src.services.visit import get_visit_service

        record_id = await self._seeded_record(db_session)
        visit = await get_visit_service().create(
            db_session, VisitCreate(record_id=record_id, price=3500),
        )
        before = len(audit_rows())
        ok = await get_visit_service().delete(db_session, visit.id)
        assert ok is True
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("delete", "visits", visit.id)
        ]
        assert json.loads(rows[0]["changes"]) == {
            "record_id": [record_id, None],
            "status": ["waiting", None],
            "price": [3500, None],
        }


# ─── §4.3: PhotoService — direct-write photo rows ─────────────────────────────


class TestPhotoServiceAudit:
    def _seed_photo(self, photo_id: str, filename: str) -> None:
        from tests.conftest import query_db

        query_db(
            f"INSERT INTO photos (id, filename, is_public, created_at, "
            f"updated_at) VALUES ('{photo_id}', '{filename}', 0, "
            f"datetime('now'), datetime('now'))"
        )

    async def test_create_photo_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.photo import PhotoCreate
        from src.services.photo import get_photo_service

        photo = await get_photo_service().create(
            db_session, PhotoCreate(filename="a.jpg"),
        )
        rows = audit_rows()
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "photos", photo.id)
        ]
        assert rows[0]["entity_label"] == "a.jpg"

    async def test_update_photo_journals_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.photo import PhotoUpdate
        from src.services.photo import get_photo_service

        self._seed_photo("ph-u", "old.jpg")
        before = len(audit_rows())
        updated = await get_photo_service().update(
            db_session, "ph-u", PhotoUpdate(filename="new.jpg", is_public=True),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "photos", "ph-u")
        ]
        assert json.loads(rows[0]["changes"]) == {
            "filename": ["old.jpg", "new.jpg"],
            "is_public": [False, True],
        }

    async def test_patch_photo_journals_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.photo import PhotoPatch
        from src.services.photo import get_photo_service

        self._seed_photo("ph-p", "old.jpg")
        before = len(audit_rows())
        patched = await get_photo_service().patch(
            db_session, "ph-p", PhotoPatch(is_public=True),
        )
        assert patched is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "photos", "ph-p")
        ]
        assert json.loads(rows[0]["changes"]) == {"is_public": [False, True]}

    async def test_patch_photo_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.photo import PhotoPatch
        from src.services.photo import get_photo_service

        self._seed_photo("ph-n", "same.jpg")
        before = len(audit_rows())
        patched = await get_photo_service().patch(
            db_session, "ph-n", PhotoPatch(),
        )
        assert patched is not None
        assert audit_rows()[before:] == []


# ─── §4.3: StaffService composite writes — card rows ──────────────────────────


class TestStaffCompositeAudit:
    async def test_create_staff_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.staff import StaffCreate
        from src.services.staff import get_staff_service

        card = await get_staff_service().create(
            db_session, StaffCreate(first_name="Иван", last_name="Иванов"),
        )
        rows = audit_rows()
        # ONE row for the card; masters/users/staff_positions children
        # (absent here by payload) never journal even when present.
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "staff", card.id)
        ]
        assert rows[0]["entity_label"] == "Иванов Иван"

    async def test_create_staff_with_sections_one_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.staff import (
            CreateUserSection,
            MasterSection,
            StaffCreate,
        )
        from src.services.staff import get_staff_service

        card = await get_staff_service().create(
            db_session,
            StaffCreate(
                first_name="Пётр",
                last_name="Петров",
                master=MasterSection(specialty="живопись", color="#000000"),
                create_user=CreateUserSection(
                    phone="+79990005551", password="long-password-1"
                ),
            ),
        )
        rows = audit_rows()
        # Cross-table children (masters row, users row, join rows) are
        # cascade writes — exactly ONE staff row in the journal.
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "staff", card.id)
        ]

    async def test_update_staff_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.staff import StaffCreate, StaffUpdate
        from src.services.staff import get_staff_service

        card = await get_staff_service().create(
            db_session, StaffCreate(first_name="Иван", last_name="Иванов"),
        )
        before = len(audit_rows())
        updated = await get_staff_service().update(
            db_session,
            card.id,
            StaffUpdate(first_name="Ян", last_name="Иванов"),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "staff", card.id)
        ]
        assert json.loads(rows[0]["changes"]) == {
            "first_name": ["Иван", "Ян"]
        }

    async def test_patch_staff_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.staff import StaffCreate, StaffPatch
        from src.services.staff import get_staff_service

        card = await get_staff_service().create(
            db_session, StaffCreate(first_name="Иван", last_name="Иванов"),
        )
        before = len(audit_rows())
        patched = await get_staff_service().patch(
            db_session, card.id, StaffPatch(first_name="Иоанн"),
        )
        assert patched is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "staff", card.id)
        ]

    async def test_patch_staff_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.staff import StaffCreate, StaffPatch
        from src.services.staff import get_staff_service

        card = await get_staff_service().create(
            db_session, StaffCreate(first_name="Иван", last_name="Иванов"),
        )
        before = len(audit_rows())
        patched = await get_staff_service().patch(
            db_session, card.id, StaffPatch(),
        )
        assert patched is not None
        assert audit_rows()[before:] == []


# ─── §4.3: ProfileService — the «Мои данные» card half ────────────────────────


class TestProfileAudit:
    async def test_profile_update_journals_staff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        """PUT /my rewrites the session user's staff card — ONE explicit
        ``update`` row on entity ``staff`` (the journal key for profile
        writes, per ENTITY_SIGNATURES note: profile rows are marked as
        "staff")."""
        from src.schemas.my import MyProfileUpdate
        from src.services.profile import get_profile_service
        from tests.conftest import query_db

        # The actor's user needs a staff card for the card half.
        query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) VALUES ('staff-me', 'Старое', "
            "'Имя', 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"UPDATE users SET staff_id = 'staff-me' WHERE id = "
            f"'{actor['id']}'"
        )
        before = len(audit_rows())
        resp = await get_profile_service().update(
            db_session,
            actor["id"],
            MyProfileUpdate(first_name="Новое"),
        )
        assert resp.first_name == "Новое"
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "staff", "staff-me")
        ]
        assert json.loads(rows[0]["changes"]) == {
            "first_name": ["Старое", "Новое"]
        }

    async def test_profile_update_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.my import MyProfileUpdate
        from src.services.profile import get_profile_service
        from tests.conftest import query_db

        query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) VALUES ('staff-me2', 'То же', "
            "'Имя', 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"UPDATE users SET staff_id = 'staff-me2' WHERE id = "
            f"'{actor['id']}'"
        )
        before = len(audit_rows())
        resp = await get_profile_service().update(
            db_session,
            actor["id"],
            MyProfileUpdate(first_name="То же"),
        )
        assert resp.first_name == "То же"
        assert audit_rows()[before:] == []

    async def test_set_avatar_journals_staff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.profile import get_profile_service
        from tests.conftest import query_db

        query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) VALUES ('staff-av', 'Анна', "
            "'Анькина', 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"UPDATE users SET staff_id = 'staff-av' WHERE id = "
            f"'{actor['id']}'"
        )
        before = len(audit_rows())
        old = await get_profile_service().set_avatar(
            db_session, actor["id"], "/api/v1/files/avatar/new.png",
        )
        assert old is None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "staff", "staff-av")
        ]
        assert json.loads(rows[0]["changes"]) == {
            "avatar_url": [None, "/api/v1/files/avatar/new.png"]
        }


# ─── §4.3: UserSettingsService — settings rows ────────────────────────────────


class TestUserSettingsAudit:
    async def test_create_settings_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.user_settings import UserSettingsCreate
        from src.services.user_settings import get_user_settings_service

        created = await get_user_settings_service().create(
            db_session,
            UserSettingsCreate(user_id=actor["id"]),
        )
        rows = audit_rows()
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "user_settings", created.id)
        ]
        assert rows[0]["entity_label"] == "Настройки"

    async def test_update_settings_journals_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.user_settings import (
            UserSettingsCreate,
            UserSettingsUpdate,
        )
        from src.services.user_settings import get_user_settings_service

        created = await get_user_settings_service().create(
            db_session,
            UserSettingsCreate(user_id=actor["id"]),
        )
        before = len(audit_rows())
        updated = await get_user_settings_service().update_by_user_id(
            db_session,
            actor["id"],
            UserSettingsUpdate(theme="dark"),
        )
        assert updated is not None
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("update", "user_settings", created.id)
        ]
        assert json.loads(rows[0]["changes"]) == {"theme": ["light", "dark"]}

    async def test_update_settings_noop_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.schemas.user_settings import (
            UserSettingsCreate,
            UserSettingsUpdate,
        )
        from src.services.user_settings import get_user_settings_service

        await get_user_settings_service().create(
            db_session,
            UserSettingsCreate(user_id=actor["id"]),
        )
        before = len(audit_rows())
        updated = await get_user_settings_service().update_by_user_id(
            db_session,
            actor["id"],
            UserSettingsUpdate(),  # nothing sent
        )
        assert updated is not None
        assert audit_rows()[before:] == []


# ─── §4.5: resolve_delete — the deferred-delete commit for dictionaries ───────


class TestResolveDeleteAudit:
    def _seed_client_with_record(self) -> None:
        """A client + one record NULLIFY-resolution target."""
        _seed_record_chain()
        from tests.conftest import query_db

        query_db(
            "INSERT INTO records (id, activity_id, client_id, status, seats, "
            "created_at, updated_at) VALUES ('rec-del', 'act-aud', 'cl-del', "
            "'pending', 1, datetime('now'), datetime('now'))"
        )
        query_db(
            "INSERT INTO clients (id, name, phone, channel, is_active, "
            "created_at, updated_at) VALUES ('cl-del', 'Удаляемый', "
            "'+79990005552', 'telegram', 1, datetime('now'), datetime('now'))"
        )

    async def test_client_resolve_delete_journals_delete_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.client import get_client_service

        self._seed_client_with_record()
        before = len(audit_rows())
        ok = await get_client_service().resolve_delete(
            db_session, "cl-del", {"records": "nullify"},
        )
        assert ok is True
        rows = audit_rows()[before:]
        # §4.5: the deferred-delete COMMIT journals the client delete; the
        # nullified records.client_id writes are child updates — silent.
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("delete", "clients", "cl-del")
        ]
        # Label per the client signature: name + MASKED phone (§5.1).
        assert rows[0]["entity_label"] == "Удаляемый, +•••••••5552"

    async def test_tag_hard_delete_journals_delete_row(
        self, db_session, actor, audit_rows
    ) -> None:
        """The clean-tag path of the same executor (no deps at all)."""
        from src.services.tag import get_tag_service

        _insert_tag("tag-del", "Удаляемый тег")
        before = len(audit_rows())
        ok = await get_tag_service().resolve_delete(db_session, "tag-del", {})
        assert ok is True
        rows = audit_rows()[before:]
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("delete", "tags", "tag-del")
        ]


def _insert_tag(tag_id: str, title: str) -> None:
    """Seed a tag row directly (no repository call → no auto row)."""
    from tests.conftest import query_db

    query_db(
        f"INSERT INTO tags (id, title, created_at, updated_at) "
        f"VALUES ('{tag_id}', '{title}', datetime('now'), datetime('now'))"
    )


# ─── §4.5: ActivityService.delete — the deferred-delete commit (#286) ─────────


class TestActivityDeleteAudit:
    async def test_delete_activity_journals_delete_row(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.activity import get_activity_service

        _seed_record_chain()
        before = len(audit_rows())
        ok = await get_activity_service().delete(db_session, "act-aud")
        assert ok is True
        rows = audit_rows()[before:]
        # ONE activity delete row; the cascaded records/visits/payments/
        # joins/photo-unlink writes are child writes — never journaled.
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("delete", "activities", "act-aud")
        ]

    async def test_delete_missing_activity_writes_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        from src.services.activity import get_activity_service

        ok = await get_activity_service().delete(db_session, "act-none")
        assert ok is False
        assert audit_rows() == []


# ─── §8 row 1 representative: payments single CRUD — auto-collection ─────────


class TestPaymentsAutoAudit:
    async def test_create_payment_auto_journals_row(
        self, db_session, actor, audit_rows
    ) -> None:
        """Payments ride the generic repository — Task 3 auto-collection
        already covers them; this pins the §8 row 1 representative."""
        from src.schemas.payment import PaymentCreate
        from src.services.payment import get_payment_service

        _seed_record_chain()
        from sqlalchemy import text

        await db_session.execute(
            text(
                "INSERT INTO records (id, activity_id, client_id, status, "
                "seats, created_at, updated_at) VALUES ('rec-pay', "
                "'act-aud', 'cl-aud', 'pending', 0, datetime('now'), "
                "datetime('now'))"
            )
        )
        await db_session.commit()
        payment = await get_payment_service().create(
            db_session,
            PaymentCreate(record_id="rec-pay", amount=3500, method="card"),
        )
        rows = audit_rows()
        assert [(r["action"], r["entity"], r["entity_id"]) for r in rows] == [
            ("create", "payments", payment.id)
        ]
        assert rows[0]["entity_label"] == "Платёж 3500, card"
