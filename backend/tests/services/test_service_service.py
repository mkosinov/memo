"""Per-entity ServiceService tests (contract exception — own update/patch/list semantics)."""

from __future__ import annotations

import pytest

from src.models.service import Service
from src.schemas.common import PaginatedResponse
from src.services.service import get_service_service

pytestmark = pytest.mark.asyncio


# ─── ServiceService.list pagination (moved from test_generic_service_list.py:140-155) ─

async def test_service_service_list_paginated(db_session):
    """ServiceService.list returns envelope with eager-loaded tariffs/tags."""
    for i in range(3):
        db_session.add(Service(
            title=f"S{i}", description="d", image_url="http://x",
            specialty="s", min_age=5, duration=60, record_info="r",
        ))
    await db_session.flush()
    service = get_service_service()
    result = await service.list(db_session, page=1, per_page=2)
    assert isinstance(result, PaginatedResponse)
    assert result.total == 3
    assert len(result.items) == 2
    assert hasattr(result.items[0], "tariffs")
    assert hasattr(result.items[0], "tags")


# #207 Task 13 Part B3: the ``TestServiceIsActiveContract`` class + its
# exclusive helpers (``_SERVICE_UPDATE_FIELDS``, ``_seed_service``) were deleted.
# The class pinned the OLD #178 canonical-PUT contract (``is_active`` required
# on PUT, sticky PATCH) — stale post-#207 §3.2 (``is_active`` removed from
# ServiceUpdate + ServicePatch, PUT/PATCH with ``is_active`` → 422,
# archive/restore via POST endpoints). The new contract is pinned by:
#   * HTTP level: ``test_update_rejects_is_active.py`` (Task 5 bare-422) +
#     ``test_put_is_active.py`` / ``test_patch_is_active.py`` (Task 13
#     acceptance + atomicity).
#   * service level: ``TestArchiveServiceArchiveRestore`` in
#     ``test_generic_service_contract.py`` (parametrized over all 5 archive-
#     capable entities including ServiceService, via ``_archive_params()``).
#   * ServiceService-specific archive/restore at HTTP level:
#     ``TestArchiveRestoreEndpoints`` + ``TestArchiveRestoreNoUserCascade``
#     in ``test_api_services.py``.