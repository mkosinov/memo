"""#482 Task 7 (spec §3.5, family #476 §4.1): notify text rendering.

``src/notify/render.py`` renders a §4.1 snapshot through a sandboxed
Jinja2 template taken from ``notify_templates``:

- ``SandboxedEnvironment`` + ``StrictUndefined`` + ``autoescape=False``
  (neutral markup — Markdown common denominator);
- filters ``fmt_dt`` (stored naive value → ``%d.%m.%Y %H:%M``, same
  interpretation as the past/future predicate — no conversion) and
  ``money`` (``1000`` → ``1 000 ₽``);
- MARKUP control chars (``*``, ``_``, `` ` ``, ``[``, ``]``) are
  neutralized in snapshot STRING VALUES before substitution — never in
  the template's own markup;
- template selection by ``event_type`` with fallback to ``is_default``;
  complete absence → render error (the 3-attempts path of Task 9).

The default-template tests render the ACTUAL seeded body by loading
``_DEFAULT_TEMPLATE_BODY`` from the migration file (the session test DB
is built via ``create_all`` — the seed row lives only in migrations).
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from jinja2.exceptions import SecurityError, UndefinedError

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.notify.models import NotifyTemplate
from src.notify.render import RenderError, fmt_dt, money, render_event

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_MIGRATION_FILE = (
    _BACKEND_DIR / "alembic" / "versions" / "c970adc6b3d6_notify_subsystem_tables.py"
)


def _load_default_body() -> str:
    """The actual §3.5 seed body — imported from the migration module."""
    spec = importlib.util.spec_from_file_location("notify_seed_migration", _MIGRATION_FILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._DEFAULT_TEMPLATE_BODY


_DEFAULT_BODY = _load_default_body()


def _snapshot(**overrides) -> dict:
    """Full §4.1 snapshot — every top-level key present, real values."""
    snap = {
        "event": {
            "type": "new_record",
            "occurred_at": "2026-10-20T10:00:00Z",
            "record_id": "rec-1",
        },
        "client": {"id": "c-1", "name": "Анна", "phone": "+79990000000"},
        # stored naive local business time, AS IS (spec §3.2)
        "activity": {"start": "2026-11-05T18:00:00", "duration": 90},
        "service": {"title": "Гончарный мастер-класс"},
        "tariffs": [
            {"title": "Базовый", "price": 1000},
            {"title": "Базовый", "price": 1500},
        ],
        "total_price": 2500,
        "location": {
            "title": "Студия «Горы»",
            "address": "ул. Ленина, 1",
            "map_url": "https://yandex.ru/maps/?text=stub",
        },
        "master": {"name": "Иванова Мария"},
    }
    snap.update(overrides)
    return snap


async def _add_template(
    db_session,
    *,
    event_type: str,
    body: str,
    is_default: bool = False,
) -> None:
    db_session.add(
        NotifyTemplate(
            event_type=event_type,
            title=f"тест {uuid.uuid4().hex[:6]}",
            body=body,
            is_default=is_default,
        )
    )
    await db_session.flush()


# ─── Filters (pure) ───────────────────────────────────────────────────────────


class TestFilters:
    pytestmark = pytest.mark.pure_unit

    def test_fmt_dt_formats_stored_naive_iso(self) -> None:
        assert fmt_dt("2026-11-05T18:00:00") == "05.11.2026 18:00"

    def test_fmt_dt_accepts_datetime_object(self) -> None:
        from datetime import datetime

        assert fmt_dt(datetime(2026, 1, 2, 3, 4)) == "02.01.2026 03:04"

    def test_money_thousands_and_currency(self) -> None:
        assert money(1000) == "1\u00a0000 ₽"
        assert money(2500) == "2\u00a0500 ₽"
        assert money(1000000) == "1\u00a0000\u00a0000 ₽"

    def test_money_small_amount_has_no_separator(self) -> None:
        assert money(250) == "250 ₽"


# ─── render_event (DB: template lookup) ───────────────────────────────────────


class TestRenderEvent:
    pytestmark = pytest.mark.integration

    async def test_full_snapshot_renders_seeded_default_template(
        self, db_session
    ) -> None:
        await _add_template(
            db_session, event_type="new_record", body=_DEFAULT_BODY, is_default=True
        )

        text = await render_event(db_session, "new_record", _snapshot())

        assert "Анна, здравствуйте! Вы записаны на «Гончарный мастер-класс»" in text
        assert "— 05.11.2026 18:00 (90 мин)" in text
        assert "Студия «Горы», ул. Ленина, 1 (https://yandex.ru/maps/?text=stub)." in text
        assert "Ведёт Иванова Мария." in text
        assert "«Базовый» — 1\u00a0000 ₽; «Базовый» — 1\u00a0500 ₽;" in text
        assert "Итого: 2\u00a0500 ₽." in text

    async def test_null_fields_do_not_break_default_template(self, db_session) -> None:
        """§4.1 null VALUES (not missing keys) — {% if %} guards hold."""
        await _add_template(
            db_session, event_type="new_record", body=_DEFAULT_BODY, is_default=True
        )
        snap = _snapshot(
            client={"id": "c-1", "name": None, "phone": "+79990000000"},
            tariffs=[{"title": None, "price": 1000}],
            total_price=1000,
            location={"title": "Студия «Горы»", "address": None, "map_url": None},
            master={"name": None},
        )

        text = await render_event(db_session, "new_record", snap)

        # null client name → capital-З branch; no address/map/master chunks
        assert "Здравствуйте! Вы записаны" in text
        assert "Ведёт" not in text
        assert "ул. Ленина" not in text
        assert "yandex.ru" not in text
        assert "Итого: 1\u00a0000 ₽." in text

    async def test_missing_key_is_render_error(self, db_session) -> None:
        """StrictUndefined: a MISSING top-level key must fail the render."""
        await _add_template(
            db_session, event_type="new_record", body=_DEFAULT_BODY, is_default=True
        )
        snap = _snapshot()
        del snap["service"]

        with pytest.raises(RenderError) as excinfo:
            await render_event(db_session, "new_record", snap)

        assert isinstance(excinfo.value.__cause__, UndefinedError)

    async def test_sandbox_blocks_dunder_attribute_access(self, db_session) -> None:
        await _add_template(
            db_session, event_type="new_record", body="{{ ''.__class__ }}"
        )

        with pytest.raises(RenderError) as excinfo:
            await render_event(db_session, "new_record", _snapshot())

        assert isinstance(excinfo.value.__cause__, SecurityError)

    async def test_control_chars_in_client_name_neutralized(self, db_session) -> None:
        """Client input containing ``*_[`` must not become markup; the
        template's OWN ``*`` stays active (autoescape=False — this is
        Markdown-level escaping, not HTML)."""
        raw_name = "Анна*[x]_`н"
        await _add_template(
            db_session, event_type="new_record", body="*{{ client.name }}*"
        )
        snap = _snapshot(client={"id": "c-1", "name": raw_name, "phone": "+7999"})

        text = await render_event(db_session, "new_record", snap)

        # every control char backslash-prefixed: * _ ` [ ]
        assert text == "*Анна" + r"\*\[x\]\_\`" + "н*"
        # escaping works on a copy — the journal snapshot stays untouched
        assert snap["client"]["name"] == raw_name

    async def test_event_type_template_preferred_over_default(self, db_session) -> None:
        await _add_template(
            db_session,
            event_type="new_record",
            body="DEFAULT {{ service.title }}",
            is_default=True,
        )
        await _add_template(
            db_session, event_type="other_event", body="TYPED {{ service.title }}"
        )

        text = await render_event(db_session, "other_event", _snapshot())

        assert text == "TYPED Гончарный мастер-класс"

    async def test_fallback_to_default_template(self, db_session) -> None:
        await _add_template(
            db_session,
            event_type="new_record",
            body="DEFAULT {{ service.title }}",
            is_default=True,
        )
        await _add_template(
            db_session, event_type="other_event", body="TYPED {{ service.title }}"
        )

        text = await render_event(db_session, "unmapped_event", _snapshot())

        assert text == "DEFAULT Гончарный мастер-класс"

    async def test_no_template_at_all_is_render_error(self, db_session) -> None:
        with pytest.raises(RenderError, match="template"):
            await render_event(db_session, "new_record", _snapshot())
