"""GH #485 Task 4 (part 4 of the notify family #476; spec
2026-10-25-notify-telegram-channel-485-design.md §6/§7) — the REAL
Telegram channel (Telethon/MTProto).

Unit contour ONLY — the Telethon client is a STUB (spec §13: «реальный
канал — заглушка Telethon-клиента, сеть не трогаем»); no Redis, no DB.

Covered:

- §7 settings: the six ``TELEGRAM_*`` keys with their spec defaults and
  types (``SecretStr`` for the hash/session; existing notify settings
  untouched);
- §6.1 availability: ``is_available`` is exactly the settings triple
  (``TELEGRAM_API_ID`` + ``TELEGRAM_API_HASH`` + ``TELEGRAM_SESSION``)
  — no transport probing;
- §6.1 declarations: ``name``/``escape_mode = "html"`` and the limits
  read from the §7 settings (pause 30 s default, cap 200 default, the
  admin address, the human display name «Telegram»);
- §6.2 phone normalization: formatted card phones → the E.164-like
  ``+digits`` form; anything else — the channel's OWN «некорректный
  формат номера» app error;
- §6.2 resolve: ``get_entity`` hit → no contact import; miss →
  ``InputPhoneContact`` + ``ImportContactsRequest`` (the cmbot recipe);
  a resolve that yields no user — «номер не зарегистрирован в
  Telegram»;
- §6.2 parse mode by template ORIGIN: a channel template → HTML, a
  universal template (``template_channel=None``) → no parse mode (the
  §5.3 rule «разметка принадлежит только шаблону канала»);
- §6.2 the 30 s budget over the whole channel operation (resolve +
  send): a hung stub → the network transport error;
- §6.4 the error table LINE BY LINE: every row maps to its outcome
  category with the exact Russian journal text (never a class name),
  ``FloodWaitError`` → ``transport_error`` carrying ``retry_after``;
- §6.1 the connect + ``is_user_authorized`` gate before every send
  (an unauthorized session — the §6.4 auth row);
- §3.3 registration: the module registers itself in ``CHANNELS`` under
  ``"telegram"`` (the production registry — no ENV gate).
"""

import asyncio

import pytest
from pydantic import SecretStr
from telethon.tl.functions.contacts import ImportContactsRequest

from src.core.config import settings
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.channels.registry import CHANNELS

pytestmark = pytest.mark.unit

#: The §4.2 rev.5 send kwarg of a channel-template task (origin
#: threading, spec §6.2 parse-mode rule).
CHANNEL_TEMPLATE_ORIGIN = "telegram"


# ── the Telethon stub (spec §13 — the network is never touched) ──────────────


class StubTelegramClient:
    """The Telethon seam for the unit contour: records every call and
    scripts outcomes (authorization, resolve behavior, raised errors).

    Mirrors the real client surface the channel touches:
    ``connect``/``is_connected``/``is_user_authorized``,
    ``get_entity(phone)``, ``__call__(ImportContactsRequest)``,
    ``send_message(entity, text, parse_mode=...)``.
    """

    def __init__(
        self,
        *,
        authorized: bool = True,
        connected: bool = True,
        resolve: str = "direct",
        raise_connect: BaseException | None = None,
        raise_authorized: BaseException | None = None,
        raise_get_entity: BaseException | None = None,
        raise_send: BaseException | None = None,
        send_delay: float = 0.0,
    ) -> None:
        self._authorized = authorized
        self._connected = connected
        #: ``direct`` — get_entity resolves (no import);
        #: ``import`` — get_entity raises ValueError, the contact import
        #: yields a user; ``none`` — get_entity misses AND the import
        #: brings nobody back.
        self._resolve = resolve
        self.raise_connect = raise_connect
        self.raise_authorized = raise_authorized
        self.raise_get_entity = raise_get_entity
        self.raise_send = raise_send
        self._send_delay = send_delay
        #: every (call, detail) the channel made — the assertion surface.
        self.calls: list[tuple[str, object]] = []
        #: resolved phones (the NORMALIZED form the channel must pass).
        self.resolved_phones: list[str] = []
        #: the send_message kwargs per call (entity/text/parse_mode).
        self.sends: list[dict[str, object]] = []

    async def connect(self) -> None:
        self.calls.append(("connect", None))
        if self.raise_connect is not None:
            raise self.raise_connect
        self._connected = True

    def is_connected(self) -> bool:
        return self._connected

    async def is_user_authorized(self) -> bool:
        self.calls.append(("is_user_authorized", None))
        if self.raise_authorized is not None:
            raise self.raise_authorized
        return self._authorized

    async def get_entity(self, phone: str) -> object:
        self.calls.append(("get_entity", phone))
        self.resolved_phones.append(phone)
        if self.raise_get_entity is not None:
            raise self.raise_get_entity
        if self._resolve == "direct":
            return f"entity:{phone}"
        raise ValueError(f"Could not find the input entity for {phone}")

    async def __call__(self, request: object) -> object:
        assert isinstance(request, ImportContactsRequest)
        contact = request.contacts[0]
        assert isinstance(contact.phone, str)
        self.calls.append(("import_contacts", contact.phone))
        if self._resolve == "import":

            class _User:
                pass

            user = _User()
            imported = ["imported-contact"]
            users = [user]
        else:
            imported = []
            users = []

        class _Result:
            pass

        result = _Result()
        result.imported = imported  # type: ignore[attr-defined]
        result.users = users  # type: ignore[attr-defined]
        return result

    async def send_message(
        self, entity: object, text: str, *, parse_mode: object = ()
    ) -> None:
        self.calls.append(("send_message", None))
        if self._send_delay:
            await asyncio.sleep(self._send_delay)
        if self.raise_send is not None:
            raise self.raise_send
        self.sends.append(
            {"entity": entity, "text": text, "parse_mode": parse_mode}
        )


def _telegram_module() -> object:
    """Lazy import of the channel module — the settings tests above stay
    green while the module itself is still RED."""
    from src.notify.channels import telegram

    return telegram


def _channel(
    stub: StubTelegramClient | None = None,
    **kwargs: object,
) -> object:
    mod = _telegram_module()
    return mod.TelegramChannel(stub, **kwargs)  # type: ignore[attr-defined]


PHONE = "+7 (999) 123-45-67"
PHONE_E164 = "+79991234567"
TEXT = "Анна, вы записаны на «Гончарный мастер-класс»"


# ── §7: the settings ─────────────────────────────────────────────────────────


class TestTelegramSettings:
    """§7: six new keys, spec defaults and types; the EXISTING notify
    settings keep their values (the §7 «существующие без изменений»)."""

    def test_defaults_match_the_spec_table(self) -> None:
        assert settings.TELEGRAM_API_ID is None
        assert settings.TELEGRAM_API_HASH is None
        assert settings.TELEGRAM_SESSION is None
        assert settings.TELEGRAM_ADMIN_PHONE is None
        assert settings.TELEGRAM_SEND_PAUSE == 30
        assert settings.TELEGRAM_DAILY_CAP == 200

    def test_secrets_are_secret_str(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            settings, "TELEGRAM_API_HASH", SecretStr("hash-value")
        )
        monkeypatch.setattr(
            settings, "TELEGRAM_SESSION", SecretStr("session-value")
        )
        assert isinstance(settings.TELEGRAM_API_HASH, SecretStr)
        assert isinstance(settings.TELEGRAM_SESSION, SecretStr)
        assert "hash-value" not in repr(settings.TELEGRAM_API_HASH)
        assert "session-value" not in repr(settings.TELEGRAM_SESSION)

    def test_existing_notify_settings_untouched(self) -> None:
        assert settings.NOTIFY_CHANNEL_PRIORITY == "telegram"
        assert settings.NOTIFY_SEND_RETRIES == 3


# ── §6.1: availability — the settings triple, nothing else ───────────────────


def _configure_triple(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TELEGRAM_API_ID", 12345)
    monkeypatch.setattr(settings, "TELEGRAM_API_HASH", SecretStr("hash"))
    monkeypatch.setattr(settings, "TELEGRAM_SESSION", SecretStr("session"))


class TestAvailability:
    """§6.1: ``is_available`` = заданы все три (API_ID, API_HASH,
    SESSION) — a cheap settings check, NO transport probe (an
    unavailable channel never burns an attempt)."""

    async def test_full_triple_is_available(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_triple(monkeypatch)
        channel = _channel(StubTelegramClient())

        assert await channel.is_available() is True  # type: ignore[attr-defined]

    async def test_any_missing_piece_is_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _configure_triple(monkeypatch)
        channel = _channel(StubTelegramClient())
        for attr, value in (
            ("TELEGRAM_API_ID", None),
            ("TELEGRAM_API_HASH", None),
            ("TELEGRAM_API_HASH", SecretStr("")),
            ("TELEGRAM_SESSION", None),
            ("TELEGRAM_SESSION", SecretStr("")),
        ):
            monkeypatch.setattr(settings, attr, value)
            assert await channel.is_available() is False, (  # type: ignore[attr-defined]
                f"{attr}={value!r} must make the channel unavailable"
            )

    async def test_unconfigured_send_refuses_without_a_transport(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No injected client + no settings triple → the honest §6.1
        «канал не настроен» app error (the worker normally stops at
        ``is_available``; this is the defensive guard)."""
        monkeypatch.setattr(settings, "TELEGRAM_API_ID", None)
        monkeypatch.setattr(settings, "TELEGRAM_API_HASH", None)
        monkeypatch.setattr(settings, "TELEGRAM_SESSION", None)
        channel = _channel(None)

        with pytest.raises(ChannelAppError, match="канал не настроен"):
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]


# ── §6.1: the declarations (name, escape mode, limits) ───────────────────────


class TestDeclarations:
    def test_channel_identity(self) -> None:
        channel = _channel(StubTelegramClient())
        assert channel.name == "telegram"  # type: ignore[attr-defined]
        assert channel.escape_mode == "html"  # type: ignore[attr-defined]

    def test_limits_read_the_settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "TELEGRAM_SEND_PAUSE", 45)
        monkeypatch.setattr(settings, "TELEGRAM_DAILY_CAP", 77)
        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_PHONE", "+79990000001")

        channel = _channel(StubTelegramClient())

        limits = channel.limits  # type: ignore[attr-defined]
        assert isinstance(limits, ChannelLimits)
        assert limits.daily_cap == 77
        assert limits.send_pause_seconds == 45
        assert limits.admin_address == "+79990000001"
        assert limits.display_name == "Telegram"

    def test_no_admin_phone_is_no_service_address(self) -> None:
        channel = _channel(StubTelegramClient())

        assert channel.limits.admin_address is None  # type: ignore[attr-defined]

    def test_channel_satisfies_the_protocol(self) -> None:
        assert isinstance(_channel(StubTelegramClient()), Channel)


# ── §6.2: phone normalization ─────────────────────────────────────────────────


class TestPhoneNormalization:
    """The card stores a FORMATTED phone (#414) — the channel strips the
    formatting to the E.164-like ``+digits`` form BEFORE the resolve;
    anything not ``+``-led digits (7-15) gets the channel's OWN format
    error, never «номер не зарегистрирован»."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("+7 (999) 123-45-67", "+79991234567"),
            ("+7 999 123 45 67", "+79991234567"),
            ("+7-999-123-45-67", "+79991234567"),
            ("+7(999)123 45-67", "+79991234567"),
            ("+79991234567", "+79991234567"),
            ("+12125550123", "+12125550123"),  # 11 digits, another country
        ],
    )
    async def test_formatted_phones_resolve_normalized(
        self, raw: str, expected: str
    ) -> None:
        stub = StubTelegramClient()
        channel = _channel(stub)

        await channel.send(raw, TEXT)  # type: ignore[attr-defined]

        assert stub.resolved_phones == [expected]
        assert len(stub.sends) == 1

    @pytest.mark.parametrize(
        "raw",
        [
            "89991234567",           # no leading + (trunk prefix)
            "8 999 123 45 67",
            "+7 999 123 45 6a",      # a letter survives the strip
            "+7-999",                # too short after the strip
            "+799912345678901234",   # too long (E.164 caps at 15 digits)
            "",                      # empty address
            "not-a-phone",
        ],
    )
    async def test_bad_format_is_the_own_app_error(self, raw: str) -> None:
        stub = StubTelegramClient()
        channel = _channel(stub)

        with pytest.raises(ChannelAppError, match="некорректный формат номера"):
            await channel.send(raw, TEXT)  # type: ignore[attr-defined]

        # the format check precedes ANY transport touch
        assert stub.calls == []


# ── §6.2: resolve (get_entity → import contacts → refusal) ───────────────────


class TestResolve:
    async def test_direct_resolve_never_imports(self) -> None:
        stub = StubTelegramClient(resolve="direct")
        channel = _channel(stub)

        await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert ("import_contacts", PHONE_E164) not in stub.calls
        assert len(stub.sends) == 1
        assert stub.sends[0]["entity"] == f"entity:{PHONE_E164}"

    async def test_miss_resolves_through_contact_import(self) -> None:
        """The cmbot recipe: ``get_entity`` misses (ValueError) →
        ``InputPhoneContact`` + ``ImportContactsRequest`` → the imported
        user becomes the send target."""
        stub = StubTelegramClient(resolve="import")
        channel = _channel(stub)

        await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert ("import_contacts", PHONE_E164) in stub.calls
        assert len(stub.sends) == 1
        # the send target is the IMPORTED user, not a phone string
        assert stub.sends[0]["entity"] is not None
        assert stub.sends[0]["entity"] != PHONE_E164

    async def test_import_bringing_nobody_is_not_registered(self) -> None:
        """The family US-4 line: a resolve that yields no user —
        «номер не зарегистрирован в Telegram», an app error (never
        retried, never «проблема сети»)."""
        stub = StubTelegramClient(resolve="none")
        channel = _channel(stub)

        with pytest.raises(
            ChannelAppError, match="номер не зарегистрирован в Telegram"
        ):
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert stub.sends == []


# ── §6.2: parse mode by the template's ORIGIN ────────────────────────────────


class TestParseMode:
    """§5.3/§6.2: markup belongs to the CHANNEL template alone. A
    channel template (``template_channel == "telegram"``) goes out with
    the Telegram HTML parse mode; a UNIVERSAL template goes out with
    parse_mode=None — Telegram must not interpret plain text."""

    async def test_channel_template_sends_html(self) -> None:
        stub = StubTelegramClient()
        channel = _channel(stub)

        await channel.send(  # type: ignore[attr-defined]
            PHONE, TEXT, template_channel=CHANNEL_TEMPLATE_ORIGIN
        )

        assert stub.sends[0]["parse_mode"] == "html"

    async def test_universal_template_sends_no_parse_mode(self) -> None:
        stub = StubTelegramClient()
        channel = _channel(stub)

        await channel.send(PHONE, TEXT, template_channel=None)  # type: ignore[attr-defined]

        assert stub.sends[0]["parse_mode"] is None

    async def test_default_origin_is_plain(self) -> None:
        """The §6.3 admin service message calls send WITHOUT an origin —
        it must go out plain (the sentinel default distinguishes
        «explicit None» from «not passed» in the stub)."""
        stub = StubTelegramClient()
        channel = _channel(stub)

        await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert stub.sends[0]["parse_mode"] is None


# ── §6.4: the error table, line by line ──────────────────────────────────────


def _telethon_error(name: str) -> BaseException:
    from telethon import errors

    cls = getattr(errors, name)
    return cls(request=None)


class TestErrorTable:
    """Every §6.4 row: the telethon error CLASS maps to its outcome
    category (app vs transport) with the EXACT Russian journal text —
    class names never leak into the message."""

    @pytest.mark.parametrize(
        ("exc_factory", "expected_class", "expected_text"),
        [
            (
                lambda: _telethon_error("AuthKeyUnregisteredError"),
                ChannelAppError,
                "аккаунт Telegram не авторизован — сессия недействительна",
            ),
            (
                lambda: _telethon_error("UserDeactivatedError"),
                ChannelAppError,
                "аккаунт Telegram не авторизован — сессия недействительна",
            ),
            (
                lambda: _telethon_error("PeerFloodError"),
                ChannelAppError,
                "Telegram ограничил отправку с аккаунта (подозрение в спаме)",
            ),
            (
                lambda: _telethon_error("UserIsBlockedError"),
                ChannelAppError,
                "клиент заблокировал аккаунт студии",
            ),
            (
                lambda: _telethon_error("PhoneNumberInvalidError"),
                ChannelAppError,
                "ошибка Telegram: 400",
            ),
            (
                lambda: ConnectionError("socket hang up"),
                ChannelTransportError,
                "канал недоступен: проблема сети",
            ),
            (
                lambda: TimeoutError("operation timed out"),
                ChannelTransportError,
                "канал недоступен: проблема сети",
            ),
        ],
    )
    async def test_send_errors_map_to_the_table(
        self,
        exc_factory: "type",
        expected_class: type,
        expected_text: str,
    ) -> None:
        stub = StubTelegramClient(raise_send=exc_factory())
        channel = _channel(stub)

        with pytest.raises(expected_class) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == expected_text
        # the Gate B #484 rule: exception class names never surface
        assert "Error" not in str(excinfo.value)

    async def test_floodwait_is_transport_with_retry_after(self) -> None:
        """§6.4: FloodWaitError → transport_error carrying the requested
        pause («Telegram просит паузу N с») — the #484 retry mechanics
        ride it."""
        from telethon.errors import FloodWaitError

        stub = StubTelegramClient(raise_send=FloodWaitError(request=None, capture=42))
        channel = _channel(stub)

        with pytest.raises(ChannelTransportError) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == "Telegram просит паузу 42 с"
        assert excinfo.value.retry_after == 42.0

    async def test_auth_error_at_connect_maps_to_the_auth_row(self) -> None:
        exc = _telethon_error("AuthKeyUnregisteredError")
        stub = StubTelegramClient(connected=False, raise_connect=exc)
        channel = _channel(stub)

        with pytest.raises(ChannelAppError) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == (
            "аккаунт Telegram не авторизован — сессия недействительна"
        )

    async def test_rpc_error_at_resolve_maps_to_the_rpc_row(self) -> None:
        exc = _telethon_error("PhoneNumberInvalidError")
        stub = StubTelegramClient(raise_get_entity=exc)
        channel = _channel(stub)

        with pytest.raises(ChannelAppError) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == "ошибка Telegram: 400"


# ── §6.1: the connect + authorization gate before every send ─────────────────


class TestAuthGate:
    async def test_unauthorized_session_is_the_auth_row(self) -> None:
        stub = StubTelegramClient(authorized=False)
        channel = _channel(stub)

        with pytest.raises(ChannelAppError) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == (
            "аккаунт Telegram не авторизован — сессия недействительна"
        )
        assert stub.sends == []

    async def test_disconnected_client_connects_before_sending(self) -> None:
        stub = StubTelegramClient(connected=False)
        channel = _channel(stub)

        await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert ("connect", None) in stub.calls
        assert len(stub.sends) == 1

    async def test_connected_client_skips_connect(self) -> None:
        stub = StubTelegramClient(connected=True)
        channel = _channel(stub)

        await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert ("connect", None) not in stub.calls


# ── §6.2: the 30 s budget over the whole channel operation ───────────────────


class TestOperationTimeout:
    async def test_hung_operation_is_the_network_transport_error(self) -> None:
        """A send that never completes within the budget is cut by the
        operation timeout — «канал недоступен: проблема сети», retried
        per the transport budget like any outage."""
        stub = StubTelegramClient(send_delay=0.2)
        channel = _channel(stub, timeout=0.05)

        with pytest.raises(ChannelTransportError) as excinfo:
            await channel.send(PHONE, TEXT)  # type: ignore[attr-defined]

        assert str(excinfo.value) == "канал недоступен: проблема сети"
        assert excinfo.value.retry_after is None


# ── §3.3: registration in the production registry ────────────────────────────


class TestRegistration:
    def test_module_registers_the_production_channel(self) -> None:
        import src.notify.channels.telegram  # noqa: F401 — the registration import

        assert "telegram" in CHANNELS

    def test_registry_factory_builds_the_channel(self) -> None:
        import src.notify.channels.telegram  # noqa: F401 — the registration import

        instance = CHANNELS["telegram"]()

        assert instance.name == "telegram"
        assert isinstance(instance, Channel)
