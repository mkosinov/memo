"""Tests for the Photos API endpoints (is_public list filter + admin CRUD + list contract)."""

import pytest

from tests.conftest import query_db, query_db_params
from tests.delete_family_full_contract import (
    DependentDeleteContractMixin,
    DependentSubject,
)

pytestmark = pytest.mark.api

PHOTOS_URL = "/api/v1/photos"

#: photo keys of the photos_fixture dict, in owner-slot order
FIXTURE_PHOTOS = (
    "p_client", "p_client2", "p_act", "p_svc", "p_loc", "p_tags", "p_tag1",
)


class TestPhotosWebRemoved:
    """GH #479 Изменение 4 — the public showcase route is gone.

    The gallery now rides the common list with ``?is_public=true`` (see
    the ``is_public_*`` filter-matrix cases in ``TestPhotosListContract``);
    ``/web`` itself must 404 (the request falls through to
    ``GET /photos/{photo_id}`` with ``photo_id="web"`` → the same 404 as
    any missing photo).
    """

    def test_web_route_gone_404(self, api_client) -> None:
        """GET /api/v1/photos/web → 404 (route removed, GH #479)."""
        response = api_client.get("/api/v1/photos/web")
        assert response.status_code == 404


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
        {"is_public": "banana"},  # GH #479: bool | None — non-bool → 422
    ])
    def test_photos_list_params_422(self, api_client, bad) -> None:
        """Invalid page/per_page/q/sort/is_public values return 422."""
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


class TestPhotosFilenameValidation:
    """GH #517 defense-in-depth: ``filename`` is sanitized on the way in —
    outer whitespace stripped, control characters rejected with 422
    (POST/PUT payload schemas; PATCH partial schema)."""

    def test_create_strips_outer_whitespace(self, api_client) -> None:
        """POST filename with outer spaces → 201, stored without them."""
        response = api_client.post(PHOTOS_URL, json={"filename": "  /images/a.jpg  "})
        assert response.status_code == 201
        assert response.json()["filename"] == "/images/a.jpg"

    @pytest.mark.parametrize("junk", [
        "a\x00b.jpg",  # NUL
        "a\x1fb.jpg",  # US
        "a\x7fb.jpg",  # DEL
        " \x00 ",      # control only
    ])
    def test_create_control_chars_422(self, api_client, junk) -> None:
        """POST with control characters in filename → 422."""
        response = api_client.post(PHOTOS_URL, json={"filename": junk})
        assert response.status_code == 422
        assert "control characters" in str(response.json()["detail"])

    def test_put_control_chars_422(self, api_client) -> None:
        """PUT with a control character in filename → 422."""
        create = api_client.post(PHOTOS_URL, json={"filename": "victim.jpg"})
        photo_id = create.json()["id"]

        response = api_client.put(f"{PHOTOS_URL}/{photo_id}", json={
            "filename": "x\x00y.jpg",
            "is_public": False,
        })
        assert response.status_code == 422

    def test_patch_control_chars_422(self, api_client) -> None:
        """PATCH with a control character in filename → 422 (partial schema too)."""
        create = api_client.post(PHOTOS_URL, json={"filename": "victim.jpg"})
        photo_id = create.json()["id"]

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={
            "filename": "x\x00y.jpg",
        })
        assert response.status_code == 422

    def test_patch_strips_outer_whitespace(self, api_client) -> None:
        """PATCH filename with outer spaces → 200, stored without them."""
        create = api_client.post(PHOTOS_URL, json={"filename": "victim.jpg"})
        photo_id = create.json()["id"]

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={
            "filename": "  /images/b.jpg  ",
        })
        assert response.status_code == 200
        assert response.json()["filename"] == "/images/b.jpg"


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
    l1 = create_location(title="Act Studio")
    l2 = create_location(title="Hall Venue")
    s1 = create_service(title="Wheel pottery")
    s2 = create_service(title="Oil painting")
    a1 = create_activity(service_id=s1["id"], location_id=l1["id"])
    t1 = create_tag(title="workshop")
    t2 = create_tag(title="kids")

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
        # GH #479 Изменение 4: is_public filter — the /web showcase
        # successor. "Not set" behaviour is the plain case above (no
        # filter applied); only p_client is public in the fixture.
        "is_public_true": (
            {"is_public": "true"},
            {fx["p_client"]["id"]},
            1,
        ),
        "is_public_false": (
            {"is_public": "false"},
            _all_ids(fx) - {fx["p_client"]["id"]},
            6,
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
        "is_public_true",
        "is_public_false",
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

    def test_photos_default_sort_created_at_desc_no_params(
        self, api_client, photos_fixture,
    ) -> None:
        """NO sort params in the query → created_at desc (newest first).

        GH #367 Task 4 flip guard: the photo table must stay newest-first.
        The photos are created sequentially, but created_at second
        granularity can collide — the fixture assigns DISTINCT descending
        timestamps directly, so any direction flip (asc default, or a
        resolver regression) breaks the strict-descending assertion.
        """
        # DISTINCT strictly-descending created_at: first fixture photo is
        # the newest, last one is the oldest.
        for pos, key in enumerate(FIXTURE_PHOTOS):
            query_db_params(
                "UPDATE photos SET created_at = :dt WHERE id = :id",
                {"dt": f"2026-03-01 12:00:{59 - pos:02d}", "id": photos_fixture[key]["id"]},
            )

        response = api_client.get(PHOTOS_URL, params={"per_page": 100})

        assert response.status_code == 200, response.text
        got_ids = [i["id"] for i in response.json()["items"]]
        assert got_ids == [photos_fixture[key]["id"] for key in FIXTURE_PHOTOS], (
            "no sort params must default to created_at desc (newest first)"
        )

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
        response = api_client.request(
            "DELETE", f"{PHOTOS_URL}/{photo_id}", json={"expected": {}}
        )
        assert response.status_code == 204

    def test_delete_photo_not_found(self, api_client) -> None:
        """DELETE /api/v1/photos/{id} returns 404 for non-existent photo."""
        response = api_client.request(
            "DELETE", f"{PHOTOS_URL}/nonexistent-id", json={"expected": {}}
        )
        assert response.status_code == 404

    def test_deleted_photo_not_in_list(self, api_client) -> None:
        """Deleted photo no longer appears in GET /api/v1/photos."""
        create = api_client.post(PHOTOS_URL, json={"filename": "will-delete.jpg"})
        photo_id = create.json()["id"]
        api_client.request(
            "DELETE", f"{PHOTOS_URL}/{photo_id}", json={"expected": {}}
        )
        response = api_client.get(PHOTOS_URL)
        filenames = [p["filename"] for p in response.json()["items"]]
        assert "will-delete.jpg" not in filenames


class TestPhotoPatch:
    """Tests for PATCH /api/v1/photos/{id}."""

    def test_patch_photo_not_found_404(self, api_client) -> None:
        """PATCH nonexistent photo returns 404."""
        response = api_client.patch(f"{PHOTOS_URL}/nonexistent-id", json={"is_public": True})
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "PHOTO_NOT_FOUND"

    def test_patch_photo_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"title": "photo-tag-1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"title": "photo-tag-2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"title": "photo-tag-3"}).json()

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
        assert tags[0]["title"] == "photo-tag-3"

    def test_patch_photo_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"title": "preserve-photo"}).json()

        create = api_client.post(PHOTOS_URL, json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"{PHOTOS_URL}/{photo_id}", json={"is_public": False})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["title"] == "preserve-photo"

    def test_patch_photo_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"title": "remove-photo"}).json()

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


# ─── GH #232 Task 2: ?id= set narrowing — photos view builder representative ───


class TestPhotosListIdFilter:
    """``GET /photos?id=X&id=Y`` — typed IN-narrowing in ``PhotoService.list``
    (GH #232 §3.1; representative of the photos view builder)."""

    def test_id_filter_returns_exactly_the_named_photos(self, api_client) -> None:
        p1 = api_client.post(PHOTOS_URL, json={"filename": "one.jpg"}).json()
        p2 = api_client.post(PHOTOS_URL, json={"filename": "two.jpg"}).json()
        api_client.post(PHOTOS_URL, json={"filename": "decoy.jpg"})

        resp = api_client.get(
            PHOTOS_URL, params=[("id", p1["id"]), ("id", p2["id"])]
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(p["id"] for p in body["items"]) == sorted(
            [p1["id"], p2["id"]]
        )
        assert body["total"] == 2


# ─── GH #324 Task 5: the FULL-form contract (photo = dependent subject) ───────


@pytest.fixture
def busy_photo(api_client, create_tag) -> DependentSubject:
    """A photo linked to TWO tags — the busy dependent world (§3: the
    photo's single dep is ``photo_tags`` — cascade, NON-auto; item ids
    are the ``tag_id`` values within the photo's scope, the #318
    convention). Built via API factories (photos POST takes ``tag_ids``)
    — the ``test_api_tags.py:178+`` factory pattern."""
    tag_keep = create_tag(title="фото-тег-1")
    tag_keep2 = create_tag(title="фото-тег-2")
    photo = api_client.post(PHOTOS_URL, json={
        "filename": "busy-full-form.jpg",
        "tag_ids": [tag_keep["id"], tag_keep2["id"]],
    }).json()

    tag_ids = [tag_keep["id"], tag_keep2["id"]]

    def alive() -> None:
        assert api_client.get(f"{PHOTOS_URL}/{photo['id']}").status_code == 200
        assert api_client.get(f"/api/v1/tags/{tag_keep['id']}").status_code == 200
        rows = query_db(
            f"SELECT COUNT(*) AS c FROM photo_tags WHERE photo_id='{photo['id']}'"
        )
        assert rows[0]["c"] == 2

    def subject_gone() -> None:
        assert api_client.get(f"{PHOTOS_URL}/{photo['id']}").status_code == 404
        assert (
            query_db(f"SELECT * FROM photo_tags WHERE photo_id='{photo['id']}'") == []
        )

    def executor_effects() -> None:
        # Photo gone, BOTH links stripped, BOTH tag dictionary rows
        # survive (§5: the unlink is the only effect).
        assert api_client.get(f"{PHOTOS_URL}/{photo['id']}").status_code == 404
        assert (
            query_db(f"SELECT * FROM photo_tags WHERE photo_id='{photo['id']}'") == []
        )
        for tid in tag_ids:
            assert api_client.get(f"/api/v1/tags/{tid}").status_code == 200

    def remove_one_dep() -> None:
        # A tag link disappears mid-window (unlinked directly in the DB).
        query_db_params(
            "DELETE FROM photo_tags WHERE photo_id=:p AND tag_id=:t",
            {"p": photo["id"], "t": tag_keep2["id"]},
        )

    return DependentSubject(
        url=f"{PHOTOS_URL}/{photo['id']}",
        unknown_url=f"{PHOTOS_URL}/00000000-0000-0000-0000-000000000000",
        unknown_code="PHOTO_NOT_FOUND",
        tree={
            "photo_tags": {
                "relation": "Тег",
                "count": 2,
                "auto": False,
                "items": {
                    (tag_keep["id"], "фото-тег-1"),
                    (tag_keep2["id"], "фото-тег-2"),
                },
            },
        },
        resolutions={"photo_tags": "cascade"},
        expected={"photo_tags": tag_ids},
        alive=alive,
        subject_gone=subject_gone,
        executor_effects=executor_effects,
        remove_one_dep=remove_one_dep,
    )


class TestPhotoDeleteFullForm(DependentDeleteContractMixin):
    """The §10 FULL parametrized contract on the photo subject. The
    smoke level (dry_run clean 204 / unknown+foreign 404 / the plain
    stale 409 / the scope probe on an owner-less row) is in
    ``test_api_delete_family_routes.py``; this is the full-form depth:
    form-422-with-world-untouched, the complete tree shape, subset
    semantics, resolutions validation, the stale-beats-invalid order
    pin, and the executor assertions."""

    @pytest.fixture
    def busy_subject(self, busy_photo: DependentSubject) -> DependentSubject:
        """Adapter: the mixin's world spec ← the photo fixture."""
        return busy_photo
