"""Tests for Task 2: PATCH /api/v1/services/{id} should accept tariffs field.

Semantically, "update only tariffs" is a valid PATCH operation.
These tests verify that PATCH can replace tariffs without changing other fields.
"""

from typing import ClassVar

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


class TestServicePatchTariffs:
    """PATCH /api/v1/services/{id} should accept tariffs field."""

    def test_patch_service_tariffs_only(self, api_client) -> None:
        """PATCH with tariffs replaces tariffs, other fields preserved."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Old", "price": 1000}],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tariffs"]) == 1
        assert create.json()["tariffs"][0]["title"] == "Old"

        # PATCH with new tariffs
        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [
                {"title": "New1", "price": 2000},
                {"title": "New2", "price": 3000},
            ],
        })
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        body = response.json()
        assert body["title"] == "Test Service"  # unchanged
        assert len(body["tariffs"]) == 2
        assert body["tariffs"][0]["title"] == "New1"
        assert body["tariffs"][1]["title"] == "New2"

    def test_patch_service_tariffs_empty_clears(self, api_client) -> None:
        """PATCH with empty tariffs list clears all tariffs."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Old", "price": 1000}],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tariffs"]) == 1

        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tariffs": [],
        })
        assert response.status_code == 200
        assert response.json()["tariffs"] == []

    def test_patch_service_without_tariffs_preserves(self, api_client) -> None:
        """PATCH without tariffs field preserves existing tariffs."""
        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Keep", "price": 1500}],
        })
        service_id = create.json()["id"]

        # PATCH duration only, tariffs should be preserved
        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "duration": 120,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["duration"] == 120
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Keep"


class TestTariffIdDiff:
    """GH #357 Task 2: ``tariffs`` on PUT/PATCH applies an id-keyed diff.

    Per row: ``id`` found on THIS service → UPDATE in place (id stable);
    no ``id`` → INSERT; ``id`` not found (foreign or stale) → 422
    VALIDATION_ERROR naming the row index; row absent from the payload →
    DELETE. The whole diff rides one transaction — a 422 leaves the
    stored tariffs untouched (no partial apply).
    """

    _BASE: ClassVar[dict] = {
        "title": "Test Service",
        "description": "desc",
        "image_url": "https://example.com/test.jpg",
        "specialty": "живопись",
        "min_age": 6,
        "max_age": 99,
        "duration": 90,
        "record_info": "info",
    }

    def _create_with_tariffs(self, api_client, tariffs: list[dict]) -> dict:
        create = api_client.post(
            "/api/v1/services", json={**self._BASE, "tariffs": tariffs}
        )
        assert create.status_code == 201, f"Create failed: {create.text}"
        return create.json()

    # ── UPDATE branch: known id → row updated in place, id stable ──────────

    def test_patch_updates_tariff_in_place_by_id(self, api_client) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "Old", "price": 1000}]
        )
        old_tariff_id = service["tariffs"][0]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={"tariffs": [{"id": old_tariff_id, "title": "New", "price": 2000}]},
        )
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        [tariff] = response.json()["tariffs"]
        assert tariff["id"] == old_tariff_id
        assert tariff["title"] == "New"
        assert tariff["price"] == 2000

    def test_put_updates_tariff_in_place_by_id(self, api_client) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "Old", "price": 1000}]
        )
        old_tariff_id = service["tariffs"][0]["id"]

        response = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={
                **self._BASE,
                "tariffs": [{"id": old_tariff_id, "title": "New", "price": 2000}],
            },
        )
        assert response.status_code == 200, f"PUT failed: {response.text}"
        [tariff] = response.json()["tariffs"]
        assert tariff["id"] == old_tariff_id
        assert tariff["title"] == "New"
        assert tariff["price"] == 2000

    # ── INSERT branch: no id → new row with a fresh id ─────────────────────

    def test_patch_inserts_idless_tariff_keeps_existing_ids(
        self, api_client
    ) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "Keep", "price": 1000}]
        )
        keep_id = service["tariffs"][0]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={
                "tariffs": [
                    {"id": keep_id, "title": "Keep", "price": 1000},
                    {"title": "Extra", "price": 500},
                ]
            },
        )
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        tariffs = response.json()["tariffs"]
        assert len(tariffs) == 2
        by_id = {t["id"]: t for t in tariffs}
        assert keep_id in by_id  # existing row not recreated
        fresh_ids = [t["id"] for t in tariffs if t["id"] != keep_id]
        assert len(fresh_ids) == 1  # id-less row inserted with a fresh id
        assert by_id[fresh_ids[0]]["title"] == "Extra"

    # ── DELETE branch: row absent from payload → deleted ───────────────────

    def test_patch_deletes_tariffs_missing_from_payload(
        self, api_client
    ) -> None:
        service = self._create_with_tariffs(
            api_client,
            [{"title": "A", "price": 1000}, {"title": "B", "price": 2000}],
        )
        kept_id, dropped_id = sorted(t["id"] for t in service["tariffs"])
        kept_title = next(
            t["title"] for t in service["tariffs"] if t["id"] == kept_id
        )

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={"tariffs": [{"id": kept_id, "title": kept_title, "price": 1000}]},
        )
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        [tariff] = response.json()["tariffs"]
        assert tariff["id"] == kept_id
        # hard-deleted at DB level, not soft-hidden
        rows = query_db(
            f"SELECT id FROM tariffs WHERE service_id='{service['id']}'"
        )
        assert [r["id"] for r in rows] == [kept_id]
        assert dropped_id not in {r["id"] for r in rows}

    def test_put_absent_tariffs_field_deletes_all(self, api_client) -> None:
        """PUT: absent ``tariffs`` field = empty list = clear all (kept
        current behavior per spec §«Технические изменения» п.2)."""
        service = self._create_with_tariffs(
            api_client,
            [{"title": "A", "price": 1000}, {"title": "B", "price": 2000}],
        )

        response = api_client.put(
            f"/api/v1/services/{service['id']}", json={**self._BASE}
        )
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["tariffs"] == []
        rows = query_db(
            f"SELECT id FROM tariffs WHERE service_id='{service['id']}'"
        )
        assert rows == []

    def test_put_empty_tariffs_list_deletes_all(self, api_client) -> None:
        """PUT: ``tariffs: []`` is legal — a service without tariffs."""
        service = self._create_with_tariffs(
            api_client, [{"title": "A", "price": 1000}]
        )

        response = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={**self._BASE, "tariffs": []},
        )
        assert response.status_code == 200, f"PUT failed: {response.text}"
        assert response.json()["tariffs"] == []

    # ── unknown/foreign id → 422 VALIDATION_ERROR naming the row index ─────

    def test_patch_unknown_tariff_id_is_422_with_row_index(
        self, api_client
    ) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "A", "price": 1000}]
        )
        bogus_id = "00000000-0000-0000-0000-000000000000"

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={
                "tariffs": [
                    {"title": "Fresh", "price": 100},
                    {"id": bogus_id, "title": "Stale", "price": 200},
                ]
            },
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[1]" in detail["message"]
        assert bogus_id in detail["message"]

    def test_patch_foreign_tariff_id_is_422(self, api_client) -> None:
        """A tariff id belonging to ANOTHER service is foreign here → 422
        (the stale-form scenario: tariff deleted in another session)."""
        service_a = self._create_with_tariffs(
            api_client, [{"title": "A", "price": 1000}]
        )
        service_b = self._create_with_tariffs(
            api_client, [{"title": "B", "price": 2000}]
        )
        foreign_id = service_b["tariffs"][0]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service_a['id']}",
            json={"tariffs": [{"id": foreign_id, "title": "Stolen", "price": 1}]},
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[0]" in detail["message"]
        assert foreign_id in detail["message"]

    def test_put_unknown_tariff_id_is_422(self, api_client) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "A", "price": 1000}]
        )

        response = api_client.put(
            f"/api/v1/services/{service['id']}",
            json={
                **self._BASE,
                "tariffs": [
                    {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "title": "Stale",
                        "price": 200,
                    }
                ],
            },
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[0]" in detail["message"]

    # ── PATCH: null/absent tariffs → preserved (spec п.2) ──────────────────

    def test_patch_null_tariffs_preserves(self, api_client) -> None:
        service = self._create_with_tariffs(
            api_client, [{"title": "Keep", "price": 1500}]
        )
        tariff_id = service["tariffs"][0]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={"tariffs": None, "duration": 120},
        )
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        body = response.json()
        assert body["duration"] == 120
        assert [t["id"] for t in body["tariffs"]] == [tariff_id]

    # ── one transaction: a 422 leaves stored tariffs untouched ─────────────

    def test_422_diff_leaves_tariffs_unchanged(self, api_client) -> None:
        """The diff is atomic: when one row fails validation, neither the
        sibling UPDATE nor the payload-driven DELETE is applied."""
        service = self._create_with_tariffs(
            api_client,
            [{"title": "A", "price": 1000}, {"title": "B", "price": 2000}],
        )
        original = {t["id"]: t for t in service["tariffs"]}
        first_id = service["tariffs"][0]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={
                "tariffs": [
                    {"id": first_id, "title": "Mutated", "price": 9999},
                    {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "title": "Stale",
                        "price": 1,
                    },
                ]
            },
        )
        assert response.status_code == 422
        body = api_client.get(f"/api/v1/services/{service['id']}").json()
        assert {t["id"] for t in body["tariffs"]} == set(original)
        for tariff in body["tariffs"]:
            assert tariff["title"] == original[tariff["id"]]["title"]
            assert tariff["price"] == original[tariff["id"]]["price"]

    # ── the full diff in one payload: update + insert + delete ─────────────

    def test_patch_mixed_diff_update_insert_delete(self, api_client) -> None:
        service = self._create_with_tariffs(
            api_client,
            [{"title": "A", "price": 1000}, {"title": "B", "price": 2000}],
        )
        updated_id = service["tariffs"][0]["id"]
        dropped_id = service["tariffs"][1]["id"]

        response = api_client.patch(
            f"/api/v1/services/{service['id']}",
            json={
                "tariffs": [
                    {"id": updated_id, "title": "Renamed", "price": 1111},
                    {"title": "Fresh", "price": 222},
                ]
            },
        )
        assert response.status_code == 200, f"PATCH failed: {response.text}"
        tariffs = response.json()["tariffs"]
        assert len(tariffs) == 2  # B dropped, Fresh inserted
        by_id = {t["id"]: t for t in tariffs}
        assert updated_id in by_id  # updated in place, id stable
        assert by_id[updated_id]["title"] == "Renamed"
        assert by_id[updated_id]["price"] == 1111
        assert dropped_id not in by_id
        assert {t["title"] for t in tariffs} == {"Renamed", "Fresh"}


class TestTariffIdDuplicate422:
    """GH #357 Task 1 (schema level, still in force): a repeated tariff
    ``id`` in one request list is an ambiguous diff key → 422
    VALIDATION_ERROR naming the offending row index (both verbs)."""

    _BASE: ClassVar[dict] = {
        "title": "Test Service",
        "description": "desc",
        "image_url": "https://example.com/test.jpg",
        "specialty": "живопись",
        "min_age": 6,
        "max_age": 99,
        "duration": 90,
        "record_info": "info",
    }

    def _create_service_with_tariff(self, api_client) -> str:
        create = api_client.post(
            "/api/v1/services",
            json={**self._BASE, "tariffs": [{"title": "Old", "price": 1000}]},
        )
        assert create.status_code == 201, f"Create failed: {create.text}"
        return create.json()["id"]

    def test_patch_duplicate_tariff_id_is_422_with_row_index(
        self, api_client
    ) -> None:
        service_id = self._create_service_with_tariff(api_client)

        response = api_client.patch(
            f"/api/v1/services/{service_id}",
            json={
                "tariffs": [
                    {"id": "t-1", "title": "A", "price": 1000},
                    {"id": "t-2", "title": "B", "price": 2000},
                    {"id": "t-1", "title": "C", "price": 3000},
                ],
            },
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[2]" in detail["message"]
        assert "t-1" in detail["message"]

    def test_put_duplicate_tariff_id_is_422_with_row_index(
        self, api_client
    ) -> None:
        service_id = self._create_service_with_tariff(api_client)

        response = api_client.put(
            f"/api/v1/services/{service_id}",
            json={
                **self._BASE,
                "tariffs": [
                    {"id": "t-1", "title": "A", "price": 1000},
                    {"id": "t-1", "title": "B", "price": 2000},
                ],
            },
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "tariffs[1]" in detail["message"]
