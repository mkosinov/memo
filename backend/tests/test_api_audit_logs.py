"""GH #344 Task 5 — read-only audit journal API (spec §6).

Two admin-only endpoints over the append-only ``audit_logs`` table:

* ``GET /api/v1/audit-logs`` — paginated journal, ``created_at DESC``,
  conjunctive filters (author / action / entity / entity_id / whole-day
  date range via the shared ``day_range`` canon);
* ``GET /api/v1/audit-logs/authors`` — distinct authors for the filter
  dropdown.

Journal rows are seeded directly via SQL (the writing side is covered by
the Task 2-4 suites); this file pins the READING contract only — access
(401 anonymous / 403 master), the paginated envelope, author label
resolution (users ⟕ staff: card name «Иванов Иван», phone fallback for
cardless accounts), ``user_role`` sourced from the JOURNAL ROW (not
live user data), every filter, pagination and sorting.
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from src.auth.passwords import hash_password
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

MASTER_PASSWORD = "master-pass-1"


# ─── Seed helpers (direct SQL — no repository/actor machinery) ─────────────────


def _staff_author(first: str, last: str, phone: str) -> dict:
    """A staff card + linked master user (label resolves to «Иванов Иван»)."""
    staff_id = f"staff-{uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        "created_at, updated_at) VALUES (:id, :first, :last, 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id, "first": first, "last": last},
    )
    return insert_user(phone, "x", role="master", master_id=staff_id)


def _cardless_author(phone: str, role: str = "admin") -> dict:
    """A user without a staff card (label falls back to the phone)."""
    return insert_user(phone, "x", role=role)


def _log(
    user_id: str,
    user_role: str,
    action: str,
    entity: str,
    entity_id: str | None,
    entity_label: str,
    created_at: str,
    changes: dict | None = None,
) -> str:
    """Insert one journal row; returns its id.

    ``created_at`` carries the microseconds suffix the SQLite DATETIME
    storage format uses, so lexical comparisons against ``day_range``
    bounds (always microsecond-precision) behave exactly like rows
    written through the ORM.
    """
    log_id = str(uuid.uuid4())
    query_db_params(
        "INSERT INTO audit_logs (id, user_id, user_role, action, entity, "
        "entity_id, entity_label, changes, created_at) VALUES "
        "(:id, :uid, :role, :action, :entity, :eid, :elabel, :changes, :created)",
        {
            "id": log_id,
            "uid": user_id,
            "role": user_role,
            "action": action,
            "entity": entity,
            "eid": entity_id,
            "elabel": entity_label,
            "changes": json.dumps(changes) if changes is not None else None,
            "created": created_at,
        },
    )
    return log_id


@pytest.fixture
def journal() -> dict:
    """Four journal rows by two authors, spread over three days.

    ``r2`` deliberately carries ``user_role='admin'`` while its live
    user is a master — the response must take the role from the JOURNAL
    ROW (snapshot at action time), not from live data. ``r2``/``r3`` sit
    on the exact day edges (00:00:00 / 23:59:59) to pin the whole-day
    ``day_range`` canon.
    """
    master = _staff_author("Иван", "Иванов", "+79991000001")
    admin = _cardless_author("+79991000002", role="admin")
    rows = {
        "r1": _log(
            master["id"], "master", "create", "locations", "loc-1", "Студия",
            "2026-01-01 10:00:00.000000", changes={"title": ["A", "B"]},
        ),
        "r2": _log(
            master["id"], "admin", "update", "services", "svc-1", "Гончарка",
            "2026-01-02 00:00:00.000000",
        ),
        "r3": _log(
            admin["id"], "admin", "delete", "locations", "loc-1", "Студия",
            "2026-01-02 23:59:59.000000",
        ),
        "r4": _log(
            admin["id"], "admin", "create", "clients", None, "Анна",
            "2026-01-03 12:00:00.000000",
        ),
    }
    return {"master": master, "admin": admin, "rows": rows}


def _ids(body: dict) -> list[str]:
    return [item["id"] for item in body["items"]]


# ─── Access (spec §6: require_admin — master 403, anonymous 401) ───────────────


class TestAuditLogAccess:
    def test_anonymous_gets_401(self, app) -> None:
        anon = TestClient(app)
        assert anon.get("/api/v1/audit-logs").status_code == 401
        assert anon.get("/api/v1/audit-logs/authors").status_code == 401

    def test_master_gets_403(self, api_client, login_as) -> None:
        phone = f"+7999{uuid.uuid4().hex[:7]}"
        insert_user(phone, hash_password(MASTER_PASSWORD), role="master")
        master = login_as(phone, MASTER_PASSWORD)
        assert master.get("/api/v1/audit-logs").status_code == 403
        assert master.get("/api/v1/audit-logs/authors").status_code == 403


# ─── GET /api/v1/audit-logs — envelope, labels, sorting ────────────────────────


class TestAuditLogList:
    def test_empty_journal(self, api_client) -> None:
        resp = api_client.get("/api/v1/audit-logs")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"items": [], "total": 0, "page": 1, "per_page": 20}

    def test_response_contract_author_labels_and_sorting(
        self, api_client, journal
    ) -> None:
        from src.schemas.audit_log import AuditLogResponse
        from src.schemas.common import PaginatedResponse

        resp = api_client.get("/api/v1/audit-logs")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Envelope validates against the declared generic schema.
        page = PaginatedResponse[AuditLogResponse].model_validate(body)
        assert page.total == 4
        # Sorting: created_at DESC (r4 → r1).
        assert _ids(body) == [journal["rows"][k] for k in ("r4", "r3", "r2", "r1")]

        r1 = body["items"][3]
        assert r1["id"] == journal["rows"]["r1"]
        # Staff-linked author: label = «Иванов Иван» (last + first).
        assert r1["user"] == {"id": journal["master"]["id"], "label": "Иванов Иван"}
        assert r1["user_role"] == "master"
        assert r1["action"] == "create"
        assert r1["entity"] == "locations"
        assert r1["entity_id"] == "loc-1"
        assert r1["entity_label"] == "Студия"
        assert r1["changes"] == {"title": ["A", "B"]}
        assert r1["created_at"].startswith("2026-01-01T10:00:00")

        # user_role comes from the JOURNAL ROW, not the live user (r2's
        # live author is a master, the row snapshot says admin).
        assert body["items"][2]["user_role"] == "admin"

        # Cardless author: label falls back to the phone.
        r3 = body["items"][1]
        assert r3["user"] == {"id": journal["admin"]["id"], "label": "+79991000002"}

        # Null entity_id and null changes pass through untouched.
        r4 = body["items"][0]
        assert r4["entity_id"] is None
        assert r4["changes"] is None

    def test_filter_by_user_id(self, api_client, journal) -> None:
        resp = api_client.get(
            "/api/v1/audit-logs", params={"user_id": journal["master"]["id"]}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 2
        assert _ids(body) == [journal["rows"][k] for k in ("r2", "r1")]

    @pytest.mark.parametrize(
        ("params", "expected"),
        [
            ({"action": "create"}, ("r4", "r1")),
            ({"action": "delete"}, ("r3",)),
            ({"entity": "locations"}, ("r3", "r1")),
            ({"entity": "clients"}, ("r4",)),
            ({"entity_id": "loc-1"}, ("r3", "r1")),
            ({"entity_id": "svc-1"}, ("r2",)),
            # Whole-day canon: date_from covers from 00:00:00 inclusive…
            ({"date_from": "2026-01-02"}, ("r4", "r3", "r2")),
            # …date_to covers through the end of the day (23:59:59 row in).
            ({"date_to": "2026-01-01"}, ("r1",)),
            ({"date_from": "2026-01-02", "date_to": "2026-01-02"}, ("r3", "r2")),
            # Filters AND conjunctively.
            ({"action": "create", "entity": "locations"}, ("r1",)),
        ],
        ids=[
            "action-create", "action-delete", "entity-locations",
            "entity-clients", "entity-id-loc", "entity-id-svc",
            "date-from", "date-to", "date-window", "conjunctive",
        ],
    )
    def test_filters(self, api_client, journal, params, expected) -> None:
        resp = api_client.get("/api/v1/audit-logs", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == len(expected)
        assert _ids(body) == [journal["rows"][k] for k in expected]

    def test_unknown_filter_values_yield_empty_page(self, api_client) -> None:
        resp = api_client.get(
            "/api/v1/audit-logs", params={"action": "banana"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 0

    def test_pagination(self, api_client, journal) -> None:
        page1 = api_client.get(
            "/api/v1/audit-logs", params={"page": 1, "per_page": 2}
        ).json()
        page2 = api_client.get(
            "/api/v1/audit-logs", params={"page": 2, "per_page": 2}
        ).json()
        assert page1["total"] == page2["total"] == 4
        assert page1["page"] == 1 and page2["page"] == 2
        assert page1["per_page"] == page2["per_page"] == 2
        assert _ids(page1) == [journal["rows"][k] for k in ("r4", "r3")]
        assert _ids(page2) == [journal["rows"][k] for k in ("r2", "r1")]


# ─── GET /api/v1/audit-logs/authors — distinct dropdown entries ────────────────


class TestAuditLogAuthors:
    def test_distinct_authors_sorted_by_label(self, api_client, journal) -> None:
        resp = api_client.get("/api/v1/audit-logs/authors")
        assert resp.status_code == 200, resp.text
        # Two rows per author in the journal → ONE entry each; cardless
        # admin resolves to the phone, staff master to «Иванов Иван»;
        # sorted by label ('+' sorts before Cyrillic).
        assert resp.json() == [
            {"user_id": journal["admin"]["id"], "label": "+79991000002"},
            {"user_id": journal["master"]["id"], "label": "Иванов Иван"},
        ]

    def test_empty_journal(self, api_client) -> None:
        resp = api_client.get("/api/v1/audit-logs/authors")
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
