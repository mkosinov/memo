"""One-off audit of saved logins — User.phone (GH #414, spec §Граничные случаи).

Spec (docs/specs/2026-10-07-phone-field-country-selector-414-design.md,
«Граничные случаи и ограничения v1», нецифровые логины): the login widget keeps
digits only, so an account whose ``User.phone`` reduces to zero digits cannot
log in. Before rollout every stored login must be checked once; offenders are
fixed manually with the user.

This script classifies every ``users.phone`` row:

* ``OK``          — digit-reducible and the calling code is within the curated
  9-country list (or the value carries no calling code at all — bare national
  digits / legacy RU forms, still a working login key);
* ``OUT_OF_LIST`` — reducible, but explicitly international (``+``) with a
  calling code outside the 9-country list (spec: such users still log in by
  digits — informational, not a blocker);
* ``NOT_DIGITS``  — reduction is empty (fully non-digit login — CANNOT log in,
  the case the spec requires to be fixed);
* ``EMPTY``       — NULL / blank.

Read-only: connects to the configured DATABASE_URL in read-only mode, never
writes. Exit code 1 when any ``NOT_DIGITS`` row is found, 0 otherwise.

Usage (from ``backend/``, like scripts/recreate_dev_db.sh):

    uv run python scripts/audit_user_phones.py [--all]

``--all`` lists every row with its classification; by default only offending
rows (NOT_DIGITS / OUT_OF_LIST / EMPTY) are printed.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

# Bootstrap imports from the backend root (script lives in backend/scripts/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.engine import make_url  # noqa: E402

from src.core.config import settings  # noqa: E402
from src.domain.phone_digits import to_national_digits  # noqa: E402

# Unique calling codes of the curated 9-country v1 list (RU and KZ share +7).
# Mirror of PHONE_COUNTRIES in
# frontend/admin/app/components/shared/phone/countries.ts — keep in sync.
CALLING_CODES = frozenset({"7", "375", "49", "371", "370", "48", "380", "372"})
_CODES_LONGEST_FIRST = sorted(CALLING_CODES, key=len, reverse=True)

_DIGITS = re.compile(r"\D+")

OK = "OK"
OUT_OF_LIST = "OUT_OF_LIST"
NOT_DIGITS = "NOT_DIGITS"
EMPTY = "EMPTY"


def classify(phone: str | None) -> tuple[str, str]:
    """Return ``(bucket, detail)`` for one stored ``User.phone`` value."""
    if phone is None or not phone.strip():
        return EMPTY, ""
    if to_national_digits(phone) is None:
        return NOT_DIGITS, "reduces to zero digits"
    digits = _DIGITS.sub("", phone)
    if phone.lstrip().startswith("+"):
        for code in _CODES_LONGEST_FIRST:
            if digits.startswith(code):
                return OK, f"+{code}"
        return OUT_OF_LIST, f"code +{digits[:3]}… not in the 9-country list"
    if len(digits) == 11 and digits[0] in "78":
        return OK, "+7 (legacy trunk form)"
    if len(digits) == 10:
        return OK, "+7 (bare RU national form)"
    return OK, "bare digits, no calling code (RU-default parse)"


def db_path_from_url(url: str) -> Path:
    """Resolve the sqlite file behind the configured DATABASE_URL."""
    parsed = make_url(url)
    if not parsed.get_backend_name().startswith("sqlite"):
        raise SystemExit(f"audit supports SQLite only, got DATABASE_URL={url!r}")
    database = parsed.database or ":memory:"
    if database == ":memory:":
        raise SystemExit("DATABASE_URL points at :memory: — nothing to audit")
    return Path(database).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-off audit of saved logins (User.phone) — GH #414."
    )
    parser.add_argument(
        "--all", action="store_true", help="list every row, not just offenders"
    )
    args = parser.parse_args()

    db_path = db_path_from_url(settings.DATABASE_URL)
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    # Read-only URI: the running dev server is never disturbed.
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT id, phone, is_active FROM users ORDER BY created_at, id"
        ).fetchall()
    finally:
        conn.close()

    counts = {OK: 0, OUT_OF_LIST: 0, NOT_DIGITS: 0, EMPTY: 0}
    classified: list[tuple[str, str | None, int, str, str]] = []
    for user_id, phone, is_active in rows:
        bucket, detail = classify(phone)
        counts[bucket] += 1
        classified.append((user_id, phone, int(is_active), bucket, detail))

    print(f"DB:        {db_path}")
    print(f"total users: {len(rows)}")
    print(
        f"  OK: {counts[OK]}  |  OUT_OF_LIST: {counts[OUT_OF_LIST]}"
        f"  |  NOT_DIGITS: {counts[NOT_DIGITS]}  |  EMPTY: {counts[EMPTY]}"
    )

    offenders = [r for r in classified if r[3] != OK]
    listing = classified if args.all else offenders
    if listing:
        print()
        for user_id, phone, is_active, bucket, detail in listing:
            flag = "" if is_active else "  [inactive]"
            print(f"  {bucket:<12} id={user_id}  phone={phone!r}{flag}  ({detail})")
    elif not args.all:
        print("no offending rows (pass --all to list every row)")

    if counts[NOT_DIGITS]:
        print(
            "\nFAIL: non-digit logins found — fix manually with the users "
            "(spec §Граничные случаи) before accepting #414."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
