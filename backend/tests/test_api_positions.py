"""Tests for the Positions API delete contract (GH #324 Task 5).

Position = a DEPENDENT delete-family subject (spec §4):
``staff_positions`` (cascade, NON-auto — stripping the position from
its holders IS the visible main effect). Scope model: NONE by design
(studio dictionary) — access = the ``positions:write`` role; the tree
is visible to role holders (§4 spec decision).

This file carries the §10 FULL parametrized contract
(:class:`TestPositionDeleteFullForm`) plus the positions entity
extras:

* the ``is_system`` guard — 422 ``POSITION_IS_SYSTEM`` BEFORE the
  dry_run/commit fork in BOTH branches («встроенная не удаляется»,
  §4.3);
* the executor depth: holders LOSE the position (join rows stripped)
  while the staff CARDS survive (§5) — pinned for MULTIPLE holders.

Smoke level (dry_run clean 204 / unknown-id 404 / plain stale 409 /
commit-clean) lives in ``test_api_delete_family_routes.py``; the four
FORM 422s — in ``test_errors.py``.
"""

import uuid as _uuid

import pytest

from tests.conftest import query_db, query_db_params
from tests.delete_family_full_contract import (
    DependentDeleteContractMixin,
    DependentSubject,
)

pytestmark = pytest.mark.api

POSITIONS_URL = "/api/v1/positions"


def _make_position(api_client, title: str = "СММ") -> dict:
    resp = api_client.post(POSITIONS_URL, json={"title": title})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_staff(position_id: str, first_name: str = "Иван") -> str:
    """Direct staff row + staff_positions link (no staff-assignment API
    — the tags-suite raw-SQL join pattern). Returns the staff id."""
    staff_id = f"staff-{_uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT INTO staff (id, first_name, last_name, "
        "sort_order, is_active, created_at, updated_at) "
        "VALUES (:id, :first_name, 'Должностной', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id, "first_name": first_name},
    )
    query_db_params(
        "INSERT INTO staff_positions (staff_id, position_id) "
        "VALUES (:staff_id, :position_id)",
        {"staff_id": staff_id, "position_id": position_id},
    )
    return staff_id


@pytest.fixture
def busy_position(api_client) -> DependentSubject:
    """A position held by TWO staff members — the busy dependent world
    (§3: ``staff_positions`` cascade NON-auto; item ids are the
    ``staff_id`` values within the position's scope — the same id the
    ``expected`` commit verifies)."""
    position = _make_position(api_client, "Методист")
    holder1 = _make_staff(position["id"], "Ольга")
    holder2 = _make_staff(position["id"], "Пётр")
    holders = [holder1, holder2]

    def alive() -> None:
        assert api_client.get(f"{POSITIONS_URL}/{position['id']}").status_code == 200
        for sid in holders:
            assert query_db(f"SELECT * FROM staff WHERE id='{sid}'")
            assert query_db(
                "SELECT * FROM staff_positions "
                f"WHERE staff_id='{sid}' AND position_id='{position['id']}'"
            )

    def subject_gone() -> None:
        assert api_client.get(f"{POSITIONS_URL}/{position['id']}").status_code == 404
        assert (
            query_db(f"SELECT * FROM staff_positions WHERE position_id='{position['id']}'")
            == []
        )

    def executor_effects() -> None:
        # Position gone; BOTH holders lose it (join stripped) while
        # their staff CARDS survive (§5 — only the link dies).
        subject_gone()
        for sid in holders:
            assert query_db(f"SELECT * FROM staff WHERE id='{sid}'")

    def remove_one_dep() -> None:
        # One holder link disappears mid-window (unassigned directly).
        query_db_params(
            "DELETE FROM staff_positions WHERE staff_id=:s AND position_id=:p",
            {"s": holder2, "p": position["id"]},
        )

    return DependentSubject(
        url=f"{POSITIONS_URL}/{position['id']}",
        unknown_url=f"{POSITIONS_URL}/00000000-0000-0000-0000-000000000000",
        unknown_code="POSITION_NOT_FOUND",
        tree={
            "staff_positions": {
                "relation": "Сотрудник",
                "count": 2,
                "auto": False,
                "items": {(holder1, "Ольга Должностной"), (holder2, "Пётр Должностной")},
            },
        },
        resolutions={"staff_positions": "cascade"},
        expected={"staff_positions": holders},
        alive=alive,
        subject_gone=subject_gone,
        executor_effects=executor_effects,
        remove_one_dep=remove_one_dep,
    )


class TestPositionDeleteFullForm(DependentDeleteContractMixin):
    """The §10 FULL parametrized contract on the position subject."""

    @pytest.fixture
    def busy_subject(self, busy_position: DependentSubject) -> DependentSubject:
        """Adapter: the mixin's world spec ← the position fixture."""
        return busy_position


class TestPositionSystemGuard:
    """§4.3: the subject guard — a probed ``is_system`` row → 422
    ``POSITION_IS_SYSTEM`` BEFORE the dry_run/commit fork (both
    branches); «встроенная не удаляется» with the check moved from
    execution time up to the guard (the smoke file pins the same shape
    on one row — this class extends to the form-matrix level: even the
    REJECTED body shapes never reach a system row's tree, and the
    executor never fires)."""

    @pytest.fixture
    def system_position(self, api_client) -> dict:
        """A built-in position row (direct insert — POST cannot create
        one: ``is_system`` is not client-writable)."""
        row_id = "master"
        query_db_params(
            "INSERT OR IGNORE INTO positions (id, title, is_system, "
            "created_at, updated_at) "
            "VALUES (:id, 'Мастер', 1, datetime('now'), datetime('now'))",
            {"id": row_id},
        )
        return {"id": row_id}

    def test_system_422_in_both_branches_row_alive(
        self, api_client, system_position,
    ) -> None:
        """dry_run AND commit → 422 POSITION_IS_SYSTEM; the row stays."""
        url = f"{POSITIONS_URL}/{system_position['id']}"
        for resp in (
            api_client.request("DELETE", url, params={"dry_run": "true"}),
            api_client.request("DELETE", url, json={"expected": {}}),
        ):
            assert resp.status_code == 422, resp.text
            assert resp.json()["detail"]["code"] == "POSITION_IS_SYSTEM"
        assert api_client.get(url).status_code == 200

    def test_system_guard_precedes_tree_even_with_resolutions(
        self, api_client, system_position,
    ) -> None:
        """A BUSY system position (holder linked directly) still gets
        422 POSITION_IS_SYSTEM — never the 409 tree, never the
        executor: the guard runs before any dependency work."""
        query_db_params(
            "INSERT INTO staff_positions (staff_id, position_id) "
            "VALUES ('staff-sys-guard', :p)",
            {"p": system_position["id"]},
        )

        resp = api_client.request(
            "DELETE", f"{POSITIONS_URL}/{system_position['id']}",
            json={
                "resolutions": {"staff_positions": "cascade"},
                "expected": {"staff_positions": ["staff-sys-guard"]},
            },
        )

        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == "POSITION_IS_SYSTEM"
        # Neither the position row nor the link was touched.
        assert api_client.get(f"{POSITIONS_URL}/{system_position['id']}").status_code == 200
        assert query_db(
            "SELECT * FROM staff_positions WHERE position_id="
            f"'{system_position['id']}'"
        )

    def test_system_position_gone_from_api_create_surface(
        self, api_client,
    ) -> None:
        """The dictionary's WRITE surface cannot produce a system row:
        POST without ``is_system`` → 201 with the field defaulting
        False (the guard's input invariant)."""
        created = _make_position(api_client, "Не системная")
        assert api_client.get(f"{POSITIONS_URL}/{created['id']}").json()["is_system"] is False
