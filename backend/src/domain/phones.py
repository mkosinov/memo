"""Account phone validation — the #348 single source of the rule.

Spec §4 (docs/specs/2026-09-27-user-accounts-348-design.md): one shared
validator used by BOTH account-phone writers — the composite staff-card
«Учётка» creation block (``UserService.create_staff_account``) and the
phone-edit scenario (``usecases/user.py::update_user_phone``).

The rule is the pre-existing schema/DB constraint, now with a DOMAIN
error instead of a generic VALIDATION_ERROR: edge whitespace trimmed,
1–20 characters after trimming (``User.phone`` is ``String(20)``).
Uniqueness stays EXACT-STRING («по точной строке») — no `+7 999…` /
`+7999…` normalization is introduced here (changing that would break
existing accounts' logins); see :class:`PhoneTakenError` for the
duplicate side.
"""

from __future__ import annotations

from src.domain.errors import PhoneInvalidError, PhoneTakenError

# The phone-domain facade: consumers import the rule AND its errors from
# one place (``create_staff_account`` / ``update_user_phone`` raise both).
__all__ = [
    "MAX_PHONE_LENGTH",
    "PhoneInvalidError",
    "PhoneTakenError",
    "validate_phone",
]

# ``User.phone`` is String(20); the account phone is a login key, not a
# parsed number — length only (the pre-#348 schema constraint).
MAX_PHONE_LENGTH = 20


def validate_phone(value: str) -> str:
    """Validate an account phone; return the trimmed string.

    Raises :class:`PhoneInvalidError` (route → 422 ``PHONE_INVALID``)
    when the trimmed value is blank or longer than 20 characters.
    """
    trimmed = value.strip()
    if not trimmed or len(trimmed) > MAX_PHONE_LENGTH:
        raise PhoneInvalidError(value)
    return trimmed
