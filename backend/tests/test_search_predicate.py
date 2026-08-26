"""Pure unit tests for repositories/search.py (GH #212). No DB."""

import pytest
from sqlalchemy import ColumnElement

from src.models.client import Client
from src.repositories.search import SearchField, search_predicate

pytestmark = pytest.mark.pure_unit


def _sql(pred: ColumnElement[bool]) -> str:
    return str(pred.compile(compile_kwargs={"literal_binds": True})).lower()


def test_substring_field_builds_escaped_ilike() -> None:
    pred = search_predicate("иван", [SearchField(Client.name)])
    sql = _sql(pred)
    assert "lower(" in sql  # ilike compiles via lower() — the M5 override target
    assert "%иван%" in sql


def test_wildcards_escaped() -> None:
    pred = search_predicate("100%_x", [SearchField(Client.name)])
    sql = _sql(pred)
    assert "\\%" in sql and "\\_" in sql and "escape" in sql


def test_full_uuid_adds_id_equality_normalized() -> None:
    uid = "123E4567-E89B-12D3-A456-426614174000"  # uppercase on purpose
    pred = search_predicate(uid, [SearchField(Client.name), SearchField(Client.id, kind="uuid")])
    sql = _sql(pred)
    assert "123e4567-e89b-12d3-a456-426614174000" in sql  # normalized lowercase


def test_partial_uuid_never_matches_id() -> None:
    pred = search_predicate(
        "123e4567", [SearchField(Client.name), SearchField(Client.id, kind="uuid")]
    )
    sql = _sql(pred)
    assert "like" in sql  # only the substring clause survives
    assert "clients.id =" not in sql  # no id equality for a partial UUID


def test_exact_kind_matches_always() -> None:
    pred = search_predicate("https://ya.ru/maps/x", [SearchField(Client.email, kind="exact")])
    assert "=" in _sql(pred)


def test_empty_fields_raise() -> None:
    with pytest.raises(ValueError):
        search_predicate("ab", [])
