"""Task 6 (#207): dead-code cleanup — ``_strip_is_active_none`` is GONE.

After Task 5 removed ``is_active`` from all PATCH schemas (so the field is
rejected with 422 via ``extra="forbid"`` long before it reaches the service
layer), the ``_strip_is_active_none`` helper — whose single purpose was to
drop ``is_active`` when ``None`` from a patch payload (#184 sticky-field
semantics) — became unreachable dead code. Task 6 deletes the helper, both
of its call sites (``ArchiveService._patch_payload`` and
``ServiceService.patch``), and the import in ``services/service.py``.

These structural/source assertions pin the removal so the helper cannot be
accidentally reintroduced: ``is_active`` is no longer a patch field, so no
patch path should know about it.

Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
§3.2 (PUT/PATCH schemas), §14 (dead-code AC).
"""

from __future__ import annotations

import inspect

import pytest

from src.services import generic as generic_module
from src.services import service as service_module

pytestmark = pytest.mark.pure_unit


def test_strip_is_active_none_removed_from_generic_module() -> None:
    """The dead helper is no longer defined in ``services/generic.py``.

    ``_strip_is_active_none`` had a single caller-purpose (strip
    ``is_active=None`` from patch payloads) that is obsolete once PATCH
    schemas reject ``is_active`` with 422 (Task 5, ``extra="forbid"``).
    Spec §14 (dead-code AC).
    """
    assert not hasattr(generic_module, "_strip_is_active_none"), (
        "`_strip_is_active_none` must be deleted from services/generic.py — "
        "is_active is no longer a PATCH field (Task 5), so the strip helper "
        "is unreachable dead code (spec §14 dead-code AC)."
    )
    source = inspect.getsource(generic_module)
    assert "_strip_is_active_none" not in source, (
        "`_strip_is_active_none` must not be referenced anywhere in "
        "services/generic.py — neither as a definition nor as a call. "
        "Spec §14 (dead-code AC)."
    )


def test_strip_is_active_none_not_used_by_service_module() -> None:
    """``ServiceService.patch`` no longer imports/calls the dead helper.

    The import at ``services/service.py`` and the call site inside
    ``ServiceService.patch`` are removed together with the helper. The
    schema rejects ``is_active`` before the service is reached, so no
    strip is needed. Spec §14 (dead-code AC).
    """
    assert not hasattr(service_module, "_strip_is_active_none"), (
        "`_strip_is_active_none` must no longer be imported into "
        "services/service.py (spec §14 dead-code AC)."
    )
    source = inspect.getsource(service_module)
    assert "_strip_is_active_none" not in source, (
        "`_strip_is_active_none` must not be referenced anywhere in "
        "services/service.py — neither as an import nor as a call. "
        "Spec §14 (dead-code AC)."
    )
