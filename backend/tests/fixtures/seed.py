"""
seed.py — Load JSON fixture data into the test database via API.

Usage in tests::

    from tests.fixtures.seed import SeedLoader

    def test_something(api_client):
        seed = SeedLoader(api_client)
        data = seed.load_all()
        # data["masters"][0]["id"], data["services"][0]["id"], etc.

Or use individual loaders::

    masters = seed.load_masters()
    services = seed.load_services()
    locations = seed.load_locations()

Provides deterministic, reusable test data from JSON fixtures.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

_FIXTURES_DIR = Path(__file__).parent


def _load_json(name: str) -> list[dict]:
    """Load a JSON fixture file by name (without extension)."""
    path = _FIXTURES_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


class SeedLoader:
    """Load seed data into the test database via API calls.

    Each ``load_*`` method reads the corresponding JSON file, POSTs each
    item to the API, and returns the list of created objects (with IDs).
    """

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self._cache: dict[str, list[dict]] = {}

    def load_masters(self) -> list[dict]:
        """Create masters from fixtures/masters.json."""
        if "masters" not in self._cache:
            items = _load_json("masters")
            created = []
            for item in items:
                resp = self.client.post("/api/v1/masters", json=item)
                assert resp.status_code == 201, f"Seed master failed: {resp.text}"
                created.append(resp.json())
            self._cache["masters"] = created
        return self._cache["masters"]

    def load_services(self) -> list[dict]:
        """Create services from fixtures/services.json (with tariffs)."""
        if "services" not in self._cache:
            items = _load_json("services")
            created = []
            for item in items:
                resp = self.client.post("/api/v1/services", json=item)
                assert resp.status_code == 201, f"Seed service failed: {resp.text}"
                created.append(resp.json())
            self._cache["services"] = created
        return self._cache["services"]

    def load_locations(self) -> list[dict]:
        """Create locations from fixtures/locations.json."""
        if "locations" not in self._cache:
            items = _load_json("locations")
            created = []
            for item in items:
                resp = self.client.post("/api/v1/locations", json=item)
                assert resp.status_code == 201, f"Seed location failed: {resp.text}"
                created.append(resp.json())
            self._cache["locations"] = created
        return self._cache["locations"]

    def load_all(self) -> dict[str, list[dict]]:
        """Load all fixture data and return as a dict.

        Returns::

            {
                "masters": [...],
                "services": [...],
                "locations": [...],
            }
        """
        return {
            "masters": self.load_masters(),
            "services": self.load_services(),
            "locations": self.load_locations(),
        }
