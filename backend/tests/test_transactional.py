"""Unit tests for @transactional decorator (TDD — RED phase).

Verifies the Unit of Work commit boundary: the decorator commits the
session after the service method returns successfully, before the
HTTP response is sent to the client.

These tests use a hand-rolled ``_MockSession`` with ``AsyncMock`` for
``commit()`` and a ``commit_calls`` counter — no real DB, no FastAPI.
Decorator behavior is tested in isolation from the rest of the system.

GH #394: the signature contract is validated ONCE at decoration time —
off-contract shapes (``cls`` first, no parameters, ``*args`` at the
session slot, ``self`` without a session) raise a loud TypeError on
import. Both supported forms are called naturally: a bound method
receives the instance implicitly, a selfless function takes its own
declared arguments — no placeholder slot, no leading ``None``.
"""

from unittest.mock import AsyncMock

import pytest

pytestmark = pytest.mark.pure_unit


class _MockSession:
    """Minimal stand-in for an AsyncSession — only ``commit()`` matters."""

    def __init__(self) -> None:
        self.commit_calls = 0
        self.commit = AsyncMock(side_effect=self._track_commit)

    async def _track_commit(self) -> None:
        self.commit_calls += 1


class _Service:
    """Holder for methods-under-test (the decorator needs a callable self)."""

    @staticmethod
    async def create_default(db_session, data):
        """Default parameter name: db_session."""
        return {"id": 1, "data": data}

    @staticmethod
    async def create_named_session(session, data):
        """Parameter named session (not db_session)."""
        return {"id": 2, "data": data}

    @staticmethod
    async def create_positional(s, data):
        """First positional arg (any name) — passed as positional."""
        return {"id": 3, "data": data}

    @staticmethod
    async def create_returns_bool(db_session, data):
        """Returns a non-dict value (bool) — decorator must preserve it."""
        return True

    @staticmethod
    async def create_already_committed(db_session, data):
        """Pretends the method itself committed once before returning."""
        await db_session.commit()  # manual commit inside method
        return {"id": 4, "data": data}

    @staticmethod
    async def create_raises(db_session, data):
        """Raises an exception — decorator must NOT commit."""
        raise ValueError("boom")


def _apply_decorator(method):
    """Lazy import + apply — keeps the test file 'RED' until implementation exists."""
    from src.services.decorators import transactional

    return transactional(method)


# ─── 1. Commit on success ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_commits_after_success():
    """Decorated method commits the session after returning."""
    decorated = _apply_decorator(_Service.create_default)
    sess = _MockSession()

    result = await decorated(sess, "hello")

    assert result == {"id": 1, "data": "hello"}
    assert sess.commit_calls == 1, "commit() must be called exactly once on success"


# ─── 2. No commit on exception ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_does_not_commit_on_exception():
    """Decorated method does NOT commit when the wrapped method raises."""
    decorated = _apply_decorator(_Service.create_raises)
    sess = _MockSession()

    with pytest.raises(ValueError, match="boom"):
        await decorated(sess, "data")

    assert sess.commit_calls == 0, "commit() must NOT be called when method raises"


# ─── 3. Double-commit is safe ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_double_commit_is_safe():
    """If the method already committed, decorator's second commit is a no-op (count=2)."""
    decorated = _apply_decorator(_Service.create_already_committed)
    sess = _MockSession()

    result = await decorated(sess, "x")

    # 1 from the method body, 1 from the decorator → total 2, no error raised
    assert sess.commit_calls == 2
    assert result == {"id": 4, "data": "x"}


# ─── 4. Works with ``session`` param name (not ``db_session``) ────────────────


@pytest.mark.asyncio
async def test_works_with_session_param_name():
    """Decorator finds the session param regardless of its name."""
    decorated = _apply_decorator(_Service.create_named_session)
    sess = _MockSession()

    result = await decorated(sess, "y")

    assert result == {"id": 2, "data": "y"}
    assert sess.commit_calls == 1


# ─── 5. Works when session is passed as positional arg ───────────────────────


@pytest.mark.asyncio
async def test_works_with_positional_session():
    """Decorator finds the session when passed as the first positional arg."""
    decorated = _apply_decorator(_Service.create_positional)
    sess = _MockSession()

    # Call as positional args (no kwargs) — decorator must still find the session
    result = await decorated(sess, "z")

    assert result == {"id": 3, "data": "z"}
    assert sess.commit_calls == 1


# ─── 6. Return value preserved (bool, dict, etc.) ────────────────────────────


@pytest.mark.asyncio
async def test_returns_original_result():
    """Decorator preserves the wrapped method's return value (here: a bool)."""
    decorated = _apply_decorator(_Service.create_returns_bool)
    sess = _MockSession()

    result = await decorated(sess, "anything")

    assert result is True
    assert sess.commit_calls == 1


# ─── 7. Decoration-time contract validation (GH #394) ────────────────────────


def test_contract_rejects_signature_without_parameters():
    """Zero-parameter functions cannot carry a session — loud TypeError."""

    async def no_params():
        return 1

    with pytest.raises(TypeError, match="no parameters"):
        _apply_decorator(no_params)


def test_contract_rejects_classmethod_form():
    """``cls`` first (classmethod form) is outside the contract."""

    async def cm(cls, db_session):
        return 1

    with pytest.raises(TypeError, match="classmethod"):
        _apply_decorator(cm)


def test_contract_rejects_self_without_session():
    """``self`` with no session parameter after it is outside the contract."""

    async def m(self):
        return 1

    with pytest.raises(TypeError, match="no session parameter"):
        _apply_decorator(m)


def test_contract_rejects_var_args_at_the_session_slot():
    """``*args`` where the session is expected makes it unresolvable."""

    async def m(*args, db_session):
        return 1

    with pytest.raises(TypeError, match="cannot be resolved positionally"):
        _apply_decorator(m)


def test_contract_accepts_both_supported_forms():
    """Instance-method and selfless signatures decorate cleanly."""

    async def scenario(db_session, data):
        return data

    async def method(self, db_session, data):
        return data

    assert callable(_apply_decorator(scenario))
    assert callable(_apply_decorator(method))


# ─── 8. Calling forms (GH #394): bound method / selfless, no placeholder ──────


def _make_mapped_service():
    """Instance-method form with a resolvable entity (events/audit machinery)."""
    from src.services.decorators import transactional

    class MappedService:
        entity_name = "records"

        @transactional
        async def create(self, db_session, data):
            return {"data": data}

    return MappedService()


@pytest.mark.asyncio
async def test_method_form_commits_with_named_session():
    """Bound method, session passed by name — the calling convention."""
    svc = _make_mapped_service()
    sess = _MockSession()

    result = await svc.create(db_session=sess, data="kw")

    assert result == {"data": "kw"}
    assert sess.commit_calls == 1


@pytest.mark.asyncio
async def test_method_form_commits_with_positional_session():
    """Bound method, positional call — the instance is args[0], session args[1]."""
    svc = _make_mapped_service()
    sess = _MockSession()

    result = await svc.create(sess, "pos")

    assert result == {"data": "pos"}
    assert sess.commit_calls == 1


@pytest.mark.asyncio
async def test_selfless_form_commits_with_positional_session():
    """Selfless function, positional call — the session is args[0]."""
    decorated = _apply_decorator(_Service.create_default)
    sess = _MockSession()

    result = await decorated(sess, "pos")

    assert result == {"id": 1, "data": "pos"}
    assert sess.commit_calls == 1


@pytest.mark.asyncio
async def test_missing_session_fails_loud_at_call_time():
    """Session neither named nor positional → TypeError at call time."""
    svc = _make_mapped_service()

    with pytest.raises(TypeError, match="not found in call"):
        await svc.create(data="x")
