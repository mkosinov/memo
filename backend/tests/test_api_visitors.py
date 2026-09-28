"""Tests for the Visitors CRUD API endpoints."""

import pytest

from tests.conftest import query_db, query_db_params
from tests.delete_family_full_contract import (
    DependentDeleteContractMixin,
    DependentSubject,
)

pytestmark = pytest.mark.api

CLIENT_PAYLOAD = {
    "name": "Jane Doe",
    "phone": "+79991112233",
    "email": "jane@example.com",
    "channel": "telegram",
}


def _create_client(api_client) -> str:
    """Helper: create a client and return its ID."""
    resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


class TestVisitorsCrud:
    """Visitor-create extras for /api/visitors (CRUD covered by contract)."""

    def test_create_visitor_with_null_age(self, api_client) -> None:
        """POST /api/visitors accepts null age."""
        client_id = _create_client(api_client)

        visitor_payload = {"client_id": client_id, "name": "Unknown Age", "age": None}
        response = api_client.post("/api/v1/visitors", json=visitor_payload)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Unknown Age"
        assert body["age"] is None


class TestVisitorPatch:
    """Tests for PATCH /api/v1/visitors/{id}."""

    def test_patch_visitor_client_id_immutable(self, api_client) -> None:
        """PATCH cannot reassign a visitor to a different client — client_id is locked in at creation."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Alice", "age": 28,
        })
        visitor_id = create.json()["id"]

        # Attempt to patch client_id to a different value
        other_client_id = api_client.post("/api/v1/clients", json={
            "name": "Other", "phone": "+79998887766",
        }).json()["id"]

        response = api_client.patch(
            f"/api/v1/visitors/{visitor_id}",
            json={"client_id": other_client_id},
        )
        # Record actual behavior — do NOT change it
        if response.status_code == 200:
            # Silent ignore: client_id remains unchanged
            assert response.json()["client_id"] == client_id
        else:
            # Rejected: 422 validation error
            assert response.status_code == 422


class TestVisitorList:
    """Tests for GET /api/v1/visitors — paginated bare list (#183)."""

    def test_scoped_client_visitors_route_unchanged(self, api_client) -> None:
        """Regression guard: GET /api/v1/clients/{id}/visitors stays a bare array
        and returns every visitor for that one client (multi-row form).

        Spec D10 deliberately deviates from the generic envelope contract here:
        the scoped per-client visitors route is a bare list, NOT ``{items, ...}``.
        """
        client_id = _create_client(api_client)
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client_id, "name": "Alice", "age": 28},
        )
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client_id, "name": "Bob", "age": 35},
        )

        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        body = response.json()
        # Bare array — NOT the {items, total, ...} envelope (spec D10)
        assert "items" not in body
        assert isinstance(body, list)
        assert len(body) == 2
        names = {v["name"] for v in body}
        assert "Alice" in names
        assert "Bob" in names


# ─── GH #324 Task 5: the FULL-form contract (visitor = dependent subject) ─────


def _make_visitor(api_client, client_id: str, name: str) -> dict:
    resp = api_client.post(
        "/api/v1/visitors", json={"client_id": client_id, "name": name, "age": 30}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_tag(api_client, title: str) -> dict:
    resp = api_client.post("/api/v1/tags", json={"title": title})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _link_visitor_tag(visitor_id: str, tag_id: str) -> None:
    """Join rows have no API — raw SQL insert (the tags-suite pattern)."""
    query_db_params(
        "INSERT INTO visitor_tags (visitor_id, tag_id) VALUES (:v, :t)",
        {"v": visitor_id, "t": tag_id},
    )


@pytest.fixture
def busy_visitor(api_client, create_client, create_activity, create_record) -> DependentSubject:
    """A visitor with TWO visits on two records + an own tag — the busy
    dependent world (§3: ``visits`` cascade NON-auto — the visits die
    with the visitor, user decision 21.09; ``visitor_tags`` AUTO — the
    own tag links die too, but are excluded from resolutions and the
    user choice; item ids: ``visit.id`` / the link's ``tag_id``)."""
    owner = create_client()
    visitor = _make_visitor(api_client, owner["id"], "С двумя визитами")
    tag = _make_tag(api_client, "визитовый-тег")
    _link_visitor_tag(visitor["id"], tag["id"])

    def _record_with_visit(price: int) -> dict:
        return create_record(visits=[{
            "visitor_id": visitor["id"], "price": price, "status": "waiting",
        }])

    record1 = _record_with_visit(1000)
    record2 = _record_with_visit(2000)
    visit1, visit2 = record1["visits"][0], record2["visits"][0]
    assert visit1["visitor_id"] == visitor["id"]
    assert visit2["visitor_id"] == visitor["id"]

    def alive() -> None:
        assert api_client.get(f"/api/v1/visitors/{visitor['id']}").status_code == 200
        for vid in (visit1["id"], visit2["id"]):
            assert query_db(f"SELECT * FROM visits WHERE id='{vid}'")
        assert query_db(
            f"SELECT * FROM visitor_tags WHERE visitor_id='{visitor['id']}'"
        )

    def subject_gone() -> None:
        assert api_client.get(f"/api/v1/visitors/{visitor['id']}").status_code == 404
        assert query_db(f"SELECT * FROM visits WHERE visitor_id='{visitor['id']}'") == []
        assert (
            query_db(f"SELECT * FROM visitor_tags WHERE visitor_id='{visitor['id']}'")
            == []
        )

    def executor_effects() -> None:
        # Visitor gone, BOTH visits dead, the own-tag join stripped, the
        # tag dictionary row survives; BOTH parent records recomputed
        # (§5: the visits batch block — seats honest AND status honest).
        subject_gone()
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200
        for record in (record1, record2):
            updated = api_client.get(f"/api/v1/records/{record['id']}").json()
            assert updated["seats"] == 0, record["id"]
            assert updated["status"] == "waiting", record["id"]  # 0 visits → waiting

    def remove_one_dep() -> None:
        # One visit disappears mid-window (deleted directly in the DB);
        # its record was recomputed by nobody — the subset pass deletes
        # the remaining world and recomputes only what still exists.
        query_db_params(
            "DELETE FROM visits WHERE id=:v", {"v": visit2["id"]},
        )

    return DependentSubject(
        url=f"/api/v1/visitors/{visitor['id']}",
        unknown_url="/api/v1/visitors/00000000-0000-0000-0000-000000000000",
        unknown_code="VISITOR_NOT_FOUND",
        tree={
            "visits": {
                "relation": "Посещение",
                "count": 2,
                "auto": False,
                # Tariff-less visits degrade to «Без тарифа, {price}».
                "items": {
                    (visit1["id"], "Без тарифа, 1000"),
                    (visit2["id"], "Без тарифа, 2000"),
                },
            },
            "visitor_tags": {
                "relation": "Тег",
                "count": 1,
                "auto": True,  # the perspective rule: auto from the visitor's side
                "items": {(tag["id"], "визитовый-тег")},
            },
        },
        resolutions={"visits": "cascade"},  # auto dep needs no user choice
        expected={"visits": [visit1["id"], visit2["id"]], "visitor_tags": [tag["id"]]},
        alive=alive,
        subject_gone=subject_gone,
        executor_effects=executor_effects,
        remove_one_dep=remove_one_dep,
    )


class TestVisitorDeleteFullForm(DependentDeleteContractMixin):
    """The §10 FULL parametrized contract on the visitor subject — the
    cascade world of spec §3/§5: visits (non-auto, die with the
    visitor) + visitor_tags (auto). The smoke level is in
    ``test_api_delete_family_routes.py``; the recompute half is
    asserted in ``executor_effects`` (both records' seats AND status
    honest — the Task 2 batch block)."""

    @pytest.fixture
    def busy_subject(self, busy_visitor: DependentSubject) -> DependentSubject:
        """Adapter: the mixin's world spec ← the visitor fixture."""
        return busy_visitor


class TestVisitorDeleteScope404Commit:
    """§4.2 scope-404 of the guarded visitors route — the COMMIT branch
    half (the dry_run half is in the smoke file): a scoped master's
    view of an admin-owned visitor is the SAME 404 as missing, before
    any dependency work; the row and its world survive."""

    def test_commit_foreign_id_404_world_alive(
        self, api_client, create_client, create_record, make_master,
    ) -> None:
        owner = create_client()
        visitor = _make_visitor(api_client, owner["id"], "Чужой не пройдёт")
        record = create_record(visits=[{
            "visitor_id": visitor["id"], "price": 700, "status": "waiting",
        }])
        master = make_master()

        resp = master["client"].request(
            "DELETE", f"/api/v1/visitors/{visitor['id']}",
            json={"resolutions": {"visits": "cascade"}, "expected": {}},
        )

        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == "VISITOR_NOT_FOUND"
        # The visitor, its visit and the parent record all survive.
        assert api_client.get(f"/api/v1/visitors/{visitor['id']}").status_code == 200
        assert query_db(f"SELECT * FROM visits WHERE id='{record['visits'][0]['id']}'")
        assert api_client.get(f"/api/v1/records/{record['id']}").json()["seats"] == 1
