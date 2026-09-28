"""Shared DELETE-route helpers — the #324 family contract transport.

The six delete-family routes (visits/payments/photos/user-settings/
visitors/positions, GH #324 §4) share the exact transport of the
records/tags deferred-delete contract (#285 rev7-rev9 / #318 D2):

* the two FORM rejections (bare body / dry_run+resolutions) — checked
  before any DB access;
* the 409 ``{detail, dependencies}`` response builder (dry-run preview
  and commit-time stale snapshot);
* the ``dry_run`` query-param shape.

The scope-existence probe and the executor stay per-route (each route
owns its ``*_scoped_or_404`` helper / own-only gate and its service
surface); this module is transport only — no DB access.
"""

from typing import Annotated

from fastapi import Query
from fastapi.responses import JSONResponse

from src.schemas.common import DeleteBody

#: The ``?dry_run=true`` query param — same declaration as the
#: records/tags routes (pure preview, never modifies rows).
DryRunParam = Annotated[
    bool | None,
    Query(
        description=(
            "Non-destructive preview: returns 204 without deleting "
            "(no deps) or 409 with the dependency tree; never "
            "modifies rows"
        )
    ),
]

__all__ = ["DeleteBody", "DryRunParam", "dependencies_response", "form_rejection"]


def form_rejection(body: DeleteBody | None, dry_run: bool | None) -> JSONResponse | None:
    """The FORM checks — spec §4.1, run FIRST, before any DB access.

    Returns the 422 JSONResponse when the request shape is rejected:

    * no flag AND no ``expected`` (bare DELETE or a resolutions-only
      body — the rejected legacy shape) → 422
      ``expected_state_required``;
    * ``?dry_run=true`` combined with a ``resolutions`` body → 422
      ``dry_run_with_resolutions_forbidden`` (a pure preview never
      carries execution choices; an expected-only body IS allowed and
      silently ignored).

    Literal string detail (same flat shape as the 409 preview) →
    JSONResponse, not raised: the global HTTPException handler wraps
    string details into {code, message} — not the pinned contract.
    """
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    if not dry_run and expected is None:
        return JSONResponse(
            status_code=422,
            content={"detail": "expected_state_required"},
        )
    if dry_run and resolutions is not None:
        return JSONResponse(
            status_code=422,
            content={"detail": "dry_run_with_resolutions_forbidden"},
        )
    return None


def dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 payload: ``{detail, dependencies}``.

    Mirror of the records/activities/tags routes' builder (#285/#286/
    #318; same pinned shape). ``detail`` distinguishes the two 409s of
    the deferred-delete contract: ``has_dependencies`` (dry-run preview)
    and ``stale_dependencies`` (commit-time expected mismatch). The
    ``dependencies`` array is ``DependencyNode`` dumps — optional-None
    node fields are OMITTED (``exclude_none``), non-optional fields
    always serialize.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )
