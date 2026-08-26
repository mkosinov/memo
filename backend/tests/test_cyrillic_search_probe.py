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
    # Targets /api/v1/search/visitors (present until Task 14) — it exercises the
    # same ilike mechanism. Task 14 retargets this probe to GET /api/v1/visitors?q=.
    resp = api_client.get("/api/v1/search/visitors", params={"q": "иван"})
    assert resp.status_code == 200
    names = [v["name"] for v in resp.json()]
    assert "Иван Петров" in names
