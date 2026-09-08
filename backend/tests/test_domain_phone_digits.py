"""GH #221 §3: national-digit reduction for phone matching.

Two levels:
- pure unit tests of ``to_national_digits`` (spec §3 rule, edge cases);
- SQL registration probe: ``memo_phone_national`` must be callable on every
  new SQLite connection (registered next to the Cyrillic-safe ``lower()``
  override in src/db/database.py, same event-listener mechanism).
"""

import pytest

pytestmark = pytest.mark.pure_unit


class TestToNationalDigits:
    """Spec §3: strip non-digits; drop leading 7/8 of an 11-digit RU number."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            # 11 digits starting 7/8 → leading digit dropped
            ("+79991234567", "9991234567"),
            ("8 999 123-45-67", "9991234567"),
            ("89991234567", "9991234567"),
            ("+7 (999) 123-45-67", "9991234567"),
            ("72345678901", "2345678901"),
            # Already-national 10-digit RU number — untouched
            ("9991234567", "9991234567"),
            ("999-123-45-67", "9991234567"),
            # Foreign numbers — untouched (not 11 digits)
            ("+375 29 123-45-67", "375291234567"),
            ("+49 170 1234567", "491701234567"),
            # 11 digits starting 1 — untouched: only 7/8 strip (spec §3 rule 2)
            ("12345678901", "12345678901"),
            # Tolerant degenerates
            ("abc", None),
            ("", None),
            (None, None),
        ],
    )
    def test_reduction(self, value: str | None, expected: str | None) -> None:
        from src.domain.phone_digits import to_national_digits

        assert to_national_digits(value) == expected


class TestMemoPhoneNationalSqlFunction:
    """The SQL UDF mirrors to_national_digits on every SQLite connection."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("+79991234567", "9991234567"),
            ("8 999 123-45-67", "9991234567"),
            ("+375 29 123-45-67", "375291234567"),
            (None, None),  # NULL in → NULL out → LIKE NULL is NULL → never matches
        ],
    )
    async def test_sql_function_registered(self, tmp_path, value, expected) -> None:
        from sqlalchemy import text

        from src.db.database import DBManager

        manager = DBManager(f"sqlite+aiosqlite:///{tmp_path / 'udf_test.db'}")
        try:
            async with manager.engine.connect() as conn:
                got = (
                    await conn.execute(
                        text("SELECT memo_phone_national(:v)"), {"v": value}
                    )
                ).scalar()
            assert got == expected
        finally:
            await manager.engine.dispose()

    async def test_sql_like_null_never_matches(self, tmp_path) -> None:
        """Spec §3: NULL phone never matches — LIKE on NULL yields NULL (falsy)."""
        from sqlalchemy import text

        from src.db.database import DBManager

        manager = DBManager(f"sqlite+aiosqlite:///{tmp_path / 'udf_null.db'}")
        try:
            async with manager.engine.connect() as conn:
                got = (
                    await conn.execute(
                        text(
                            "SELECT memo_phone_national(NULL) LIKE '%' || '999' || '%'"
                        )
                    )
                ).scalar()
            assert not got
        finally:
            await manager.engine.dispose()
