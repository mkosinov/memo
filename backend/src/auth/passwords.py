"""Password hashing and policy — GH #247 §3.2.

pwdlib with pinned Argon2id parameters (above the OWASP floor
``m=19 MiB, t=2, p=1``; equal to pwdlib defaults) — pinned explicitly so a
dependency upgrade cannot silently weaken them. Argon2 embeds a per-password
random salt inside the hash string; no separate salt storage exists.

Policy (NIST 800-63B spirit — length over composition, no composition rules):
8–64 characters after trimming edge whitespace, no control characters.
"""

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

PASSWORD_POLICY_HINT_RU = "Пароль: от 8 до 64 символов, пробелы по краям обрезается"

_password_hash = PasswordHash(
    (Argon2Hasher(time_cost=3, memory_cost=65536, parallelism=4),),
)

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 64


class PasswordPolicyError(Exception):
    """Raised by ``validate_password``; message is the human hint."""

    def __init__(self) -> None:
        super().__init__(PASSWORD_POLICY_HINT_RU)
        self.message = PASSWORD_POLICY_HINT_RU


def hash_password(password: str) -> str:
    """Hash a plaintext password with the pinned Argon2id parameters."""
    return _password_hash.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Check a plaintext password against a stored Argon2 hash."""
    return _password_hash.verify(password, stored_hash)


def validate_password(password: str) -> str:
    """Validate against the password policy; return the trimmed password.

    Raises ``PasswordPolicyError`` whose message is the single hint string
    (reused verbatim in the sqladmin form and CLI prompt).
    """
    trimmed = password.strip()
    if not MIN_PASSWORD_LENGTH <= len(trimmed) <= MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError()
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in trimmed):
        raise PasswordPolicyError()
    return trimmed


# Timing parity (spec §3.4): AuthService runs verify against this dummy hash
# when the login phone is unknown, so both branches take similar time.
DUMMY_HASH = hash_password("dummy-for-timing-parity")
