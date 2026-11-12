"""Account phone validation — the #348 single source of the rule.

Spec §4 (docs/specs/2026-09-27-user-accounts-348-design.md): one shared
validator used by BOTH account-phone writers — the composite staff-card
«Учётка» creation block (``UserService.create_staff_account``) and the
phone-edit scenario (``usecases/user.py::update_user_phone``).

The rule is the pre-existing schema/DB constraint, now with a DOMAIN
error instead of a generic VALIDATION_ERROR: edge whitespace trimmed,
1-20 characters after trimming (``User.phone`` is ``String(20)``).
Uniqueness stays EXACT-STRING («по точной строке») — no `+7 999…` /
`+7999…` normalization is introduced here (changing that would break
existing accounts' logins); see :class:`PhoneTakenError` for the
duplicate side.
"""

from __future__ import annotations

import re

from src.domain.errors import PhoneInvalidError, PhoneTakenError

# The phone-domain facade: consumers import the rule AND its errors from
# one place (``create_staff_account`` / ``update_user_phone`` raise both).
__all__ = [
    "MAX_PHONE_LENGTH",
    "PhoneInvalidError",
    "PhoneTakenError",
    "pretty_phone",
    "validate_canonical_phone",
    "validate_phone",
]

# ``User.phone`` is String(20); the account phone is a login key, not a
# parsed number — length only (the pre-#348 schema constraint).
MAX_PHONE_LENGTH = 20

#: The canonical client-auth wire format (#593 spec §Эндпоинты): the
#: callcheck initiate body must be the EXACT ``+7XXXXXXXXXX`` string.
#: Stricter than the account-phone rule above on purpose: a typo must
#: surface as a 422 before any gate or provider work, not hide behind a
#: 503 («опечатка не прячется под 503»). The frontend normalizes to this
#: form; the server check is the backstop.
_CANONICAL_RU_PHONE = re.compile(r"\+7\d{10}")


def validate_phone(value: str) -> str:
    """Validate an account phone; return the trimmed string.

    Raises :class:`PhoneInvalidError` (route → 422 ``PHONE_INVALID``)
    when the trimmed value is blank or longer than 20 characters.
    """
    trimmed = value.strip()
    if not trimmed or len(trimmed) > MAX_PHONE_LENGTH:
        raise PhoneInvalidError(value)
    return trimmed


def validate_canonical_phone(value: str) -> str:
    """Validate the canonical ``+7XXXXXXXXXX`` form; return it unchanged.

    The client-auth callcheck wire format (#593 §Эндпоинты): edge
    whitespace is trimmed (the ``validate_phone`` tolerance), everything
    else must match exactly — no domestic ``8…`` form, no pretty
    printing, no foreign prefixes. Raises :class:`PhoneInvalidError`
    (route → 422 ``PHONE_INVALID`` BEFORE gates and provider).
    """
    trimmed = value.strip()
    if not _CANONICAL_RU_PHONE.fullmatch(trimmed):
        raise PhoneInvalidError(value)
    return trimmed


def pretty_phone(phone: str) -> str:
    """``+79995552255`` → ``+7 999 555-22-55`` — the call-screen form.

    Display-only (the initiate response's ``pretty``); dialling always
    uses the canonical ``phone`` value with its ``tel:`` link.
    """
    return f"{phone[:2]} {phone[2:5]} {phone[5:8]}-{phone[8:10]}-{phone[10:12]}"
