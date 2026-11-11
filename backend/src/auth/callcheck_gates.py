"""Callcheck initiate gates — in-memory, one 15-minute window (#593 Task 3).

The initiate-flow rate state the Task 2 store deliberately does not own
(«Rate gates are NOT here — they are initiate-flow state (Task 3)»).
Mechanics mirror ``otp_send_gate`` (``src/auth/service.py`` — fixed
15-minute windows anchored at the first counted event, no background
job), with the #593 §Гейты numbers:

- 5 initiates per phone / 15 min;
- 20 per client IP / 15 min;
- at most 5 DISTINCT phones per IP / 15 min (a repeat initiate to an
  already-seen phone does not grow the set);
- a GLOBAL ceiling — 100 initiates / 15 min per process — tripping it
  answers fail-closed 503 (NOT a per-caller 429): it cuts
  wallet-driven IP rotation, so the caller must see an availability
  failure, not a personal lockout.

Registration happens ONLY on provider success (spec §Эндпоинты — the
deliberate deviation from ``otp_service.issue``, where the send is
counted before the transport call): a refused/failed initiate consumes
nothing. The windows are SEPARATE from the OTP counters — same numbers,
own budget per method.

In-memory single-process store (spec risk №7, the OTP assumption).
Numbers are code-owned constants («пересмотр константы — кодом»).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Гейты
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException

from src.auth.service import AuthService
from src.errors import ErrorCode, ErrorDetail
from src.util.utc import utc_now

#: One window for every wire here (the OTP 15-minute value).
CALL_INITIATE_WINDOW = timedelta(minutes=15)

CALL_PHONE_THRESHOLD = 5
CALL_IP_THRESHOLD = 20
CALL_DISTINCT_PHONES_PER_IP = 5

#: The global per-process ceiling (spec §Гейты): at the background of
#: ~tens of logins/month this is a 100x headroom. Tripping it is an
#: availability failure (503), not a caller lockout.
CALL_INITIATE_GLOBAL_CAP = 100

# Module-level counter store: key → (count, window start). The count
# resets whenever a registration arrives after the previous window
# expired (the ``_FAILURE_COUNTERS`` mechanics).
_COUNTERS: dict[str, tuple[int, datetime]] = {}

# Distinct-phone tracker per IP: ip → (phones seen, window start). A set,
# not a count — the limit is «не более 5 разных номеров на один IP».
_PHONES_PER_IP: dict[str, tuple[set[str], datetime]] = {}

# The single global window: (count, window start); None until the first
# registration anchors the window.
_GLOBAL: tuple[int, datetime] | None = None


def _prune(now: datetime) -> None:
    """Drop counter entries whose window expired (called on each access)."""
    expired = [k for k, (_, started) in _COUNTERS.items()
               if now - started >= CALL_INITIATE_WINDOW]
    for key in expired:
        del _COUNTERS[key]
    expired_ips = [k for k, (_, started) in _PHONES_PER_IP.items()
                   if now - started >= CALL_INITIATE_WINDOW]
    for key in expired_ips:
        del _PHONES_PER_IP[key]


def _bump(key: str, now: datetime) -> None:
    """Count one event; restart the window if the previous one expired."""
    entry = _COUNTERS.get(key)
    if entry is None or now - entry[1] >= CALL_INITIATE_WINDOW:
        _COUNTERS[key] = (1, now)
        return
    _COUNTERS[key] = (entry[0] + 1, entry[1])


def _threshold_for(key: str) -> int:
    """``call:ip:`` keys gate at 20, phone keys at 5."""
    return CALL_IP_THRESHOLD if key.startswith("call:ip:") else CALL_PHONE_THRESHOLD


def _counter_exception(key: str, now: datetime) -> HTTPException | None:
    """429 (with Retry-After) when ``key``'s counter is at/over threshold."""
    entry = _COUNTERS.get(key)
    if entry is None:
        return None
    count, started = entry
    if count < _threshold_for(key):
        return None
    if now - started >= CALL_INITIATE_WINDOW:
        return None  # stale window — does not block
    remaining = max(
        1, int((CALL_INITIATE_WINDOW - (now - started)).total_seconds())
    )
    return AuthService._locked_out(retry_after=remaining)


def _phones_exception(
    phone: str, client_ip: str, now: datetime
) -> HTTPException | None:
    """429 when this initiate would add a 6th distinct phone for the IP.

    The limit is on the COUNT of distinct numbers — a repeat initiate to
    an already-seen phone does not grow the set and stays governed by
    the 5/phone and 20/IP wires.
    """
    entry = _PHONES_PER_IP.get(client_ip)
    if entry is None:
        return None
    phones, started = entry
    if phone in phones or len(phones) < CALL_DISTINCT_PHONES_PER_IP:
        return None
    if now - started >= CALL_INITIATE_WINDOW:
        return None  # stale window — does not block
    remaining = max(
        1, int((CALL_INITIATE_WINDOW - (now - started)).total_seconds())
    )
    return AuthService._locked_out(retry_after=remaining)


def _global_exception(now: datetime) -> HTTPException | None:
    """503 fail-closed when the per-process ceiling is tripped.

    Not a 429: the ceiling defends the provider wallet against IP
    rotation — the individual caller did nothing wrong, so the answer is
    the availability code (the same shape the off-transport initiate
    gives), never a personal lockout.
    """
    if _GLOBAL is None:
        return None
    count, started = _GLOBAL
    if count < CALL_INITIATE_GLOBAL_CAP:
        return None
    if now - started >= CALL_INITIATE_WINDOW:
        return None  # stale window — does not block
    return HTTPException(
        status_code=503,
        detail=ErrorDetail(
            code=ErrorCode.NOTIFICATION_TRANSPORT_UNAVAILABLE,
            message="Вход временно недоступен",
        ).model_dump(),
    )


def call_initiate_gate(phone: str, client_ip: str) -> HTTPException | None:
    """Pre-work gate for a callcheck initiate (#593 §Гейты).

    Spec order: phone wire, IP wire, distinct-phones wire, global
    ceiling. Returns the 429/503 to raise, or None when allowed.
    """
    now = utc_now()
    _prune(now)
    for key in (f"call_send:phone:{phone}", f"call:ip:{client_ip}"):
        exc = _counter_exception(key, now)
        if exc is not None:
            return exc
    exc = _phones_exception(phone, client_ip, now)
    if exc is not None:
        return exc
    return _global_exception(now)


def register_call_initiate(phone: str, client_ip: str) -> None:
    """Count one PERFORMED initiate on every window.

    Called only after the provider accepted the check AND the row
    transaction committed — a provider failure or a failed write must
    not consume any budget (spec §Эндпоинты).
    """
    global _GLOBAL
    now = utc_now()
    _bump(f"call_send:phone:{phone}", now)
    _bump(f"call:ip:{client_ip}", now)

    entry = _PHONES_PER_IP.get(client_ip)
    if entry is None or now - entry[1] >= CALL_INITIATE_WINDOW:
        _PHONES_PER_IP[client_ip] = ({phone}, now)
    else:
        entry[0].add(phone)

    if _GLOBAL is None or now - _GLOBAL[1] >= CALL_INITIATE_WINDOW:
        _GLOBAL = (1, now)
    else:
        _GLOBAL = (_GLOBAL[0] + 1, _GLOBAL[1])
