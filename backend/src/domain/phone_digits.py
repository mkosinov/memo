"""National-digit phone reduction — spec #221 §3, single source of the rule.

Both the SQL UDF (``memo_phone_national``, registered in src/db/database.py)
and the Python query-value binding go through ``to_national_digits`` so the
reduction exists exactly once.
"""

import re

_NON_DIGITS = re.compile(r"\D+")


def to_national_digits(value: str | None) -> str | None:
    """Spec §3: strip non-digits; drop the leading 7/8 of an 11-digit RU number.

    Tolerant by design — never parses, never raises; NULL/empty/no-digits -> None.
    """
    if not value:
        return None
    digits = _NON_DIGITS.sub("", value)
    if not digits:
        return None
    if len(digits) == 11 and digits[0] in "78":
        digits = digits[1:]
    return digits
