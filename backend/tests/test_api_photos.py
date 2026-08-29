"""Tests for the Photos API endpoints (public gallery + admin CRUD + list contract)."""

import asyncio
from datetime import datetime

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

PHOTOS_URL = "/api/v1/photos"

#: photo keys of the photos_fixture dict, in owner-slot order
FIXTURE_PHOTOS = (
    "p_client", "p_client2", "p_act", "p_svc", "p_loc", "p_tags", "p_tag1",
)


class TestPhotosWebEndpoint:
    """GET /api/v1/photos/web — public photos endpoint."""

    def test_web_returns_only_public_photos(self, api_client) -> None:
        """GET /api/v1/photos/web returns only photos with is_public=true."""
        # Insert test photos directly
        asyncio.run(_insert_photo_direct(
            id="public-01",
            filename="public.jpg",
            is_public=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="private-01",
            filename="private.jpg",
            is_public=False,
        ))

        response = api_client.get("/api/v1/photos/web")

        assert response.status_code == 200
        photos = response.json()
        assert isinstance(photos, list)
        filenames = [p["filename"] for p in photos]
        assert "public.jpg" in filenames
        assert "private.jpg" not in filenames

    def test_web_filter_by_activity_id(self, api_client, create_activity) -> None:
        """GET /api/v1/photos/web?activity_id=X returns only photos for that activity."""
        # Create real activities to satisfy FK constraints
        activity_a = create_activity()
        activity_b = create_activity()

        asyncio.run(_insert_photo_direct(
            id="act-a-01",
            filename="activity_a.jpg",
            activity_id=activity_a["id"],
            is_public=True,
        ))
        asyncio.run(_insert_photo_direct(
            id="act-b-01",
            filename="activity_b.jpg",
            activity_id=activity_b["id"],
            is_public=True,
        ))

        response = api_client.get(
            "/api/v1/photos/web",
            params={"activity_id": activity_a["id"]},
        )

        assert response.status_code == 200
        photos = response.json()
        filenames = [p["filename"] for p in photos]
        assert "activity_a.jpg" in filenames
        assert "activity_b.jpg" not in filenames

    def test_web_returns_empty_list_when_no_public_photos(self, api_client) -> None:
        """GET /api/v1/photos/web returns [] when no public photos exist."""
        asyncio.run(_insert_photo_direct(
            id="private-only",
            filename="private.jpg",
            is_public=False,
        ))

        response = api_client.get("/api/v1/photos/web")

        assert response.status_code == 200
        assert response.json() == []

    def test_web_response_matches_photo_response_schema(self, api_client) -> None:
        """GET /api/v1/photos/web returns items conforming to PhotoResponse schema."""
        from src.schemas.photo import PhotoResponse

        asyncio.run(_insert_photo_direct(
            id="schema-test",
            filename="schema_test.jpg",
            is_public=True,
        ))

        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert len(photos) == 1
        # Validate with schema
        photo = PhotoResponse.model_validate(photos[0])
        assert photo.filename == "schema_test.jpg"


# Owner IDs for the two-owners 422 tests — the multiple-owner validator
# fires before any DB access, so arbitrary UUIDs are sufficient.
C1 = "11111111-1111-1111-1111-111111111111"
S1 = "22222222-2222-2222-2222-222222222222"


class TestPhotosListParams:
    """GET /api/v1/photos — query param validation (#211 Task 2)."""

    @pytest.mark.parametrize("bad", [
        {"page": 0},
        {"per_page": 0},
        {"per_page": 101},
        {"q": "a"},
        {"q": "x" * 101},
        {"sort_by": "client_id"},
        {"sort_order": "up"},
    ])
    def test_photos_list_params_422(self, api_client, bad) -> None:
        """Invalid page/per_page/q/sort values return 422."""
        response = api_client.get(PHOTOS_URL, params=bad)
        assert response.status_code == 422

    def test_photo_create_two_owners_422(self, api_client) -> None:
        """POST with two owner IDs (client_id + service_id) returns 422."""
        response = api_client.post(PHOTOS_URL, json={
            "filename": "a.jpg",
            "client_id": C1,
            "service_id": S1,
        })
        assert response.status_code == 422

    def test_photo_put_two_owners_422(self, api_client) -> None:
        """PUT with two owner IDs in one payload returns 422 (payload validator)."""
        create = api_client.post(PHOTOS_URL, json={"filename": "victim.jpg"})
        photo_id = create.json()["id"]

        response = api_client.put(f"{PHOTOS_URL}/{photo_id}", json={
            "filename": "b.jpg",
            "is_public": False,
            "client_id": C1,
            "service_id": S1,
        })
        assert response.status_code == 422
        assert "at most one owner" in str(response.json()["detail"])


@pytest.fixture()
def photos_fixture(
    api_client, create_client, create_location, create_service,
    create_activity, create_tag,
):
    """7 photos covering every owner slot + the tag AND pair.

    Filenames are chosen so that:
      - q="CARD" (case-insensitive) matches ONLY the two client-owned
        photos ("p_card_one.jpg" / "p_card_two.jpg");
      - q="p_" matches both client-owned photos (q+filter combo case).

    Owner slots: p_client/p_client2 → client C1; p_act → activity A1
    (A1.service=S1, A1.location=L1); p_svc → service S2 direct;
    p_loc → location L2 (standalone); p_tags/p_tag1 → owner-less with
    tags [T1,T2] / [T1].
    """
    c1 = create_client(name="Anna Karenina")
    l1 = create_location(name="Act Studio")
    l2 = create_location(name="Hall Venue")
    s1 = create_service(title="Wheel pottery")
    s2 = create_service(title="Oil painting")
    a1 = create_activity(service_id=s1["id"], location_id=l1["id"])
    t1 = create_tag(tag="workshop")
    t2 = create_tag(tag="kids")

    def post_photo(filename: str, **extra: object) -> dict:
        resp = api_client.post(
            PHOTOS_URL, json={"filename": filename, **extra}
        )
        assert resp.status_code == 201, (
            f"photo POST failed: {resp.status_code}: {resp.text}"
        )
        return resp.json()

    return {
        "c1": c1, "l1": l1, "l2": l2, "s1": s1, "s2": s2, "a1": a1,
        "t1": t1, "t2": t2,
        "p_client": post_photo(
            "p_card_one.jpg", client_id=c1["id"], is_public=True),
        "p_client2": post_photo("p_card_two.jpg", client_id=c1["id"]),
        "p_act": post_photo("activity_shot.jpg", activity_id=a1["id"]),
        "p_svc": post_photo("service_direct.jpg", service_id=s2["id"]),
        "p_loc": post_photo("location_hall.jpg", location_id=l2["id"]),
        "p_tags": post_photo(
            "tagged_both.jpg", tag_ids=[t1["id"], t2["id"]]),
        "p_tag1": post_photo("tagged_single.jpg", tag_ids=[t1["id"]]),
    }


def _all_ids(fx: dict) -> set[str]:
    return {fx[key]["id"] for key in FIXTURE_PHOTOS}


def _cases(fx: dict) -> dict[str, tuple[dict, set[str], int]]:
    """Case name → (query params, expected photo-id set, expected total)."""
    return {
        "plain": ({}, _all_ids(fx), 7),
        # 7 items, per_page 10 → page 2 has no items, total stays honest
        "page2_empty_for_7_per_10": ({"page": 2, "per_page": 10}, set(), 7),
        # case-insensitive substring on filename, client-owned only
        "q_substring_ci": (
            {"q": "CARD"},
            {fx["p_client"]["id"], fx["p_client2"]["id"]},
            2,
        ),
        "client_filter": (
            {"client_id": fx["c1"]["id"]},
            {fx["p_client"]["id"], fx["p_client2"]["id"]},
            2,
        ),
        # p_act's ACTIVITY is at L1 — still empty (direct-only filter)
        "location_direct_only": ({"location_id": fx["l1"]["id"]}, set(), 0),
        "location_owned": (
            {"location_id": fx["l2"]["id"]}, {fx["p_loc"]["id"]}, 1,
        ),
        # variant A: via activity (A1.service == S1)
        "service_variant_a": (
            {"service_id": fx["s1"]["id"]}, {fx["p_act"]["id"]}, 1,
        ),
        # variant A: direct ownership
        "service_variant_a_direct": (
            {"service_id": fx["s2"]["id"]}, {fx["p_svc"]["id"]}, 1,
        ),
        # AND: p_tag1 has only T1
        "tags_and": (
            {"tag_id": [fx["t1"]["id"], fx["t2"]["id"]]},
            {fx["p_tags"]["id"]},
            1,
        ),
        # duplicates are deduped: single tag T1 semantics
        "tags_dup_dedup": (
            {"tag_id": [fx["t1"]["id"], fx["t1"]["id"]]},
            {fx["p_tags"]["id"], fx["p_tag1"]["id"]},
            2,
        ),
        "unknown_filter_empty": (
            {"client_id": "00000000-0000-0000-0000-000000000000"}, set(), 0,
        ),
        # a photo has at most one owner → two owner filters = empty
        "two_owner_filters_empty": (
            {"client_id": fx["c1"]["id"], "service_id": fx["s2"]["id"]},
            set(),
            0,
        ),
        "q_and_filter": (
            {"q": "p_", "client_id": fx["c1"]["id"]},
            {fx["p_client"]["id"], fx["p_client2"]["id"]},
            2,
        ),
    }


class TestPhotosListContract:
    """GET /api/v1/photos — server pagination / filters / sort (#211 Task 3)."""

    @pytest.mark.parametrize("name", [
        "plain",
        "page2_empty_for_7_per_10",
        "q_substring_ci",
        "client_filter",
        "location_direct_only",
        "location_owned",
        "service_variant_a",
        "service_variant_a_direct",
        "tags_and",
        "tags_dup_dedup",
        "unknown_filter_empty",
        "two_owner_filters_empty",
        "q_and_filter",
    ])
    def test_photos_filter_matrix(
        self, api_client, photos_fixture, name: str,
    ) -> None:
        """Each filter combination returns exactly the expected photo set."""
        params, expected, total = _cases(photos_fixture)[name]

        response = api_client.get(PHOTOS_URL, params=params)

        assert response.status_code == 200, (
            f"[{name}] {response.status_code}: {response.text}"
        )
        body = response.json()
        got = {item["id"] for item in body["items"]}
        assert got == expected, f"[{name}] expected ids {expected}, got {got}"
        assert body["total"] == total, f"[{name}] dishonest total"

    def test_photos_sort_and_tiebreak(self, api_client, photos_fixture) -> None:
        """filename asc/desc; is_public asc (False first); default
        created_at desc + id asc tiebreak."""
        # ── filename asc / desc ─────────────────────────────────────────
        r = api_client.get(PHOTOS_URL, params={
            "sort_by": "filename", "sort_order": "asc",
            "per_page": 100,
        })
        names = [i["filename"] for i in r.json()["items"]]
        assert names == sorted(names)

        r = api_client.get(PHOTOS_URL, params={
            "sort_by": "filename", "sort_order": "desc",
            "per_page": 100,
        })
        names = [i["filename"] for i in r.json()["items"]]
        assert names == sorted(names, reverse=True)

        # ── is_public asc: False (0) rows first ─────────────────────────
        r = api_client.get(PHOTOS_URL, params={
            "sort_by": "is_public", "sort_order": "asc", "per_page": 100,
        })
        flags = [i["is_public"] for i in r.json()["items"]]
        assert flags == sorted(flags)
        assert flags[0] is False and flags[-1] is True

        # ── default sort: created_at desc + id asc tiebreak ─────────────
        # 3a. identical created_at on all rows → pure id-asc order
        query_db("UPDATE photos SET created_at = '2026-01-01 00:00:00'")
        r = api_client.get(PHOTOS_URL, params={"per_page": 100})
        got_ids = [i["id"] for i in r.json()["items"]]
        assert got_ids == sorted(_all_ids(photos_fixture))

        # 3b. distinct created_at → newest first, oldest last
        query_db(
            "UPDATE photos SET created_at = '2026-01-01 00:00:0'"
            " || (9 - CAST(substr(id, 1, 1) AS INTEGER))"
        )
        r = api_client.get(PHOTOS_URL, params={"per_page": 100})
        created = [i["created_at"] for i in r.json()["items"]]
        assert created == sorted(created, reverse=True)

    def test_photos_client_name(self, api_client, photos_fixture) -> None:
        """client_name: C1's name for client photos; None for others;
        still resolves after the client is archived."""
        r = api_client.get(PHOTOS_URL, params={"per_page": 100})
        by_id = {i["id"]: i for i in r.json()["items"]}

        client_name = photos_fixture["c1"]["name"]
        assert by_id[photos_fixture["p_client"]["id"]]["client_name"] == client_name
        assert by_id[photos_fixture["p_client2"]["id"]]["client_name"] == client_name
        # non-client owners and owner-less photos carry no client_name
        for key in ("p_act", "p_svc", "p_loc", "p_tags", "p_tag1"):
            assert by_id[photos_fixture[key]["id"]]["client_name"] is None, key

        # archived client still resolves (no is_active filter on the join)
        arch = api_client.post(
            f"/api/v1/clients/{photos_fixture['c1']['id']}/archive"
        )
        assert arch.status_code == 200, arch.text

        r = api_client.get(PHOTOS_URL, params={"per_page": 100})
        by_id = {i["id"]: i for i in r.json()["items"]}
        assert by_id[photos_fixture["p_client"]["id"]]["client_name"] == client_name

    def test_photos_envelope(self, api_client, photos_fixture) -> None:
        """items/total/page/per_page honest under the service filter
        (LEFT JOIN must not double-count)."""
        r = api_client.get(
            PHOTOS_URL, params={"service_id": photos_fixture["s1"]["id"]}
        )
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) == {"items", "total", "page", "per_page"}
        assert body["total"] == 1
        assert len(body["items"]) == 1
        assert body["page"] == 1
        assert body["per_page"] == 20  # server default echoed

    def test_photos_full_valid_param_set_200(self, api_client, photos_fixture) -> None:
        """q + filters + sort together (full valid param set) → 200."""
        fx = photos_fixture
        response = api_client.get(PHOTOS_URL, params={
            "q": "card",
            "client_id": fx["c1"]["id"],
            "tag_id": [],
            "sort_by": "filename",
            "sort_order": "desc",
            "page": 1,
            "per_page": 10,
        })
        assert response.status_code == 200, response.text
        body = response.json()
        names = [i["filename"] for i in body["items"]]
        assert names == ["p_card_two.jpg", "p_card_one.jpg"]


class TestPhotosOwnerValidation:
    """Merged-set owner validation in the service (#211 Task 3, spec §6.2)."""

    def test_put_single_owner_conflicts_row(
        self, api_client, photos_fixture,
    ) -> None:
        """PUT carrying one owner against a row holding a different owner
        → 422 (exclude_unset hole closed by the merged-set check)."""
        fx = photos_fixture
        response = api_client.put(f"{PHOTOS_URL}/{fx['p_client']['id']}", json={
            "filename": "reowned.jpg",
            "is_public": False,
            "location_id": fx["l2"]["id"],
        })
        assert response.status_code == 422
        assert "at most one owner" in str(response.json()["detail"])

    def test_patch_adding_second_owner_422(
        self, api_client, photos_fixture,
    ) -> None:
        """PATCH adding a second owner to a client-owned photo → 422."""
        fx = photos_fixture
        response = api_client.patch(
            f"{PHOTOS_URL}/{fx['p_client']['id']}",
            json={"service_id": fx["s2"]["id"]},
        )
        assert response.status_code == 422
        assert "at most one owner" in str(response.json()["detail"])

    def test_patch_nulling_ok(self, api_client, photos_fixture) -> None:
        """PATCH {client_id: null} on a client-owned photo → 200, owner-less."""
        fx = photos_fixture
        response = api_client.patch(
            f"{PHOTOS_URL}/{fx['p_client']['id']}",
            json={"client_id": None},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["client_id"] is None
        assert body["service_id"] is None
        assert body["activity_id"] is None
        assert body["location_id"] is None

    def test_zero_owner_and_location_only_ok(self, api_client, create_location) -> None:
        """POST without owners → 201; POST location-only → 201."""
        r = api_client.post(PHOTOS_URL, json={"filename": "no_owner.jpg"})
        assert r.status_code == 201, r.text
        assert r.json()["client_id"] is None
        assert r.json()["location_id"] is None

        loc = create_location()
        r = api_client.post(PHOTOS_URL, json={
            "filename": "loc_only.jpg", "location_id": loc["id"],
        })
        assert r.status_code == 201, r.text
        assert r.json()["location_id"] == loc["id"]


class TestPhotosCRUD:
    """Full CRUD tests for photo endpoints."""

    def test_list_photos_empty(self, api_client) -> None:
        """GET /api/v1/photos returns an empty envelope when no photos exist."""
        response = api_client.get(PHOTOS_URL)
        assert response.status_code == 200
        assert response.json()["items"] == []
        assert response.json()["total"] == 0

    def test_create_photo(self, api_client) -> None:
        """POST /api/v1/photos creates a new photo."""
        response = api_client.post(PHOTOS_URL, json={
            "filename": "test-photo.jpg",
            "is_public": True,
        })
        assert response.status_code == 201
        data = response.json()
        assert data["filename"] == "test-photo.jpg"
        assert data["is_public"] is True
        assert "id" in data

    def test_get_photo(self, api_client) -> None:
        """GET /api/v1/photos/{id} returns a single photo."""
        create = api_client.post(PHOTOS_URL, json={"filename": "get-me.jpg"})
        photo_id = create.json()["id"]
        response = api_client.get(f"{PHOTOS_URL}/{photo_id}")
        assert response.status_code == 200
        assert response.json()["filename"] == "get-me.jpg"

    def test_get_photo_not_found(self, api_client) -> None:
        """GET /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.get(f"{PHOTOS_URL}/nonexistent-id")
        assert response.status_code == 404

    def test_update_photo(self, api_client) -> None:
        """PUT /api/v1/photos/{id} updates a photo."""
        create = api_client.post(PHOTOS_URL, json={"filename": "old.jpg"})
        photo_id = create.json()["id"]
        response = api_client.put(f"{PHOTOS_URL}/{photo_id}", json={
            "filename": "new.jpg",
            "is_public": True,
        })
        assert response.status_code == 200
        assert response.json()["filename"] == "new.jpg"
        assert response.json()["is_public"] is True

    def test_update_photo_not_found(self, api_client) -> None:
        """PUT /api/v1/photos/{id} returns 404 for non-existent photo
        (complete payload — PUT is full-replace since Task 2)."""
        response = api_client.put(f"{PHOTOS_URL}/nonexistent-id", json={
            "filename": "new.jpg",
            "is_public": False,
        })
        assert response.status_code == 404

    def test_delete_photo(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} hard-deletes a photo."""
        create = api_client.post(PHOTOS_URL, json={"filename": "delete-me.jpg"})
        photo_id = create.json()["id"]
        response = api_client.delete(f"{PHOTOS_URL}/{photo_id}")
        assert response.status_code == 204

    def test_delete_photo_not_found(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.delete(f"{PHOTOS_URL}/nonexistent-id")
        assert response.status_code == 404

    def test_deleted_photo_not_in_list(self, api_client) -> None:
        """Deleted photo no longer appears in GET /api/v1/photos."""
        create = api_client.post(PHOTOS_URL, json={"filename": "will-delete.jpg"})
        photo_id = create.json()["id"]
        api_client.delete(f"{PHOTOS_URL}/{photo_id}")
        response = api_client.get(PHOTOS_URL)
        filenames = [p["filename"] for p in response.json()["items"]]
        assert "will-delete.jpg" not in filenames

    def test_list_public_photos_unchanged(self, api_client) -> None:
        """GET /api/v1/photos/web still returns only public photos."""
        api_client.post(PHOTOS_URL, json={"filename": "private.jpg", "is_public": False})
        api_client.post(PHOTOS_URL, json={"filename": "public.jpg", "is_public": True})
        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 200
        photos = response.json()
        assert all(p["is_public"] for p in photos)


class TestPhotoPatch:
    """Tests for PATCH /api/v1/photos/{id}."""

    def test_patch_photo_not_found_404(self, api_client) -> None:
        """PATCH nonexistent photo returns 404."""
        response = api_client.patch(f"{PHOTOS_URL}/nonexistent-id", json={"is_public": True})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "PHOTO_NOT_FOUND"

    def test_patch_photo_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-3"}).json()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        photo_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "photo-tag-3"

    def test_patch_photo_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve-photo"}).json()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={"is_public": False})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve-photo"

    def test_patch_photo_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove-photo"}).json()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []

    def test_patch_photo_client_id_to_null(self, api_client, create_client) -> None:
        """PATCH {"client_id": null} sets client_id to null (nullable field)."""
        client = create_client()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "linked.jpg",
            "client_id": client["id"],
            "is_public": True,
        })
        photo_id = create.json()["id"]
        assert create.json()["client_id"] == client["id"]

        response = api_client.patch(
            f"{PHOTOS_URL}/{photo_id}",
            json={"client_id": None},
        )
        assert response.status_code == 200
        assert response.json()["client_id"] is None

    def test_patch_photo_empty_body_noop(self, api_client, create_client, create_tag) -> None:
        """PATCH {} leaves all fields unchanged."""
        client = create_client()
        tag = create_tag()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "noop.jpg",
            "client_id": client["id"],
            "is_public": True,
            "tag_ids": [tag["id"]],
        })
        photo_id = create.json()["id"]
        original = create.json()

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={})
        assert response.status_code == 200
        patched = response.json()

        assert patched["filename"] == original["filename"]
        assert patched["is_public"] == original["is_public"]
        assert patched["client_id"] == original["client_id"]
        assert patched["service_id"] == original["service_id"]
        assert patched["activity_id"] == original["activity_id"]
        assert patched["location_id"] == original["location_id"]
        assert patched["tags"] == original["tags"]

    def test_patch_photo_null_filename_stripped(self, api_client) -> None:
        """PATCH {"filename": null} leaves filename unchanged (NOT NULL field, null silently stripped)."""
        create = api_client.post(PHOTOS_URL, json={
            "filename": "keep-me.jpg", "is_public": False,
        })
        photo_id = create.json()["id"]
        original_filename = create.json()["filename"]

        response = api_client.patch(
            f"{PHOTOS_URL}/{photo_id}",
            json={"filename": None},
        )
        assert response.status_code == 200
        assert response.json()["filename"] == original_filename


async def _insert_photo_direct(
    id: str,
    filename: str,
    is_public: bool = False,
    activity_id: str | None = None,
) -> None:
    """Insert a Photo directly into the database."""
    from src.db import db_manager
    from src.models.photo import Photo

    async with db_manager.async_session() as session:
        photo = Photo(
            id=id,
            filename=filename,
            is_public=is_public,
            activity_id=activity_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(photo)
        await session.commit()
