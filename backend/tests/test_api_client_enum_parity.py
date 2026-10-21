"""Enum dictionary parity: api-client named schemas vs backend enums (GH #480, spec §6).

Reads ``packages/api-client/src/schemas.ts`` and compares the literal SETS of
the six named contract enum schemas (§3.1) with the backend enum values —
a guard against drift of the manual mirror. Parity is by SET, not order:
declaration order in schemas.ts is the client UI order (e.g. ChannelSchema:
``telegram, whatsapp, max``) and deliberately differs from ``enums.py``.
"""

from __future__ import annotations

import enum
import re
from pathlib import Path

import pytest

from src.domain.visit_status import VisitStatus
from src.models.enums import (
    ArchiveStatus,
    Channel,
    PaymentMethod,
    TariffAudience,
    UserRole,
)

# Named schema in packages/api-client/src/schemas.ts → backend enum (source of truth).
PARITY: dict[str, type[enum.Enum]] = {
    "VisitStatusSchema": VisitStatus,
    "PaymentMethodSchema": PaymentMethod,
    "ChannelSchema": Channel,
    "UserRoleSchema": UserRole,
    "TariffAudienceSchema": TariffAudience,
    "ArchiveStatusSchema": ArchiveStatus,
}

# backend/tests/<this file> → three levels up is the repo root (worktree-safe).
REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMAS_TS = REPO_ROOT / "packages" / "api-client" / "src" / "schemas.ts"

# export const XSchema = z.enum(['a', 'b', ...])
_Z_ENUM_RE = re.compile(r"export\s+const\s+(\w+)\s*=\s*z\.enum\(\s*\[([^]]*)]")


def _named_enum_literals(source: str) -> dict[str, set[str]]:
    """Map every named ``z.enum`` declaration to its set of string literals."""
    literals: dict[str, set[str]] = {}
    for match in _Z_ENUM_RE.finditer(source):
        name, body = match.group(1), match.group(2)
        literals[name] = set(re.findall(r"['\"]([^'\"]+)['\"]", body))
    return literals


@pytest.fixture(scope="module")
def ts_enum_literals() -> dict[str, set[str]]:
    """Literal sets parsed from the api-client schemas file (read once)."""
    assert SCHEMAS_TS.is_file(), f"api-client schemas not found at {SCHEMAS_TS}"
    return _named_enum_literals(SCHEMAS_TS.read_text(encoding="utf-8"))


pytestmark = [pytest.mark.unit, pytest.mark.pure_unit]


@pytest.mark.parametrize("schema_name", sorted(PARITY))
def test_named_enum_literals_match_backend(
    schema_name: str, ts_enum_literals: dict[str, set[str]]
) -> None:
    """The manual enum mirror must not drift from backend enum values (#480 §6)."""
    assert schema_name in ts_enum_literals, (
        f"{schema_name} is not declared as `export const {schema_name} = z.enum([...])` "
        "in packages/api-client/src/schemas.ts — named contract enum missing or "
        "renamed (#480 §3.1)"
    )
    backend_values = {member.value for member in PARITY[schema_name]}
    missing = backend_values - ts_enum_literals[schema_name]
    extra = ts_enum_literals[schema_name] - backend_values
    assert not missing and not extra, (
        f"{schema_name} literal drift against backend "
        f"{PARITY[schema_name].__name__}: missing={sorted(missing)}, "
        f"extra={sorted(extra)} (parity is by SET, not order — #480 §6)"
    )
