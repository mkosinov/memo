"""Unit tests for the ``create_record`` scenario (GH #171 Task 3).

The scenario is Corridor 2 (canon docs/domain-rules/service-layer.md
rule 2): ONE ``@transactional`` boundary + ONE event batch per business
action, orchestrating non-transactional service methods and the
RecordService row-level operation. Behavior must be identical to the
pre-refactor ``RecordService.create`` — these tests pin the new shape:

- the scenario function IS decorated with ``@transactional``;
- a direct call creates client + visitor + record + visits in the
  caller's ONE session/transaction (no commit inside the chain);
- capacity overflow still raises 409 (domain rule, same as before),
  and the caller's session rolls back to a clean pre-call state.

CALLING CONVENTION: scenarios are selfless functions, so the
``@transactional`` wrapper binds the first positional arg as ``self`` —
they are invoked with KEYWORD arguments (see the module docstring in
``src/usecases/records.py``).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.client import Client
from src.models.record import Record
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.schemas.record import RecordCreate, VisitItem
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


async def test_usecases_create_record_is_transactional():
    """The scenario owns the transaction boundary — it must be wrapped."""
    from src.usecases.records import create_record

    assert hasattr(create_record, _TRANSACTIONAL_MARKER), (
        "create_record is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_usecases_records_module_has_no_runtime_orm_imports():
    """Canon rule 2: scenarios import services/events/domain — never ORM.

    GH #171 Task 3 fix: the scenario passes VALUE payloads; building ORM
    rows is the owner service's job (its own entity — allowed). AST walk
    over the module source catches function-local and top-level runtime
    imports alike; ``TYPE_CHECKING``-guarded imports (annotation-only
    type references, never executed) are allowed.
    """
    import ast
    import inspect
    import sys

    import src.usecases.records as records_module

    source = inspect.getsource(sys.modules[records_module.__name__])
    tree = ast.parse(source)

    def _is_type_checking_guard(node: ast.expr) -> bool:
        """True if the ``if`` test is exactly ``TYPE_CHECKING``."""
        return (
            isinstance(node, ast.Name) and node.id == "TYPE_CHECKING"
        ) or (
            isinstance(node, ast.Attribute) and node.attr == "TYPE_CHECKING"
        )

    def visit(node: ast.AST, guarded: bool, found: list[str]) -> None:
        """Collect ``src.models`` imports NOT inside a TYPE_CHECKING guard."""
        if isinstance(node, ast.ImportFrom) and node.module:
            if not guarded and node.module.startswith("src.models"):
                found.append(f"line {node.lineno}: from {node.module}")
            return
        if isinstance(node, ast.Import):
            if not guarded:
                for alias in node.names:
                    if alias.name.startswith("src.models"):
                        found.append(f"line {node.lineno}: import {alias.name}")
            return
        if isinstance(node, ast.If) and _is_type_checking_guard(node.test):
            for child in node.body:
                visit(child, guarded=True, found=found)
            for child in node.orelse:
                visit(child, guarded=False, found=found)
            return
        for child in ast.iter_child_nodes(node):
            visit(child, guarded, found)

    offenders: list[str] = []
    visit(tree, guarded=False, found=offenders)
    assert offenders == [], (
        "usecases/records.py has runtime ORM-model imports — canon rule 2 "
        "(docs/domain-rules/service-layer.md): scenarios compose service "
        "and domain calls only; the SERVICE builds its own ORM rows. "
        f"Offenders: {offenders}"
    )


async def _orm_activity(db_session, create_activity) -> Activity:
    """The ``create_activity`` factory rides the API (returns a dict);
    tests here need the ORM row — fetch it by the factory's id."""
    payload = create_activity()
    activity = await db_session.get(Activity, payload["id"])
    assert activity is not None
    return activity


async def test_scenario_creates_client_visitor_record_visits(db_session, create_activity):
    """A phone+name booking creates the whole chain in ONE transaction."""
    from src.usecases.records import create_record

    activity = await _orm_activity(db_session, create_activity)

    data = RecordCreate(
        activity_id=activity.id,
        phone="+79995004040",
        visits=[VisitItem(name="Мария", price=1000)],
        comment="scenario test",
    )
    record = await create_record(None, db_session=db_session, data=data)

    # Record row exists with derived seats/status.
    stored = await db_session.get(Record, record.id)
    assert stored is not None
    assert stored.activity_id == activity.id
    assert stored.seats == 1
    assert stored.comment == "scenario test"

    # Client find-or-created by phone with the default whatsapp channel.
    client = (
        await db_session.execute(select(Client).where(Client.phone == "+79995004040"))
    ).scalar_one()
    assert stored.client_id == client.id
    assert client.channel == "whatsapp"

    # Visitor find-or-created by (client_id, name).
    visitor = (
        await db_session.execute(
            select(Visitor).where(Visitor.client_id == client.id, Visitor.name == "Мария")
        )
    ).scalar_one()
    assert visitor is not None

    # The visit batch is linked to the record and the visitor.
    visits = (
        (await db_session.execute(select(Visit).where(Visit.record_id == record.id)))
        .scalars()
        .all()
    )
    assert len(visits) == 1
    assert visits[0].visitor_id == visitor.id


async def test_scenario_capacity_overflow_rolls_back(db_session, create_activity):
    """Over-capacity booking raises 409 and leaves NO partial state.

    The scenario owns the transaction: on the capacity failure the
    decorator skips the commit; the caller's rollback undoes the
    pending find-or-create client insert.
    """
    from fastapi import HTTPException

    from src.usecases.records import create_record

    activity = await _orm_activity(db_session, create_activity)
    activity.capacity = 1
    await db_session.commit()
    activity_id = activity.id  # rollback expires ORM objects — keep the id

    data = RecordCreate(
        activity_id=activity_id,
        phone="+79995005050",
        visits=[
            VisitItem(name="А", price=100),
            VisitItem(name="Б", price=100),
        ],
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_record(None, db_session=db_session, data=data)
    assert exc_info.value.status_code == 409

    # The test session still holds the pending find-or-create add —
    # roll it back before asserting the DB is unchanged.
    await db_session.rollback()

    clients = (
        (await db_session.execute(select(Client).where(Client.phone == "+79995005050")))
        .scalars()
        .all()
    )
    assert clients == []
    records = (
        (await db_session.execute(select(Record).where(Record.activity_id == activity_id)))
        .scalars()
        .all()
    )
    assert records == []


async def test_scenario_positional_call_fails_loud(db_session, create_activity):
    """A positional call must fail LOUDLY, never misdirect the session.

    The @transactional wrapper binds the first positional arg as its
    ``self`` slot — the ``None, kwargs`` convention (module docstring)
    is mandatory.
    """
    from src.usecases.records import create_record

    activity = await _orm_activity(db_session, create_activity)
    data = RecordCreate(
        activity_id=activity.id,
        phone="+79995006060",
        visits=[VisitItem(name="X", price=100)],
    )
    # No leading None → the session lands in the wrapper's self slot and
    # the remaining args shift — TypeError (fail-loud), never a wrong
    # session silently committed.
    with pytest.raises(TypeError):
        await create_record(db_session, data)  # type: ignore[call-arg]
