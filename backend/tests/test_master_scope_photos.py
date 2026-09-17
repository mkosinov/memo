"""GH #263 T5 — photos scope: EXISTS-ветка по activity + owner-проверки.

Spec D6 (docs/specs/2026-09-10-master-role-design.md) + domain rules
«Master role (#263)» (docs/domain-rules/photos.md):

* скоуп мастера через photo.activity_id → activity.master_id
  (EXISTS-ветка в существующем билдере списка; LEFT JOIN-путь
  service_id-фильтра не затронут);
* фото клиентов/услуг/локаций и фото без владельца мастеру
  НЕ видны (нет activity_id → EXISTS ложен);
* точечные get/PUT/PATCH/DELETE — только для/к своей активности
  (чужое → 404, неразличимо с «не существует», 404-fast-path);
* create с чужим activity_id → 404 (валидация цели);
* PUT не может перепривязать фото на чужую активность;
* /photos/web — публичный, без изменений;
* admin → без скоупа (regression-pinned).

The master session comes from the ``make_master`` conftest factory;
photos are seeded through the admin API.

Spec: docs/specs/2026-09-10-master-role-design.md
Domain rules: docs/domain-rules/photos.md (Master role #263)
"""

from __future__ import annotations

import uuid as _uuid

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


def _activity_payload(master_id: str, **overrides) -> dict:
    """Raw POST /activities payload bound to the given master key."""
    from datetime import UTC, datetime, timedelta

    svc = f"svc-{_uuid.uuid4().hex[:8]}"
    loc = f"loc-{_uuid.uuid4().hex[:8]}"
    return {
        "master_id": master_id,
        "service_id": svc,
        "location_id": loc,
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90,
        "capacity": 10,
        "is_private": False,
        **overrides,
    }


def _seed_photo(api_client, filename: str, **owner) -> dict:
    """Seed one photo via the admin API (admin has no scope)."""
    resp = api_client.post("/api/v1/photos", json={
        "filename": filename, **owner,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def photo_scope_world(
    api_client, create_service, create_location, make_master,
) -> dict:
    """Own + foreign activity (real second master), one activity-photo each,
    plus one client-owned, one service-owned, one location-owned and one
    ownerless photo (all invisible to the master)."""
    from src.auth.passwords import hash_password
    from tests.conftest import insert_master_user

    master = make_master()
    svc, loc = create_service(), create_location()
    foreign_staff = insert_master_user(
        f"+7999{_uuid.uuid4().hex[:7]}", hash_password("x")
    )["staff_id"]
    own_act = api_client.post("/api/v1/activities", json=_activity_payload(
        master["staff_id"], service_id=svc["id"], location_id=loc["id"],
    )).json()
    foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
        foreign_staff, service_id=svc["id"], location_id=loc["id"],
    )).json()
    own_photo = _seed_photo(
        api_client, "own-activity.jpg", activity_id=own_act["id"]
    )
    foreign_photo = _seed_photo(
        api_client, "foreign-activity.jpg", activity_id=foreign_act["id"]
    )
    client_photo = _seed_photo(
        api_client, "client-owned.jpg",
        client_id=api_client.post("/api/v1/clients", json={
            "name": "Клиент фото",
            "phone": f"+7999{_uuid.uuid4().hex[:7]}",
            "channel": "telegram",
        }).json()["id"],
    )
    service_photo = _seed_photo(api_client, "service-owned.jpg", service_id=svc["id"])
    location_photo = _seed_photo(api_client, "location-owned.jpg", location_id=loc["id"])
    orphan_photo = _seed_photo(api_client, "ownerless.jpg")
    return {
        "master": master,
        "own": {"activity": own_act, "photo": own_photo},
        "foreign": {"activity": foreign_act, "photo": foreign_photo},
        "invisible_ids": [
            client_photo["id"], service_photo["id"],
            location_photo["id"], orphan_photo["id"],
        ],
    }


class TestPhotoListScope:
    """GET /api/v1/photos: EXISTS-ветка photo → activity.master_id."""

    def test_list_shows_only_own_activity_photos(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        resp = mc.get("/api/v1/photos")
        assert resp.status_code == 200, resp.text
        ids = [p["id"] for p in resp.json()["items"]]
        assert photo_scope_world["own"]["photo"]["id"] in ids
        assert photo_scope_world["foreign"]["photo"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_list_hides_client_service_location_ownerless(
        self, photo_scope_world,
    ) -> None:
        """Фото клиентов/услуг/локаций и без владельца — не видны."""
        mc = photo_scope_world["master"]["client"]
        resp = mc.get("/api/v1/photos", params={"per_page": 100})
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()["items"]]
        for pid in photo_scope_world["invisible_ids"]:
            assert pid not in ids

    def test_list_activity_id_param_conjunctive(self, photo_scope_world) -> None:
        """activity_id filter ≠ own activity → conjunctive AND → empty."""
        mc = photo_scope_world["master"]["client"]
        resp = mc.get("/api/v1/photos", params={
            "activity_id": photo_scope_world["foreign"]["activity"]["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_list_service_id_filter_still_works_for_master(
        self, photo_scope_world,
    ) -> None:
        """The LEFT JOIN service_id-filter path coexists with the scope:
        own activity photo found via its activity's service."""
        world = photo_scope_world
        svc_id = world["own"]["activity"]["service_id"]
        mc = world["master"]["client"]
        resp = mc.get("/api/v1/photos", params={"service_id": svc_id})
        assert resp.status_code == 200, resp.text
        ids = [p["id"] for p in resp.json()["items"]]
        assert world["own"]["photo"]["id"] in ids

    def test_empty_scope_master_sees_nothing(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Master WITHOUT a masters row: empty set — not the studio."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master(with_masters_row=False)
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user(
            f"+7999{_uuid.uuid4().hex[:7]}", hash_password("x")
        )["staff_id"]
        act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        _seed_photo(api_client, "someone-else.jpg", activity_id=act["id"])

        resp = master["client"].get("/api/v1/photos")
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_admin_sees_all_regression(self, photo_scope_world, api_client) -> None:
        """Admin: no scope — all 6 seeded photos visible."""
        resp = api_client.get("/api/v1/photos", params={"per_page": 100})
        assert resp.status_code == 200
        assert resp.json()["total"] == 6


class TestPhotoPointGetScope:
    """GET /api/v1/photos/{id}: owner-check via photo → activity."""

    def test_own_get_200(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["own"]["photo"]
        resp = mc.get(f"/api/v1/photos/{photo['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == photo["id"]

    def test_foreign_get_404(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        pid = photo_scope_world["foreign"]["photo"]["id"]
        resp = mc.get(f"/api/v1/photos/{pid}")
        assert resp.status_code == 404

    def test_ownerless_get_404(self, photo_scope_world, api_client) -> None:
        """A photo without activity_id is invisible to the master."""
        resp = api_client.post("/api/v1/photos", json={"filename": "orphan2.jpg"})
        assert resp.status_code == 201, resp.text
        mc = photo_scope_world["master"]["client"]
        resp = mc.get(f"/api/v1/photos/{resp.json()['id']}")
        assert resp.status_code == 404

    def test_missing_get_404_unchanged(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        assert mc.get("/api/v1/photos/nonexistent-id").status_code == 404


class TestPhotoCreateScope:
    """POST /api/v1/photos: create only к своей активности."""

    def test_create_own_activity_201(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        own_act = photo_scope_world["own"]["activity"]
        resp = mc.post("/api/v1/photos", json={
            "filename": "master-created.jpg", "activity_id": own_act["id"],
        })
        assert resp.status_code == 201, resp.text
        assert resp.json()["activity_id"] == own_act["id"]

    def test_create_foreign_activity_404(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        foreign_act = photo_scope_world["foreign"]["activity"]
        resp = mc.post("/api/v1/photos", json={
            "filename": "intruder.jpg", "activity_id": foreign_act["id"],
        })
        assert resp.status_code == 404, resp.text
        rows = query_db(
            "SELECT id FROM photos WHERE activity_id="
            f"'{foreign_act['id']}' AND filename='intruder.jpg'"
        )
        assert rows == []  # nothing written

    def test_create_ownerless_by_master_201(self, photo_scope_world) -> None:
        """No activity_id → no target to validate → create is allowed."""
        mc = photo_scope_world["master"]["client"]
        resp = mc.post("/api/v1/photos", json={"filename": "free.jpg"})
        assert resp.status_code == 201, resp.text

    def test_create_admin_foreign_activity_still_201(
        self, photo_scope_world, api_client,
    ) -> None:
        """Admin regression: no scope on create."""
        foreign_act = photo_scope_world["foreign"]["activity"]
        resp = api_client.post("/api/v1/photos", json={
            "filename": "admin-created.jpg", "activity_id": foreign_act["id"],
        })
        assert resp.status_code == 201, resp.text


class TestPhotoUpdateScope:
    """PUT/PATCH /api/v1/photos/{id}: own only; PUT re-target gated."""

    def test_own_put_ok(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["own"]["photo"]
        resp = mc.put(f"/api/v1/photos/{photo['id']}", json={
            "filename": "renamed.jpg", "is_public": True,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["filename"] == "renamed.jpg"

    def test_own_patch_ok(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["own"]["photo"]
        resp = mc.patch(f"/api/v1/photos/{photo['id']}", json={"is_public": True})
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_public"] is True

    def test_foreign_put_404(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["foreign"]["photo"]
        resp = mc.put(f"/api/v1/photos/{photo['id']}", json={
            "filename": "hacked.jpg", "is_public": True,
        })
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT filename FROM photos WHERE id='{photo['id']}'")
        assert rows[0]["filename"] == photo["filename"]  # untouched

    def test_foreign_patch_404(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["foreign"]["photo"]
        resp = mc.patch(f"/api/v1/photos/{photo['id']}", json={"is_public": True})
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT is_public FROM photos WHERE id='{photo['id']}'")
        assert rows[0]["is_public"] == 0  # untouched

    def test_put_retarget_foreign_activity_404(self, photo_scope_world) -> None:
        """PUT own photo with a FOREIGN activity_id → 404 (new-target gate)."""
        world = photo_scope_world
        mc = world["master"]["client"]
        photo = world["own"]["photo"]
        foreign_act = world["foreign"]["activity"]
        resp = mc.put(f"/api/v1/photos/{photo['id']}", json={
            "filename": "moved.jpg", "is_public": False,
            "activity_id": foreign_act["id"],
        })
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT activity_id FROM photos WHERE id='{photo['id']}'")
        assert rows[0]["activity_id"] == photo["activity_id"]  # did NOT move

    def test_patch_retarget_foreign_activity_404(self, photo_scope_world) -> None:
        """PATCH can re-target activity_id too → same new-target gate."""
        world = photo_scope_world
        mc = world["master"]["client"]
        photo = world["own"]["photo"]
        foreign_act = world["foreign"]["activity"]
        resp = mc.patch(
            f"/api/v1/photos/{photo['id']}",
            json={"activity_id": foreign_act["id"]},
        )
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT activity_id FROM photos WHERE id='{photo['id']}'")
        assert rows[0]["activity_id"] == photo["activity_id"]


class TestPhotoDeleteScope:
    """DELETE /api/v1/photos/{id}: own 204 / foreign 404."""

    def test_own_delete_204(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["own"]["photo"]
        resp = mc.delete(f"/api/v1/photos/{photo['id']}")
        assert resp.status_code == 204
        assert not query_db(f"SELECT id FROM photos WHERE id='{photo['id']}'")

    def test_foreign_delete_404(self, photo_scope_world) -> None:
        mc = photo_scope_world["master"]["client"]
        photo = photo_scope_world["foreign"]["photo"]
        resp = mc.delete(f"/api/v1/photos/{photo['id']}")
        assert resp.status_code == 404
        assert query_db(f"SELECT id FROM photos WHERE id='{photo['id']}'")


class TestPhotosWebUnchanged:
    """GET /api/v1/photos/web stays public and unscoped."""

    def test_web_master_gets_public_photos_of_foreign_activity(
        self, photo_scope_world, api_client,
    ) -> None:
        """The foreign activity photo is public → still on /web for master."""
        api_client.patch(
            f"/api/v1/photos/{photo_scope_world['foreign']['photo']['id']}",
            json={"is_public": True},
        )
        mc = photo_scope_world["master"]["client"]
        resp = mc.get("/api/v1/photos/web")
        assert resp.status_code == 200, resp.text
        ids = [p["id"] for p in resp.json()]
        assert photo_scope_world["foreign"]["photo"]["id"] in ids
