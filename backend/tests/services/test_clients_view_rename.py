"""№1 clients composite rename (GH #217 Task 5, ADR 007 / canon rule 8).

``list_clients_with_stats`` → ``list_clients_view`` (table-page read
function — the ``list_<entity>_view`` naming convention, ADR 007 item 5)
and the response schema ``ClientWithStats`` → ``ClientViewResponse``.
Internal Python names only: the HTTP contract and the JSON shape are
UNCHANGED. The hand-written cheap count stays (documented exception,
GH #206 — see «Что сознательно не строим» in the #217 spec).
"""

from __future__ import annotations

from src.schemas.client import ClientViewResponse
from src.services.client import ClientService

# asyncio mode is AUTO in pyproject; the rename-guard tests stay sync.


# ─── list_clients_view: module-level free function ──────────────────────────


def test_list_clients_view_is_module_function() -> None:
    """The composite is a free function in the clients service module."""
    import src.services.client as client_module

    assert callable(client_module.list_clients_view)


def test_old_names_are_gone() -> None:
    """NO residual shim: the old names disappear from module and schema."""
    import src.schemas.client as schema_module
    import src.services.client as client_module

    assert not hasattr(client_module, "list_clients_with_stats")
    assert not hasattr(schema_module, "ClientWithStats")


def test_client_view_response_extends_client_response() -> None:
    """ClientViewResponse keeps the ClientResponse base + the four stats
    fields with the same defaults (pure rename — no field changes)."""
    from src.schemas.client import ClientResponse

    assert issubclass(ClientViewResponse, ClientResponse)
    item = ClientViewResponse(
        id="test-id",
        name=None,
        phone=None,
        created_at="2025-01-01T00:00:00",
        updated_at="2025-01-01T00:00:00",
        is_active=True,
    )
    assert item.records_count == 0
    assert item.last_record is None
    assert item.total_paid == 0
    assert item.missed_records == 0


# ─── the class is untouched ──────────────────────────────────────────────────


def test_client_service_still_exists() -> None:
    """The rename touches only the free function/schema; the CRUD service
    class stays."""
    assert ClientService is not None
