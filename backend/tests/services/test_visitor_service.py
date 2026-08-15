"""VisitorService structural + no-commit test for `_delete_cascade` (#207 Task 7).

Task 7 extracts the body of ``VisitorService.delete`` into a NON-DECORATED
inner method ``_delete_cascade(self, db_session, visitor_id)`` that performs the
visit→photo(SET NULL)→visitor_tags→visitor cascade WITHOUT committing. The
public ``@transactional delete`` becomes a thin wrapper that calls it. This
lets ``ClientService.resolve_delete`` (Task 10) call ``_delete_cascade`` inside
its OWN ``@transactional`` outer cascade loop on a SHARED session — atomicity
with ONE commit at the outer boundary, not N mid-loop commits.

This test verifies ONLY the structural extraction + the no-commit property.
The full atomicity fault-injection test (visitor cascade rolled back inside a
Client outer transaction on mid-cascade failure) lives in Task 14 — it requires
``ClientService.resolve_delete`` (Task 10). DO NOT add it here.
"""

from __future__ import annotations

import pytest

from src.models.client import Client
from src.models.visitor import Visitor
from src.services.visitor import VisitorService, get_visitor_service


pytestmark = pytest.mark.asyncio


async def test_delete_cascade_is_non_decorated_core_that_does_not_commit(db_session):
    """Task 7 contract: ``_delete_cascade`` is a non-decorated method on
    ``VisitorService`` that performs the cascade WITHOUT committing.

    Two facets of the SAME behavior (the extraction contract), checked in one
    test so the structural assertion yields a CLEAN RED before the extraction
    lands:

    1. Structural — ``hasattr(VisitorService, "_delete_cascade")``. False
       before Task 7 → ``AssertionError`` (a clean failure, not an
       ``AttributeError`` error) — the test never reaches the
       ``_delete_cascade`` call below.
    2. No-commit — the caller owns the transaction. Proof is mock-free, following
       the existing atomicity-test pattern: insert a visitor (committed), call
       ``_delete_cascade`` (which issues the DELETE but must NOT commit), then
       ROLL BACK the session. Because nothing was committed, the rollback
       undoes the pending delete and the visitor is STILL present in the
       committed DB snapshot (read via a raw sqlite connection, ``query_db``).

       Had ``_delete_cascade`` committed, the rollback could NOT undo it and
       the visitor would be gone — which would fail this assertion. Therefore
       the visitor's survival IS conclusive proof of the no-commit property.
    """
    from tests.conftest import query_db

    # ── 1. Structural: `_delete_cascade` exists on VisitorService (clean RED) ──
    assert hasattr(VisitorService, "_delete_cascade"), (
        "VisitorService must expose `_delete_cascade` (Task 7 extraction) for "
        "atomic reuse by ClientService.resolve_delete (Task 10)"
    )
    assert callable(VisitorService._delete_cascade)

    # ── 2. Setup: a visitor (committed), owned by a client ──
    client = Client(name="C", phone=None)
    db_session.add(client)
    await db_session.commit()
    visitor = Visitor(client_id=client.id, name="Alice")
    db_session.add(visitor)
    await db_session.commit()
    visitor_id = visitor.id

    # Sanity: the visitor is in the committed DB before the cascade runs.
    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitors WHERE id='{visitor_id}'"
    )[0]["c"] == 1

    # ── 3. Act: run the non-decorated cascade core (NO caller commit) ──
    service = get_visitor_service()
    result = await service._delete_cascade(db_session, visitor_id)

    assert result is True

    # ── 4. Assert: NO commit happened — roll back and the visitor survives ──
    # `_delete_cascade` must NOT have committed: rolling back the session
    # undoes the pending (uncommitted) DELETE, so the visitor is still present
    # in the committed DB snapshot. If it had committed, rollback couldn't
    # undo it and the visitor would be gone.
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM visitors WHERE id='{visitor_id}'"
    )[0]["c"] == 1, (
        "_delete_cascade must NOT commit — the caller owns the transaction "
        "boundary. If the visitor is gone after rollback, the extracted core "
        "committed mid-cascade, breaking atomicity for the Client→visitors "
        "outer @transactional (Task 10 / atomicity fault-injection Task 14)."
    )