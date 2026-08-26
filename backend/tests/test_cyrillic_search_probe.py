"""M5 probe (GH #212): Cyrillic case-insensitivity of list search on SQLite.

Stock SQLite lower() folds ASCII only — without the engine-level override in
src/db/database.py this test fails ("иван" does not match "Иван").
"""

import pytest

pytestmark = pytest.mark.api


def test_cyrillic_ilike_probe(api_client, create_client) -> None:
    client = create_client()
    api_client.post(
        "/api/v1/visitors",
        json={"client_id": client["id"], "name": "Иван Петров", "age": 30},
    )
    # Retargeted (Task 14, GH #212): the dedicated /api/v1/search/* router is
    # gone; the list endpoint's ?q= filter exercises the same ilike mechanism.
    resp = api_client.get("/api/v1/visitors", params={"q": "иван"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Иван Петров"
