"""Tests for the Specialties dictionary API (GH #599 Task 1).

Mirror of the positions suite: plain dictionary CRUD — paginated list
(fixed ``title ASC, id ASC``, NO ``sort_by``), bare ``/all``, POST /
PATCH / DELETE with the #324 family fork (форма → probe → dry_run/commit).

Specialty-specific rules (docs/domain-rules/specialties.md):

* title normalization on write — trim, internal-whitespace collapse,
  NFC; empty/whitespace-only → 422;
* case-insensitive uniqueness via the functional unique index on
  ``lower(title)``: collision → 409 ``SPECIALTY_TITLE_TAKEN`` — the
  authoritative path is catching the ``IntegrityError`` of the index
  (TOCTOU-proof); the SELECT precheck is only the UX-fast path (pinned
  here by monkeypatching it away so the INSERT hits the index);
* rename to the row's OWN case-variant → success (own row never
  conflicts with the index);
* guards — named mirror of the positional route:
  ``specialties:read`` / ``specialties:write`` + ``verify_fetch_metadata``;
  the master role holds neither token → 403.

Delete-family dependency semantics (Task 2, domain rules Delete
semantics): ``services`` is a VISIBLE BLOCKING dep
(``allowed_actions: []``) — the counter covers ALL services incl.
archived rows (the FK RESTRICT preview; the links are arranged at the
DB level, the raw-SQL join pattern); ``staff_specialties`` is
AUTO-cascade (the materials pattern: commit ``{"resolutions": {}}``
unlinks staff cards, which survive).
"""

import uuid as _uuid

import pytest

from src.auth.passwords import hash_password
from src.errors import ErrorCode
from src.services.specialty import get_specialty_service
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

SPECIALTIES_URL = "/api/v1/specialties"
MASTER_PASSWORD = "master-pass-1"


def _make_specialty(api_client, title: str = "Живопись") -> dict:
    resp = api_client.post(SPECIALTIES_URL, json={"title": title})
    assert resp.status_code == 201, f"create specialty failed: {resp.text}"
    return resp.json()


@pytest.fixture
def master_client(api_client, login_as):
    """A client logged in as a master-role user (fresh row per test).

    The master role carries no ``specialties:*`` tokens (dictionary is
    admin-only, like positions/materials) — the 403 guard subject.
    """
    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    insert_user(phone, hash_password(MASTER_PASSWORD), role="master")
    client = login_as(phone, MASTER_PASSWORD)
    yield client
    client.cookies.clear()


# ─── Normalization (write path) ────────────────────────────────────────────────


class TestSpecialtyTitleNormalization:
    def test_trim_edges(self, api_client) -> None:
        resp = api_client.post(SPECIALTIES_URL, json={"title": "  Живопись  "})
        assert resp.status_code == 201, resp.text
        assert resp.json()["title"] == "Живопись"

    def test_collapse_internal_whitespace(self, api_client) -> None:
        resp = api_client.post(SPECIALTIES_URL, json={"title": "Живопись   и\tкерамика"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["title"] == "Живопись и керамика"

    def test_nfc_composition(self, api_client) -> None:
        """Decomposed «Й» (U+0418 + U+0306 breve) is stored composed (U+0419)."""
        resp = api_client.post(SPECIALTIES_URL, json={"title": "\u0418\u0306ога"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["title"] == "\u0419ога"

    @pytest.mark.parametrize("title", ["", "   ", "\t\n "])
    def test_blank_title_422(self, api_client, title: str) -> None:
        resp = api_client.post(SPECIALTIES_URL, json={"title": title})
        assert resp.status_code == 422, resp.text

    def test_over_max_length_422(self, api_client) -> None:
        resp = api_client.post(SPECIALTIES_URL, json={"title": "А" * 101})
        assert resp.status_code == 422, resp.text

    def test_patch_normalizes_too(self, api_client) -> None:
        row = _make_specialty(api_client, "Керамика")
        resp = api_client.patch(
            f"{SPECIALTIES_URL}/{row['id']}", json={"title": "  Керамика   на   гончарном  "}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Керамика на гончарном"

    def test_unknown_field_rejected(self, api_client) -> None:
        resp = api_client.post(SPECIALTIES_URL, json={"title": "Лепка", "is_system": True})
        assert resp.status_code == 422, resp.text


# ─── Case-insensitive uniqueness → 409 SPECIALTY_TITLE_TAKEN ───────────────────


class TestSpecialtyTitleTaken:
    def test_case_variant_collision_precheck_409(self, api_client) -> None:
        _make_specialty(api_client, "Живопись")
        resp = api_client.post(SPECIALTIES_URL, json={"title": "ЖИВОПИСЬ"})
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SPECIALTY_TITLE_TAKEN.value

    def test_integrity_error_path_409(self, api_client, monkeypatch) -> None:
        """TOCTOU race: the precheck is disabled, the INSERT itself must
        hit the functional unique index and still map to 409 (the
        IntegrityError catch is the authoritative defense, spec §4.2)."""
        _make_specialty(api_client, "Живопись")

        async def _noop_precheck(_session, _title, _exclude_id=None) -> None:
            return None

        service = get_specialty_service()
        monkeypatch.setattr(service, "_ensure_title_free", _noop_precheck)

        resp = api_client.post(SPECIALTIES_URL, json={"title": "живопись"})
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SPECIALTY_TITLE_TAKEN.value

    def test_rename_to_own_case_variant_ok(self, api_client) -> None:
        row = _make_specialty(api_client, "Живопись")
        resp = api_client.patch(f"{SPECIALTIES_URL}/{row['id']}", json={"title": "живопись"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "живопись"

    def test_rename_to_foreign_taken_409(self, api_client) -> None:
        _make_specialty(api_client, "Живопись")
        other = _make_specialty(api_client, "Керамика")
        resp = api_client.patch(f"{SPECIALTIES_URL}/{other['id']}", json={"title": "ЖИВОПИСЬ"})
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SPECIALTY_TITLE_TAKEN.value

    def test_patch_title_null_is_stripped(self, api_client) -> None:
        """title is NOT NULL — a ``null`` title on PATCH is silently
        stripped (generic PATCH contract), not a constraint crash."""
        row = _make_specialty(api_client, "Мозаика")
        resp = api_client.patch(f"{SPECIALTIES_URL}/{row['id']}", json={"title": None})
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Мозаика"


# ─── List / all — fixed order, no sort_by ──────────────────────────────────────


class TestSpecialtyList:
    def test_paginated_envelope_fixed_title_order(self, api_client) -> None:
        _make_specialty(api_client, "Керамика")
        _make_specialty(api_client, "Живопись")
        _make_specialty(api_client, "Аэрография")
        resp = api_client.get(SPECIALTIES_URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"items", "total", "page", "per_page"}
        assert body["total"] == 3
        assert [i["title"] for i in body["items"]] == [
            "Аэрография",
            "Живопись",
            "Керамика",
        ]

    def test_pagination_params_respected(self, api_client) -> None:
        for title in ("Бета", "Альфа", "Гамма"):
            _make_specialty(api_client, title)
        resp = api_client.get(SPECIALTIES_URL, params={"page": 2, "per_page": 2})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 3
        assert [i["title"] for i in body["items"]] == ["Гамма"]

    def test_all_bare_array(self, api_client) -> None:
        _make_specialty(api_client, "Бета")
        _make_specialty(api_client, "Альфа")
        resp = api_client.get(f"{SPECIALTIES_URL}/all")
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert isinstance(items, list)
        assert [i["title"] for i in items] == ["Альфа", "Бета"]

    def test_view_shape(self, api_client) -> None:
        row = _make_specialty(api_client, "Живопись")
        assert set(row) == {"id", "title", "created_at", "updated_at"}

    def test_no_sort_by_in_openapi(self, app) -> None:
        """The list carries NO ``sort_by`` — the order is fixed by contract
        (domain rules List contract); the parameter must not appear in
        the published OpenAPI query params of the paginated list."""
        params = app.openapi()["paths"][SPECIALTIES_URL]["get"]["parameters"]
        names = {p["name"] for p in params if p["in"] == "query"}
        assert "sort_by" not in names
        assert "id" in names  # the PaginationParams brick (#232)

    def test_patch_unknown_id_404(self, api_client) -> None:
        resp = api_client.patch(
            f"{SPECIALTIES_URL}/00000000-0000-0000-0000-000000000000",
            json={"title": "Нет"},
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SPECIALTY_NOT_FOUND.value


# ─── Guards (named mirror of the positional route) ─────────────────────────────


class TestSpecialtyGuards:
    def test_master_read_write_403(self, master_client) -> None:
        resp = master_client.get(SPECIALTIES_URL)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

        resp = master_client.post(SPECIALTIES_URL, json={"title": "Запрещено"})
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_FORBIDDEN.value

    def test_master_patch_delete_403(self, master_client, api_client) -> None:
        row = _make_specialty(api_client, "Живопись")
        for method, kwargs in (
            ("PATCH", {"json": {"title": "Нет"}}),
            ("DELETE", {"params": {"dry_run": "true"}}),
        ):
            resp = master_client.request(method, f"{SPECIALTIES_URL}/{row['id']}", **kwargs)
            assert resp.status_code == 403, f"{method}: {resp.text}"

    def test_master_all_403(self, master_client) -> None:
        resp = master_client.get(f"{SPECIALTIES_URL}/all")
        assert resp.status_code == 403, resp.text

    def test_admin_allowed(self, api_client) -> None:
        """Sanity: the fixture admin (``*``) passes both guards."""
        resp = api_client.get(SPECIALTIES_URL)
        assert resp.status_code == 200, resp.text


# ─── Delete family — leaf contract (Task 1 scope) ──────────────────────────────


class TestSpecialtyDeleteLeaf:
    def test_dry_run_204_row_alive(self, api_client) -> None:
        row = _make_specialty(api_client, "Листовая")
        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'")

    def test_commit_expected_empty_204_row_gone(self, api_client) -> None:
        row = _make_specialty(api_client, "Листовая")
        resp = api_client.request("DELETE", f"{SPECIALTIES_URL}/{row['id']}", json={"expected": {}})
        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'") == []

    def test_bare_delete_422(self, api_client) -> None:
        row = _make_specialty(api_client, "Листовая")
        resp = api_client.delete(f"{SPECIALTIES_URL}/{row['id']}")
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'")

    def test_delete_unknown_id_404(self, api_client) -> None:
        resp = api_client.request(
            "DELETE",
            f"{SPECIALTIES_URL}/00000000-0000-0000-0000-000000000000",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.SPECIALTY_NOT_FOUND.value

    def test_dry_run_with_body_422(self, api_client) -> None:
        row = _make_specialty(api_client, "Листовая")
        resp = api_client.request(
            "DELETE",
            f"{SPECIALTIES_URL}/{row['id']}",
            params={"dry_run": "true"},
            json={"resolutions": {}, "expected": {}},
        )
        assert resp.status_code == 422, resp.text


# ─── Delete family — dependencies (Task 2) ─────────────────────────────────────


def _link_service(specialty_id: str, *, is_active: bool = True) -> str:
    """Direct ``services`` row linked via ``specialty_id`` (raw SQL — the
    tags/positions-suite raw-SQL join pattern; since R2 the legacy
    ``specialty`` text column is dropped and the link is NOT NULL, so the
    INSERT carries it in one statement). Returns the service id."""
    sid = f"svc-{_uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT INTO services (id, title, description, image_url, specialty_id, "
        "min_age, max_age, duration, record_info, is_active, created_at, updated_at) "
        "VALUES (:id, 'Мастер-класс живописи', '', '', :specialty_id, 5, NULL, 90, '', "
        ":is_active, datetime('now'), datetime('now'))",
        {"id": sid, "specialty_id": specialty_id, "is_active": 1 if is_active else 0},
    )
    return sid


def _link_staff(specialty_id: str, first_name: str = "Иван") -> str:
    """Direct staff row + ``staff_specialties`` link (the positions-suite
    raw-SQL join pattern). Returns the staff id."""
    staff_id = f"staff-{_uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        "created_at, updated_at) VALUES (:id, :first_name, 'Мастеров', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id, "first_name": first_name},
    )
    query_db_params(
        "INSERT INTO staff_specialties (staff_id, specialty_id) VALUES (:staff_id, :specialty_id)",
        {"staff_id": staff_id, "specialty_id": specialty_id},
    )
    return staff_id


class TestSpecialtyDeleteBlockedByServices:
    """``services`` — the VISIBLE BLOCKING node: occupied by ANY service
    (incl. archived — the counter is the FK RESTRICT preview over all
    rows) → 409 ``has_dependencies`` with the «Услуга» node; no
    auto-resolution exists."""

    def test_dry_run_active_service_409_services_node(self, api_client) -> None:
        row = _make_specialty(api_client, "Живопись")
        svc = _link_service(row["id"], is_active=True)

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        assert body["dependencies"] == [
            {
                "entity": "services",
                "relation": "Услуга",
                "count": 1,
                "allowed_actions": [],
                "auto": False,
                "message": "Переназначьте услуги другому направлению или удалите их",
            }
        ]
        # Preview only — the specialty and the link are untouched.
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'")
        assert query_db(f"SELECT * FROM services WHERE id='{svc}' AND specialty_id='{row['id']}'")

    def test_dry_run_archived_service_only_409(self, api_client) -> None:
        """Archived rows count too: a service may not live without a
        direction, so the RESTRICT preview covers ALL services."""
        row = _make_specialty(api_client, "Живопись")
        _link_service(row["id"], is_active=False)

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        assert body["dependencies"][0]["entity"] == "services"
        assert body["dependencies"][0]["count"] == 1

    def test_dry_run_counter_includes_archived(self, api_client) -> None:
        """1 active + 2 archived → the node counts 3 (ALL services)."""
        row = _make_specialty(api_client, "Живопись")
        _link_service(row["id"], is_active=True)
        _link_service(row["id"], is_active=False)
        _link_service(row["id"], is_active=False)

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409, resp.text
        services_nodes = [d for d in resp.json()["dependencies"] if d["entity"] == "services"]
        assert len(services_nodes) == 1
        assert services_nodes[0]["count"] == 3

    def test_commit_busy_service_fail_closed_409_stale(self, api_client) -> None:
        """A service the caller never confirmed (empty ``expected``)
        blocks the commit: 409 ``stale_dependencies`` BEFORE the FK
        RESTRICT could turn the hard delete into an IntegrityError (the
        (Service, "activities") race-gate mirror)."""
        row = _make_specialty(api_client, "Живопись")
        svc = _link_service(row["id"], is_active=True)

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", json={"resolutions": {}, "expected": {}}
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'")
        assert query_db(f"SELECT * FROM services WHERE id='{svc}' AND specialty_id='{row['id']}'")


class TestSpecialtyDeleteStaffAutoCascade:
    """``staff_specialties`` — AUTO-cascade (the materials pattern): the
    preview shows the node, commit ``{"resolutions": {}}`` unlinks the
    staff cards (which survive) and deletes the dictionary row."""

    def test_dry_run_staff_links_preview_tree(self, api_client) -> None:
        row = _make_specialty(api_client, "Керамика")
        _link_staff(row["id"], "Ольга")
        _link_staff(row["id"], "Пётр")

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        assert body["dependencies"] == [
            {
                "entity": "staff_specialties",
                "relation": "Сотрудник",
                "count": 2,
                "allowed_actions": ["cascade"],
                "auto": True,
            }
        ]
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'")

    def test_commit_resolutions_empty_unlinks_and_deletes(self, api_client) -> None:
        """DoD state «only staff»: commit ``{"resolutions": {}}`` → the
        join rows are stripped (both holders unlinked, CARDS survive),
        the specialty row is gone → 204."""
        row = _make_specialty(api_client, "Керамика")
        holder1 = _link_staff(row["id"], "Ольга")
        holder2 = _link_staff(row["id"], "Пётр")

        resp = api_client.request(
            "DELETE",
            f"{SPECIALTIES_URL}/{row['id']}",
            json={
                "resolutions": {},
                "expected": {"staff_specialties": [holder1, holder2]},
            },
        )
        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'") == []
        assert query_db(f"SELECT * FROM staff_specialties WHERE specialty_id='{row['id']}'") == []
        for sid in (holder1, holder2):
            assert query_db(f"SELECT * FROM staff WHERE id='{sid}'")

    def test_commit_expected_empty_ok_auto_never_verified(self, api_client) -> None:
        """Auto deps never participate in the ``expected`` check — the
        empty-snapshot commit (a leaf-shaped body) still executes."""
        row = _make_specialty(api_client, "Керамика")
        holder = _link_staff(row["id"], "Мария")

        resp = api_client.request(
            "DELETE",
            f"{SPECIALTIES_URL}/{row['id']}",
            json={"resolutions": {}, "expected": {}},
        )
        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM specialties WHERE id='{row['id']}'") == []
        assert query_db(f"SELECT * FROM staff WHERE id='{holder}'")

    def test_dry_run_mixed_tree_blocked_node_first(self, api_client) -> None:
        """Both deps present → both nodes, the BLOCKING one first (the
        Staff activities-first convention: what stops the delete leads
        the tree)."""
        row = _make_specialty(api_client, "Живопись")
        _link_service(row["id"], is_active=True)
        _link_staff(row["id"], "Ольга")

        resp = api_client.request(
            "DELETE", f"{SPECIALTIES_URL}/{row['id']}", params={"dry_run": "true"}
        )
        assert resp.status_code == 409, resp.text
        deps = resp.json()["dependencies"]
        assert [d["entity"] for d in deps] == ["services", "staff_specialties"]
