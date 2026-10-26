"""The REAL Telegram channel — Telethon over MTProto (GH #485 part 4
Task 4; spec 2026-10-25-notify-telegram-channel-485-design.md §6; family
#476 US-4).

The first production channel of the registry: messages go out from the
STUDIO'S USER ACCOUNT (not a bot) to the client's phone. Proven
patterns are ported from the cmbot reference (``TelegramUserClient`` —
session handling, the ``InputPhoneContact``/``ImportContactsRequest``
resolve recipe, the send timeout); cmbot's sync thread bridge is
deliberately NOT ported — this worker is asyncio-native (ADR 013).

Pieces:

- the §7 settings triple (``TELEGRAM_API_ID``/``TELEGRAM_API_HASH``/
  ``TELEGRAM_SESSION``) IS availability (spec §6.1): ``is_available``
  checks the settings, never the transport — an unconfigured channel
  named in the priority answers honestly «канал не настроен» (the
  worker's ``unavailable`` outcome) and never burns an attempt;
- ONE lazy client per channel instance (spec §6.1: «один клиент на
  процесс воркера» — the registry builds one telegram instance per
  process, ``build_instances``); ``StringSession`` carries the auth
  state, ``connection_retries=3, retry_delay=1`` per the spec;
- phone normalization to the E.164-like ``+digits`` form (§6.2) with
  the channel's OWN «некорректный формат номера» error — distinct from
  «номер не зарегистрирован в Telegram»;
- the resolve flow (§6.2): ``get_entity(phone)``; on a miss —
  ``InputPhoneContact`` + ``ImportContactsRequest`` (the cmbot recipe;
  the accepted §14 price: the studio account's contacts gain the
  client's phone); a resolve yielding nobody — «номер не зарегистрирован
  в Telegram»;
- the parse mode keyed by the frozen template ORIGIN (§6.2/§5.3): a
  channel template → Telegram HTML; a universal template (``None``) →
  ``parse_mode=None`` — Telegram must not interpret plain text. Markup
  belongs to the channel template alone; the VALUES were already
  HTML-escaped by the worker's assembly (``escape_mode = "html"``,
  §5.3), whatever the template's origin;
- the §6.2 budget: 30 s over the WHOLE channel operation (connect
  check + resolve + send) via ``asyncio.wait_for`` — a hung resolve
  never blocks the sequential worker past its limit;
- the §6.4 error table — LINE BY LINE below in ``_classify``: the
  outcome CATEGORY comes from the exception class, the human specifics
  from the Russian text; class names never reach the journal, a
  numeric RPC code may.

Limits are DECLARED, not enforced here (spec §6.3 — the Task-3 registry
mechanism ``channels/limits.py`` reads ``limits``): pause 30 s, daily
cap 200, the §6.3 service-message address ``TELEGRAM_ADMIN_PHONE``.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import TYPE_CHECKING, Any, Protocol

from telethon import TelegramClient
from telethon import errors as telethon_errors
from telethon.sessions import StringSession
from telethon.tl.functions.contacts import ImportContactsRequest
from telethon.tl.types import InputPhoneContact

from src.core.config import settings
from src.notify.channels.base import (
    ChannelAppError,
    ChannelError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.channels.registry import CHANNELS

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.telegram")

# ── §6.2: module constants ───────────────────────────────────────────────────

#: The §6.2 budget over the whole channel operation (resolve + send).
TELEGRAM_OPERATION_TIMEOUT_SECONDS = 30.0

#: The Telegram HTML parse mode alias (per-call, telethon sanitizes the
#: string to its HTML parser) — channel templates only (§6.2).
PARSE_MODE_HTML = "html"

#: The first name stamped on imported phone contacts (§6.2): the studio
#: account's contact list stays recognizable; the channel never sees
#: client names (the send seam carries address + text only).
CONTACT_FIRST_NAME = "Memo"

#: ``+`` followed by 7-15 digits — the E.164-like shape the channel
#: resolves (E.164 caps the number at 15 digits; shorter than 7 is
#: never a real subscriber number).
_E164_LIKE = re.compile(r"^\+\d{7,15}$")

# ── §6.4: the error table, line by line ──────────────────────────────────────

#: Rows 1 (auth) — also the §6.1 «неавторизованная сессия» gate text.
AUTH_INVALID_MESSAGE = "аккаунт Telegram не авторизован — сессия недействительна"
#: Row 2 — the resolve refusal (family US-4).
PHONE_NOT_REGISTERED_MESSAGE = "номер не зарегистрирован в Telegram"
#: Row 3 — the channel's OWN format line (§6.2: «своя строка»).
INVALID_PHONE_FORMAT_MESSAGE = "некорректный формат номера"
#: Row 4 — PeerFlood. The spec-fixed §6.4 text (the Russian "from"
#: preposition inside is not a Latin confusable).
PEER_FLOOD_MESSAGE = "Telegram ограничил отправку с аккаунта (подозрение в спаме)"  # noqa: RUF001
#: Row 5 — the client blocked the studio account.
USER_BLOCKED_MESSAGE = "клиент заблокировал аккаунт студии"
#: Row 6 — FloodWait: the pause sentence «Telegram просит паузу…»,
#: N = retry_after seconds (the trailing unit is Russian, not Latin).
FLOOD_WAIT_MESSAGE = "Telegram просит паузу {:.0f} с"  # noqa: RUF001
#: Rows 7-8 — network/timeout «канал недоступен: проблема сети».
NETWORK_UNAVAILABLE_MESSAGE = "канал недоступен: проблема сети"
#: Row 9 — прочие RPCError: the numeric code may ride the human text.
RPC_ERROR_MESSAGE = "ошибка Telegram: {}"

#: The §6.1 refusal of an unconfigured channel (the worker normally
#: stops at ``is_available``; this is the send-side guard).
CHANNEL_NOT_CONFIGURED_MESSAGE = "канал не настроен"


def normalize_phone(address: str) -> str:
    """§6.2: a FORMATTED card phone (#414) → the E.164-like
    ``+digits`` form — whitespace, hyphens and parentheses stripped, a
    leading ``+`` and 7-15 digits expected.

    Anything else raises the channel's OWN ``ChannelAppError``
    «некорректный формат номера» — a SEPARATE line from «номер не
    зарегистрирован в Telegram» (§6.4 rows 2/3): a mis-formatted card
    phone is not a Telegram question. No trunk-prefix conversion: the
    stored form is expected to carry the ``+`` (the formatter's output
    shape).
    """
    stripped = re.sub(r"[\s\-()]+", "", address)
    if not _E164_LIKE.match(stripped):
        raise ChannelAppError(INVALID_PHONE_FORMAT_MESSAGE)
    return stripped


def parse_mode_for_origin(template_channel: str | None) -> str | None:
    """§6.2/§5.3: the transport parse mode keyed by the frozen
    template's ORIGIN. A CHANNEL template (this channel's name) was
    written in Telegram HTML — send it with the HTML parser. Anything
    else — the universal template (``None``) and, defensively, a
    foreign origin — goes out with NO parse mode: Telegram must not
    interpret plain text, and markup of another format must never
    activate.
    """
    return PARSE_MODE_HTML if template_channel == "telegram" else None


def _classify(exc: BaseException) -> ChannelError:
    """The §6.4 table, line by line — the outcome CATEGORY from the
    exception class, the specifics from the Russian text. Specific
    RPCError subclasses MUST be matched before the generic ``RPCError``
    row; FloodWait carries ``retry_after`` for the #484 retry mechanics.
    An exception OUTSIDE the table is NOT mapped here — it escapes the
    channel as-is and the worker treats it as a channel bug (§3.2: loud
    trace, app error, no retries).
    """
    if isinstance(
        exc,
        (
            telethon_errors.AuthKeyUnregisteredError,
            telethon_errors.UserDeactivatedError,
        ),
    ):
        return ChannelAppError(AUTH_INVALID_MESSAGE)
    if isinstance(exc, telethon_errors.PeerFloodError):
        return ChannelAppError(PEER_FLOOD_MESSAGE)
    if isinstance(exc, telethon_errors.UserIsBlockedError):
        return ChannelAppError(USER_BLOCKED_MESSAGE)
    if isinstance(exc, telethon_errors.FloodWaitError):
        seconds = float(exc.seconds)
        return ChannelTransportError(
            FLOOD_WAIT_MESSAGE.format(seconds), retry_after=seconds
        )
    if isinstance(exc, telethon_errors.RPCError):
        return ChannelAppError(RPC_ERROR_MESSAGE.format(exc.code))
    # py3.12: asyncio.TimeoutError IS the builtin TimeoutError (UP041).
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return ChannelTransportError(NETWORK_UNAVAILABLE_MESSAGE)
    raise exc


class TelegramClientLike(Protocol):
    """The Telethon seam this channel touches — the unit contour's stub
    implements exactly this surface (spec §13: сеть не трогаем)."""

    async def connect(self) -> Any: ...

    def is_connected(self) -> bool: ...

    async def is_user_authorized(self) -> bool: ...

    async def get_entity(self, phone: str) -> Any: ...

    async def __call__(self, request: Any) -> Any: ...

    async def send_message(
        self, entity: Any, text: str, *, parse_mode: Any = ()
    ) -> Any: ...


def _settings_triple_configured() -> bool:
    """§6.1: заданы все три — ``API_ID`` plus NON-EMPTY hash and session
    (a ``SecretStr("")`` is a set-but-empty secret: not configured)."""
    if settings.TELEGRAM_API_ID is None:
        return False
    api_hash = settings.TELEGRAM_API_HASH
    session = settings.TELEGRAM_SESSION
    if api_hash is None or not api_hash.get_secret_value():
        return False
    return session is not None and bool(session.get_secret_value())


class TelegramChannel:
    """The production Telegram channel (spec §6): ``escape_mode =
    "html"`` — the worker HTML-escapes every payload value at
    substitution whatever the template's origin (§5.3); limits are
    DECLARED from the §7 settings (pause 30 s, cap 200, the admin
    service address, the human name «Telegram») for the Task-3 registry
    mechanism.

    ONE lazy Telethon client per instance — the registry builds one
    telegram channel per worker process (``build_instances``), so the
    client is one per process by construction; it appears on the first
    send and survives across sends (the session state is the StringSession,
    ``connection_retries=3, retry_delay=1`` per the spec).

    The stub seam: an injected ``client`` (the unit contour) replaces
    the real Telethon client entirely — no network, scripted outcomes.
    """

    name = "telegram"
    escape_mode: EscapeMode = "html"

    def __init__(
        self,
        client: TelegramClientLike | None = None,
        *,
        limits: ChannelLimits | None = None,
        timeout: float = TELEGRAM_OPERATION_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._timeout = timeout
        #: The declared limits (§4.4/§6.3) — read from the §7 settings
        #: at construction (the registry wiring: settings are injected
        #: at startup, not read from the DB — ADR 009); a contour may
        #: inject its own window.
        self.limits: ChannelLimits = (
            limits
            if limits is not None
            else ChannelLimits(
                daily_cap=settings.TELEGRAM_DAILY_CAP,
                send_pause_seconds=float(settings.TELEGRAM_SEND_PAUSE),
                admin_address=settings.TELEGRAM_ADMIN_PHONE or None,
                display_name="Telegram",
            )
        )

    async def is_available(self) -> bool:
        """§6.1: the settings triple, nothing else — a cheap probe that
        never touches the transport (no attempt is burned on an
        unavailable channel; a mid-flight outage surfaces through the
        send path's §6.4 mapping)."""
        return _settings_triple_configured()

    async def send(
        self, address: str, text: str, *, template_channel: str | None = None
    ) -> None:
        """Deliver the ASSEMBLED text to the phone ``address`` (§6.2).

        Normalization is instant and precedes any transport touch (a
        bad format never connects); the connect/authorize gate, the
        resolve and the send run under ONE ``asyncio.wait_for`` budget
        (§6.2: 30 секунд на всю операцию канала). Every exception
        of the §6.4 table is mapped to its category + Russian text;
        anything unmapped escapes as a channel bug for the worker's
        §3.2 unclassified path.
        """
        phone = normalize_phone(address)
        client = self._ensure_client()
        try:
            await asyncio.wait_for(
                self._resolve_and_send(
                    client, phone, text, parse_mode_for_origin(template_channel)
                ),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            raise ChannelTransportError(NETWORK_UNAVAILABLE_MESSAGE) from exc
        except ChannelError:
            # Already classified inside (the auth gate, the resolve
            # refusal) — never re-classified, never muted.
            raise
        except Exception as exc:
            raise _classify(exc) from exc

    def _ensure_client(self) -> TelegramClientLike:
        """The lazy one-per-process client (§6.1): the injected stub, or
        the real Telethon client built ONCE from the settings triple —
        an unconfigured triple is the honest «канал не настроен» app
        error (the worker normally stops at ``is_available``)."""
        if self._client is not None:
            return self._client
        if not _settings_triple_configured():
            raise ChannelAppError(CHANNEL_NOT_CONFIGURED_MESSAGE)
        self._client = TelegramClient(
            StringSession(settings.TELEGRAM_SESSION.get_secret_value()),  # type: ignore[union-attr]
            settings.TELEGRAM_API_ID,
            settings.TELEGRAM_API_HASH.get_secret_value(),  # type: ignore[union-attr]
            connection_retries=3,
            retry_delay=1,
        )
        return self._client

    async def _resolve_and_send(
        self, client: TelegramClientLike, phone: str, text: str, parse_mode: str | None
    ) -> None:
        """The gated operation under the §6.2 budget: connect (if
        detached) → authorize → resolve → send."""
        if not client.is_connected():
            await client.connect()
        if not await client.is_user_authorized():
            # The §6.1 gate — the §6.4 row 1 text.
            raise ChannelAppError(AUTH_INVALID_MESSAGE)
        entity = await self._resolve(client, phone)
        await client.send_message(entity, text, parse_mode=parse_mode)

    async def _resolve(self, client: TelegramClientLike, phone: str) -> Any:
        """§6.2: ``get_entity(phone)``; on a miss (ValueError — the
        phone is not in the session cache) import the contact (the
        cmbot recipe) and send to the imported user. A resolve yielding
        nobody — «номер не зарегистрирован в Telegram» (app error: the
        number exists in the card but has no Telegram account).
        """
        try:
            return await client.get_entity(phone)
        except ValueError:
            # Not in the session cache — offer the contact import.
            pass
        result = await client(
            ImportContactsRequest(
                [
                    InputPhoneContact(
                        client_id=0,
                        phone=phone,
                        first_name=CONTACT_FIRST_NAME,
                        last_name="",
                    )
                ]
            )
        )
        imported = getattr(result, "imported", None) or []
        users = getattr(result, "users", None) or []
        if imported and users:
            return users[0]
        raise ChannelAppError(PHONE_NOT_REGISTERED_MESSAGE)


# Registry entry (ADR 011 — bottom-of-module registration; #484 canon).
# The production registry — NO ENV gate (unlike the observability mock):
# a priority naming ``telegram`` is always valid; an unconfigured triple
# answers honestly per-channel («канал не настроен»), never a startup
# crash. The zero-argument factory IS the class (settings are read at
# construction — the worker's startup wiring).
CHANNELS["telegram"] = TelegramChannel
