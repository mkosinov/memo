"""Tests for ErrorCode enum, ErrorDetail schema, and ERROR_MESSAGES registry.

Spec: docs/specs/2026-06-20-error-flow-design.md §5
"""

import pytest

from src.errors import ERROR_MESSAGES, ErrorCode, ErrorDetail

pytestmark = pytest.mark.pure_unit


# ─── ErrorCode Enum ───────────────────────────────────────────────────────────

class TestErrorCodeEnum:
    """Verify ErrorCode has all 34 codes (18 base + 5 GH #247 auth + 6 GH #266 staff + 2 GH #262 files + 3 GH #242 copy-week)."""

    def test_total_code_count(self):
        """All 34 error codes are present (base + auth + staff #266 + files #262 + copy-week #242)."""
        assert len(ErrorCode) == 34

    def test_expected_codes_exist(self):
        """Every code from spec §5 (plus auth/staff additions) exists."""
        expected = {
            # 409
            "ACTIVITY_AT_CAPACITY",
            "CLIENT_DUPLICATE_PHONE",
            # 403 — GH #247 auth
            "AUTH_FORBIDDEN",
            # 401/429 — GH #247 auth
            "AUTH_INVALID_CREDENTIALS",
            "AUTH_UNAUTHORIZED",
            "AUTH_LOCKED_OUT",
            # 422 — password policy (GH #247 auth)
            "PASSWORD_POLICY",
            # 404
            "ACTIVITY_NOT_FOUND",
            "RECORD_NOT_FOUND",
            "CLIENT_NOT_FOUND",
            "LOCATION_NOT_FOUND",
            "MASTER_NOT_FOUND",
            "SERVICE_NOT_FOUND",
            "TAG_NOT_FOUND",
            "PHOTO_NOT_FOUND",
            "MATERIAL_NOT_FOUND",
            "VISITOR_NOT_FOUND",
            "VISIT_NOT_FOUND",
            "PAYMENT_NOT_FOUND",
            "SETTINGS_NOT_FOUND",
            # 422
            "VALIDATION_ERROR",
            "INTEGRITY_VIOLATION",
            # 500
            "INTERNAL_ERROR",
            # GH #266 staff restructuring («Контракты ошибок»)
            "STAFF_NOT_FOUND",       # 404 — /staff/{id} отсутствует
            "MASTER_NOT_ACTIVE",     # 422 — занятие на неактивного мастера (TOCTOU)
            "POSITION_NOT_FOUND",    # 404 — /positions/{id} отсутствует
            "POSITION_IS_SYSTEM",    # 422 — удаление встроенной должности
            "SPECIALTY_REQUIRED",    # 422 — мастер-секция без специальности
            "COLOR_REQUIRED",        # 422 — мастер-секция без цвета
            # GH #262 Task 2 — avatar uploads (spec §3.4/§4)
            "FILE_TOO_LARGE",        # 413 — over the 5 MB limit
            "FILE_INVALID_TYPE",     # 415 — not JPEG/PNG/WebP
            # GH #242 — schedule copy-week (spec §4)
            "COPY_WEEK_START_NOT_MONDAY",  # week_start is not a Monday
            "COPY_WEEK_INVALID_LOCATION",  # unknown location id in the request
            "COPY_WEEK_SOURCE_TOO_LARGE",  # > 100 rows to insert — copy in passes
        }
        actual = {code.value for code in ErrorCode}
        assert actual == expected

    def test_enum_values_are_strings(self):
        """ErrorCode values serialize as plain strings (JSON-safe)."""
        for code in ErrorCode:
            assert isinstance(code.value, str)
            assert isinstance(str(code), str)

    def test_enum_is_str_subclass(self):
        """ErrorCode(str, Enum) allows direct string comparison."""
        assert ErrorCode.ACTIVITY_AT_CAPACITY == "ACTIVITY_AT_CAPACITY"
        assert isinstance(ErrorCode.ACTIVITY_AT_CAPACITY, str)


# ─── ErrorDetail Schema ───────────────────────────────────────────────────────

class TestErrorDetail:
    """Verify ErrorDetail Pydantic model serializes correctly."""

    def test_creates_with_valid_fields(self):
        detail = ErrorDetail(code="ACTIVITY_NOT_FOUND", message="Activity not found")
        assert detail.code == "ACTIVITY_NOT_FOUND"
        assert detail.message == "Activity not found"

    def test_model_dump_returns_dict(self):
        detail = ErrorDetail(code="TAG_NOT_FOUND", message="Tag not found")
        dumped = detail.model_dump()
        assert dumped == {"code": "TAG_NOT_FOUND", "message": "Tag not found"}

    def test_model_dump_json(self):
        """model_dump_json produces valid JSON string."""
        detail = ErrorDetail(code="INTERNAL_ERROR", message="Server error")
        json_str = detail.model_dump_json()
        assert '"code":"INTERNAL_ERROR"' in json_str
        assert '"message":"Server error"' in json_str

    def test_from_dict(self):
        """ErrorDetail can be constructed from a dict (for exception handlers)."""
        data = {"code": "VALIDATION_ERROR", "message": "Bad input"}
        detail = ErrorDetail(**data)
        assert detail.code == "VALIDATION_ERROR"

    def test_roundtrip(self):
        """model_dump → ErrorDetail produces same values."""
        original = ErrorDetail(code="CLIENT_NOT_FOUND", message="Client not found")
        restored = ErrorDetail(**original.model_dump())
        assert original == restored


# ─── ERROR_MESSAGES Registry ──────────────────────────────────────────────────

class TestErrorMessages:
    """Verify ERROR_MESSAGES has an entry for every ErrorCode."""

    def test_has_entry_for_every_code(self):
        """Every ErrorCode has a Russian message in ERROR_MESSAGES."""
        for code in ErrorCode:
            assert code in ERROR_MESSAGES, f"Missing ERROR_MESSAGES entry for {code.value}"

    def test_total_count_matches(self):
        """ERROR_MESSAGES has exactly 34 entries (one per ErrorCode)."""
        assert len(ERROR_MESSAGES) == 34

    def test_all_values_are_strings(self):
        """Every message is a non-empty string."""
        for code, msg in ERROR_MESSAGES.items():
            assert isinstance(msg, str), f"Message for {code.value} is not a string"
            assert len(msg) > 0, f"Message for {code.value} is empty"

    def test_specific_messages(self):
        """Spot-check key messages against spec §5."""
        assert ERROR_MESSAGES[ErrorCode.ACTIVITY_AT_CAPACITY] == "Недостаточно мест"
        assert ERROR_MESSAGES[ErrorCode.INTERNAL_ERROR] == "Ошибка сервера"
        assert (
            ERROR_MESSAGES[ErrorCode.CLIENT_DUPLICATE_PHONE]
            == "Клиент с таким телефоном уже существует"
        )
        assert (
            ERROR_MESSAGES[ErrorCode.VALIDATION_ERROR]
            == "Проверьте правильность заполнения полей"
        )
        assert (
            ERROR_MESSAGES[ErrorCode.INTEGRITY_VIOLATION]
            == "Нарушение целостности данных"
        )
