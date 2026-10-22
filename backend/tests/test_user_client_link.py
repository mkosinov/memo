"""GH #499 Task 1 — the ``users.client_id`` link to the client card.

Spec §3 (docs/specs/2026-10-20-web-client-auth-booking-design.md): ``User``
gains an optional 1:1 link to ``clients`` — column ``client_id``
(FK → clients, unique, nullable), mirroring the existing ``staff_id``
pattern (GH #266: FK-only, no ORM relationship). The shared test DB is
built by the session-scoped ``db_engine`` fixture via ``alembic
upgrade head``, so PRAGMA introspection here asserts the MIGRATED
schema (model+migration together); the chain itself is covered by
``tests/test_user_client_migration.py``.
"""

from __future__ import annotations

import sqlite3
import uuid

import pytest

from tests.conftest import query_db, query_db_params

pytestmark = pytest.mark.api  # shared test DB (rebuilt from ORM metadata)


def _insert_client(phone: str) -> str:
    """Insert a clients row directly; returns its id."""
    client_id = str(uuid.uuid4())
    query_db_params(
        "INSERT INTO clients (id, phone, is_active, created_at, updated_at)"
        " VALUES (:id, :phone, 1, datetime('now'), datetime('now'))",
        {"id": client_id, "phone": phone},
    )
    return client_id


def _insert_user(phone: str, client_id: str | None) -> str:
    """Insert a users row with the client link (conftest insert_user pattern
    + client_id); returns its id."""
    user_id = str(uuid.uuid4())
    query_db_params(
        "INSERT INTO users (id, phone, password_hash, role, staff_id, client_id,"
        " email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at)"
        " VALUES (:id, :phone, NULL, 'client', NULL, :client_id, 0, 0, 1,"
        " datetime('now'), datetime('now'))",
        {"id": user_id, "phone": phone, "client_id": client_id},
    )
    return user_id


class TestUserClientIdColumn:
    def test_column_shape_fk_and_unique(self) -> None:
        """client_id: nullable String(36), FK → clients.id, unique — the
        staff_id mirror (one account per client card)."""
        cols = {r["name"]: r for r in query_db("PRAGMA table_info(users)")}
        assert "client_id" in cols, "users.client_id missing from the model"
        col = cols["client_id"]
        assert col["type"].upper() == "VARCHAR(36)"
        assert col["notnull"] == 0, "client_id must be nullable (link is optional)"

        fks = query_db("PRAGMA foreign_key_list(users)")
        assert any(
            fk["from"] == "client_id" and fk["table"] == "clients" and fk["to"] == "id"
            for fk in fks
        ), f"FK users.client_id → clients.id missing: {fks}"

        # Uniqueness: some unique index in sqlite_master covers exactly client_id.
        indexes = query_db("PRAGMA index_list(users)")
        unique_indexes = [r["name"] for r in indexes if r["unique"]]
        covered = {
            col_row["name"]
            for idx in unique_indexes
            for col_row in query_db(f"PRAGMA index_info({idx})")
        }
        assert "client_id" in covered, (
            f"no unique index covers users.client_id: indexes={indexes}"
        )

    def test_link_persists_and_is_unique_per_card(self) -> None:
        """The link round-trips and is 1:1 — a second account cannot point
        at the same client card."""
        card = _insert_client("+79995550101")
        user_id = _insert_user("+79995550102", card)

        row = query_db(f"SELECT client_id FROM users WHERE id = '{user_id}'")
        assert row[0]["client_id"] == card

        with pytest.raises(sqlite3.IntegrityError):
            _insert_user("+79995550103", card)

        # A NULL link stays free for any number of accounts (pure admins,
        # masters, unlinked client accounts) — nullable, not NOT NULL.
        _insert_user("+79995550104", None)
        _insert_user("+79995550105", None)
