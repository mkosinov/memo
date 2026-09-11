"""GH #247 §3.2: pwdlib/Argon2 password hashing + policy validation.

Pure unit tests — no DB, no app. Covers:
- hash/verify round-trip with the pinned Argon2 parameters;
- the password policy (8–64 chars after edge-trim, no control chars);
- the single human hint constant reused at every password-creation site.
"""

import pytest

from src.auth.passwords import (
    DUMMY_HASH,
    PASSWORD_POLICY_HINT_RU,
    PasswordPolicyError,
    hash_password,
    validate_password,
    verify_password,
)

pytestmark = pytest.mark.pure_unit


class TestHashVerify:
    """Hash/verify round-trip via pinned Argon2 (spec §3.2)."""

    def test_hash_differs_from_input(self) -> None:
        pw = "correct horse battery"
        assert hash_password(pw) != pw

    def test_hash_is_argon2id_with_pinned_params(self) -> None:
        """Pinned m=65536, t=3, p=4 — an upgrade must not silently weaken them."""
        digest = hash_password("pin-me-123")
        assert digest.startswith("$argon2id$")
        assert "m=65536,t=3,p=4" in digest

    def test_verify_round_trip(self) -> None:
        pw = "s3cret-password"
        assert verify_password(pw, hash_password(pw)) is True

    def test_verify_wrong_password(self) -> None:
        stored = hash_password("s3cret-password")
        assert verify_password("wrong-password", stored) is False

    def test_two_hashes_of_same_password_differ(self) -> None:
        """Salt is random per password and embedded in the hash string."""
        pw = "same-password"
        assert hash_password(pw) != hash_password(pw)

    def test_dummy_hash_verifies_against_its_plaintext(self) -> None:
        """Timing-parity dummy — AuthService runs verify against it when
        the user is not found, so both login branches take similar time."""
        assert verify_password("dummy-for-timing-parity", DUMMY_HASH) is True


class TestValidatePassword:
    """Policy: 8–64 chars after edge-trim, no control chars (§3.2)."""

    def test_accepts_8_chars(self) -> None:
        assert validate_password("12345678") == "12345678"

    def test_rejects_7_chars(self) -> None:
        with pytest.raises(PasswordPolicyError):
            validate_password("1234567")

    def test_accepts_64_chars(self) -> None:
        pw = "a" * 64
        assert validate_password(pw) == pw

    def test_rejects_65_chars(self) -> None:
        with pytest.raises(PasswordPolicyError):
            validate_password("a" * 65)

    @pytest.mark.parametrize("pw", ["pass\tword1", "pass\nword1", "pass\x00word1"])
    def test_rejects_control_chars(self, pw: str) -> None:
        with pytest.raises(PasswordPolicyError):
            validate_password(pw)

    def test_trims_edges_before_length_check(self) -> None:
        assert validate_password("  12345678 ") == "12345678"

    def test_trimmed_below_minimum_rejected(self) -> None:
        with pytest.raises(PasswordPolicyError):
            validate_password("   1234567   ")


class TestPolicyError:
    """The exception carries the single hint message (reused verbatim in UI)."""

    def test_message_is_the_hint(self) -> None:
        with pytest.raises(PasswordPolicyError) as exc:
            validate_password("short")
        assert exc.value.message == PASSWORD_POLICY_HINT_RU
        assert str(exc.value) == PASSWORD_POLICY_HINT_RU

    def test_hint_text_matches_spec(self) -> None:
        assert PASSWORD_POLICY_HINT_RU == (
            "Пароль: от 8 до 64 символов, пробелы по краям обрезаются"
        )
