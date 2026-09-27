"""Tests for ErrorCode enum, ErrorDetail schema, and ERROR_MESSAGES registry.

Spec: docs/specs/2026-06-20-error-flow-design.md §5
GH #324 Task 5 (spec §4.1): the delete-family FORM 422s live here — the
one suite that runs them for ALL six routes at once.
"""

import uuid as _uuid

import pytest

from src.errors import ERROR_MESSAGES, ErrorCode, ErrorDetail

# GH #324 Task 5: this file now mixes a pure_unit registry suite and an
# api-level DELETE-form suite — the marks live on the classes (a module
# pure_unit mark would skip reset_db for the api tests and break the
# per-test admin INSERT).
# ─── ErrorCode Enum ───────────────────────────────────────────────────────────

@pytest.mark.pure_unit
class TestErrorCodeEnum:
    """Verify ErrorCode has all 36 codes (18 base + 5 GH #247 auth + 6 GH #266 staff + 2 GH #262 files + 3 GH #242 copy-week + 2 GH #286 deferred-delete)."""

    def test_total_code_count(self):
        """All 36 error codes are present (base + auth + staff #266 + files #262 + copy-week #242 + deferred-delete #286)."""
        assert len(ErrorCode) == 36

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
            # GH #285 rev7 / GH #286 D2 — unified deferred-delete contract
            "EXPECTED_STATE_REQUIRED",     # 422 — bare DELETE without the flag
            "INVALID_DELETE_REQUEST",      # 422 — dry_run + body combo
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

@pytest.mark.pure_unit
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

@pytest.mark.pure_unit
class TestErrorMessages:
    """Verify ERROR_MESSAGES has an entry for every ErrorCode."""

    def test_has_entry_for_every_code(self):
        """Every ErrorCode has a Russian message in ERROR_MESSAGES."""
        for code in ErrorCode:
            assert code in ERROR_MESSAGES, f"Missing ERROR_MESSAGES entry for {code.value}"

    def test_total_count_matches(self):
        """ERROR_MESSAGES has exactly 36 entries (one per ErrorCode)."""
        assert len(ERROR_MESSAGES) == 36

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


# ─── GH #324 §4.1: the delete-family FORM 422s (all six routes) ──────────────


@pytest.mark.api
class TestDeleteFamilyForm422:
    """The FORM transport of the six #324 DELETE routes — checked BEFORE
    any DB access (spec §4.1: «форма ничего не сообщает о существовании»).

    Parametrized over the six routes on CANNOT-EXIST ids: the form check
    must fire before the existence probe, so a never-existing id still
    gets the 422 — pinning the order for every subject at once (the
    per-entity files carry the busy-subject depth; the four guarded
    routes' scope-404s are pinned there, on existing foreign rows).

    Cases (the full §4.1 form matrix):

    * bare DELETE (no flag, no body) → 422 ``expected_state_required``;
    * resolutions-only body → 422 ``expected_state_required`` (the
      rejected legacy shape);
    * ``?dry_run=true`` + resolutions body → 422
      ``dry_run_with_resolutions_forbidden`` (also on a never-existing
      id — the combo check precedes the probe);
    * ``?dry_run=true`` + expected-only body → legal shape, silently
      ignored (no resolutions to forbid): a leaf route previews 204;
      the dependent routes' 409 preview is pinned per-entity.
    """

    MISSING = "00000000-0000-0000-0000-000000000000"

    ROUTES = (
        "/api/v1/visits",
        "/api/v1/payments",
        "/api/v1/photos",
        "/api/v1/user-settings",
        "/api/v1/visitors",
        "/api/v1/positions",
    )

    @pytest.mark.parametrize("prefix", ROUTES)
    def test_bare_delete_returns_422_before_probe(self, api_client, prefix) -> None:
        """§4.1: no flag, no body → 422 expected_state_required — even on
        a cannot-exist id (the form precedes the existence probe)."""
        resp = api_client.delete(f"{prefix}/{self.MISSING}")
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"

    @pytest.mark.parametrize("prefix", ROUTES)
    def test_resolutions_without_expected_returns_422(
        self, api_client, prefix,
    ) -> None:
        """§4.1: resolutions-only body is the rejected legacy shape → 422
        expected_state_required (form check, not an existence probe)."""
        resp = api_client.request(
            "DELETE", f"{prefix}/{self.MISSING}",
            json={"resolutions": {"photo_tags": "cascade"}},
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"

    @pytest.mark.parametrize("prefix", ROUTES)
    def test_dry_run_with_resolutions_returns_422_before_probe(
        self, api_client, prefix,
    ) -> None:
        """§4.1: dry_run + resolutions → 422
        dry_run_with_resolutions_forbidden — a pure preview never carries
        execution choices; the combo check runs before the probe."""
        for path in (
            f"{prefix}/{self.MISSING}",
            f"{prefix}/no-such-{_uuid.uuid4().hex[:6]}",
        ):
            resp = api_client.request(
                "DELETE", path,
                params={"dry_run": "true"},
                json={"resolutions": {"visits": "cascade"}},
            )
            assert resp.status_code == 422, f"{path}: {resp.text}"
            assert (
                resp.json()["detail"] == "dry_run_with_resolutions_forbidden"
            )

    @pytest.mark.parametrize(
        "prefix", ["/api/v1/visits", "/api/v1/payments", "/api/v1/user-settings"],
    )
    def test_dry_run_with_expected_only_body_ignored_leaf_204(
        self, api_client, prefix, create_record,
    ) -> None:
        """§4.1 combinatorics: dry_run + expected-only body → legal shape,
        silently ignored — a leaf's empty preview answers 204 (the
        dependent routes' 409 on this shape is pinned per-entity)."""
        url = self._existing_leaf_url(api_client, prefix, create_record)
        resp = api_client.request(
            "DELETE", url, params={"dry_run": "true"}, json={"expected": {}},
        )
        assert resp.status_code == 204, resp.text

    @staticmethod
    def _existing_leaf_url(api_client, prefix: str, create_record) -> str:
        """An existing leaf row URL for the expected-only case (the form
        is proven already — this only steers past the 404 probe)."""
        if prefix == "/api/v1/visits":
            record = create_record()
            return f"/api/v1/visits/{record['visits'][0]['id']}"
        if prefix == "/api/v1/payments":
            record = create_record()
            payment = api_client.post("/api/v1/payments", json={
                "record_id": record["id"], "amount": 500, "method": "cash",
            })
            assert payment.status_code == 201, payment.text
            return f"/api/v1/payments/{payment.json()['id']}"
        # user-settings: GET resolves the session user's own row (none
        # in a fresh world) → create one.
        if api_client.get("/api/v1/user-settings").status_code == 404:
            me = api_client.get("/api/v1/auth/me").json()["user"]["id"]
            resp = api_client.post("/api/v1/user-settings", json={"user_id": me})
            assert resp.status_code == 201, resp.text
            return f"/api/v1/user-settings/{resp.json()['id']}"
        row = api_client.get("/api/v1/user-settings").json()
        return f"/api/v1/user-settings/{row['id']}"
