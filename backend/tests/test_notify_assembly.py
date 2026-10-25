"""#485 Task 2 (part 4 of the notify family #476; spec §5.2/§5.3, ADR
014) — worker-side text ASSEMBLY: the per-channel escape variant of the
part-1 sandbox.

``assemble_text`` gains the escape-mode dimension keyed by the TASK'S
CHANNEL (spec §5.3), never by the template's origin:

- ``escape_mode="html"`` (telegram): every payload VALUE is HTML-escaped
  at substitution (Jinja ``autoescape``) — a universal template
  (``channel IS NULL``, plain text) on a telegram task still escapes
  values (the §13 CROSS CASE), while the channel template's OWN markup
  (``<b>`` etc.) stays active: markup belongs to the template, data
  stays data;
- ``escape_mode="none"`` (the mock, the default): plain text — values
  go out verbatim;
- preserved from part 1 in BOTH variants: ``StrictUndefined`` (a
  missing payload key is an assembly error) and the neutralization of
  markup control chars in payload string values (spec §5.2: «строгие
  неопределённые, нейтрализация контрольных символов — сохраняются»).
"""

import pytest

from src.notify.assembly import RenderError, assemble_text

pytestmark = pytest.mark.pure_unit

#: A §4.1-shaped payload slice — only the keys the test templates use.
_PAYLOAD = {
    "client": {"id": "c-1", "name": "Анна", "phone": "+79990000000"},
    "service": {"title": "Гончарный мастер-класс"},
    "total_price": 2500,
}


# ── escape_mode="html" (a telegram task) ─────────────────────────────────────


class TestHtmlEscapeMode:
    def test_cross_case_universal_template_x_telegram_task(self) -> None:
        """Spec §13: a UNIVERSAL template (plain text, no channel
        markup) on a telegram task — the VALUE's ``<`` and ``&`` go out
        HTML-escaped: escaping is keyed by the task's channel, not by
        the template's origin (spec §5.3)."""
        body = "{{ client.name }}, вы записаны на «{{ service.title }}»"
        payload = {
            "client": {"id": "c-1", "name": "Анна", "phone": "+7999"},
            "service": {"title": "Керамика <начальный> & гончарное дело"},
        }

        text = assemble_text(body, payload, escape_mode="html")

        assert text == "Анна, вы записаны на «Керамика &lt;начальный&gt; &amp; гончарное дело»"

    def test_channel_template_markup_stays_active_values_escaped(self) -> None:
        """A CHANNEL template on its channel: the template's own HTML
        markup stays ACTIVE, the substituted values are escaped — «раз-
        метка принадлежит только шаблону канала, данные остаются
        данными» (spec §5.3)."""
        body = "<b>{{ service.title }}</b> — итог {{ total_price | money }}"

        text = assemble_text(body, _PAYLOAD, escape_mode="html")

        assert text == "<b>Гончарный мастер-класс</b> — итог 2\u00a0500 ₽"

    def test_channel_template_value_with_markup_chars_is_escaped(self) -> None:
        """The hostile-value case inside a channel template: a client
        name carrying ``<b>`` cannot inject markup on behalf of the
        studio."""
        body = "<b>{{ client.name }}</b>, здравствуйте!"

        text = assemble_text(body, {"client": {"name": "<b>Анна</b> & Co"}}, escape_mode="html")

        assert text == "<b>&lt;b&gt;Анна&lt;/b&gt; &amp; Co</b>, здравствуйте!"

    def test_template_literal_markup_is_not_double_escaped(self) -> None:
        """The template's OWN ``&`` (e.g. inside a literal entity or a
        URL) is author-controlled markup — the environment must not
        escape the TEMPLATE, only substituted values."""
        body = "Студия «Горы» — карта &amp; маршрут"

        text = assemble_text(body, _PAYLOAD, escape_mode="html")

        assert text == "Студия «Горы» — карта &amp; маршрут"


# ── escape_mode="none" (the mock; the default) ───────────────────────────────


class TestNoneEscapeMode:
    def test_plain_mode_passes_values_verbatim(self) -> None:
        """Plain text (the mock, universal previews): ``<``/``&`` are
        just characters — nothing to escape without a channel parse
        mode (spec §5.3: «универсальный шаблон — простой текст …
        отправляется без канального parse-режима»)."""
        body = "{{ client.name }} — {{ service.title }}"

        text = assemble_text(body, {"client": {"name": "А&B"}, "service": {"title": "<класс>"}}, escape_mode="none")

        assert text == "А&B — <класс>"

    def test_default_mode_is_none(self) -> None:
        """The default keeps the part-1 call sites (render_event preview
        etc.) plain without spelling the keyword."""
        text = assemble_text("{{ service.title }}", _PAYLOAD)

        assert text == "Гончарный мастер-класс"


# ── part-1 behaviors preserved in BOTH variants (spec §5.2) ─────────────────


class TestPreservedSandboxBehaviors:
    def test_control_chars_neutralized_in_plain_mode(self) -> None:
        """Part-1 neutralization: ``*_[`` etc. are backslash-prefixed in
        payload STRING VALUES, the template's own ``*`` stays active."""
        body = "*{{ client.name }}*"

        text = assemble_text(body, {"client": {"name": "Анна*[x]"}}, escape_mode="none")

        assert text == "*Анна" + r"\*\[x\]" + "*"

    def test_control_chars_neutralized_in_html_mode(self) -> None:
        """Spec §5.2: the neutralization survives in the HTML variant —
        on top of it, not instead of it."""
        body = "*{{ client.name }}*"

        text = assemble_text(body, {"client": {"name": "Анна*[x]"}}, escape_mode="html")

        assert text == "*Анна" + r"\*\[x\]" + "*"

    def test_strict_undefined_in_plain_mode_is_render_error(self) -> None:
        with pytest.raises(RenderError):
            assemble_text("{{ missing.key }}", _PAYLOAD, escape_mode="none")

    def test_strict_undefined_in_html_mode_is_render_error(self) -> None:
        with pytest.raises(RenderError):
            assemble_text("{{ missing.key }}", _PAYLOAD, escape_mode="html")

    def test_payload_is_never_mutated_in_html_mode(self) -> None:
        """Escaping/neutralization work on a copy — the frozen task
        payload (already the source of retries) stays untouched."""
        payload = {"client": {"name": "Анна*[x]<b>"}}

        assemble_text("{{ client.name }}", payload, escape_mode="html")

        assert payload == {"client": {"name": "Анна*[x]<b>"}}


# ── the mode vocabulary is closed ────────────────────────────────────────────


class TestEscapeModeVocabulary:
    def test_unknown_mode_is_a_loud_value_error(self) -> None:
        """A channel declaring a mode outside ``none | html`` (spec
        §6.1) is a programming error — loud and immediate, never a
        silent fallback to plain text."""
        with pytest.raises(ValueError, match="escape_mode"):
            assemble_text("текст", _PAYLOAD, escape_mode="banana")
