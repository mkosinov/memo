"""Tests for global exception handlers in main.py.

Verifies that all 4 handlers (HTTPException, RequestValidationError,
IntegrityError, catch-all Exception) return the {detail: {code, message}}
shape from T1.1's ErrorDetail.

TDD approach: These tests register trigger routes on the REAL app from
main.py. Before T1.2, only IntegrityError handler exists — the other
3 tests should FAIL (RED). After T1.2, all should pass (GREEN).
"""

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError as FastAPIValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, field_validator
from sqlalchemy.exc import IntegrityError as SAIntegrityError

from src.errors import ErrorCode, ErrorDetail
from src.main import create_app


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def _app_with_triggers():
    """Create the REAL app and add temporary trigger routes for testing.

    These routes raise specific exceptions so we can verify the handlers
    registered in main.py convert them to the ErrorDetail shape.
    """
    app = create_app()

    class _TestPayload(BaseModel):
        name: str

        @field_validator("name")
        @classmethod
        def must_be_alpha(cls, v: str) -> str:
            if not v.isalpha():
                raise ValueError("Name must contain only letters")
            return v

    @app.get("/test/legacy-404")
    async def _legacy_404():
        raise HTTPException(404, "Activity not found")

    @app.get("/test/new-style-404")
    async def _new_style_404():
        raise HTTPException(
            404,
            ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND.value,
                message="Активность не найдена",
            ).model_dump(),
        )

    @app.get("/test/legacy-409")
    async def _legacy_409():
        raise HTTPException(409, "Duplicate phone")

    @app.get("/test/trigger-validation")
    async def _trigger_validation(payload: _TestPayload):
        return {"ok": True}

    @app.get("/test/trigger-integrity")
    async def _trigger_integrity():
        raise SAIntegrityError("stmt", {}, Exception("constraint"))

    @app.get("/test/trigger-unhandled")
    async def _trigger_unhandled():
        raise RuntimeError("Something broke")

    return app


@pytest.fixture(scope="module")
def _client(_app_with_triggers):
    # raise_server_exceptions=False so our catch-all Exception handler
    # can return a 500 JSONResponse instead of the TestClient re-raising.
    return TestClient(_app_with_triggers, raise_server_exceptions=False)


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestHTTPExceptionHandlers:
    """Test StarletteHTTPException → ErrorDetail conversion."""

    def test_404_legacy_string_detail(self, _client):
        """Old-style raise HTTPException(404, 'X not found') returns ErrorDetail shape."""
        resp = _client.get("/test/legacy-404")
        assert resp.status_code == 404
        body = resp.json()
        assert "detail" in body
        detail = body["detail"]
        assert "code" in detail
        assert "message" in detail
        # Legacy string → maps status to default code
        assert detail["code"] == ErrorCode.ACTIVITY_NOT_FOUND.value
        assert detail["message"] == "Activity not found"

    def test_404_new_style_detail(self, _client):
        """New-style raise with ErrorDetail dict preserves code + message."""
        resp = _client.get("/test/new-style-404")
        assert resp.status_code == 404
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == ErrorCode.ACTIVITY_NOT_FOUND.value
        assert detail["message"] == "Активность не найдена"

    def test_409_legacy(self, _client):
        """Legacy 409 returns CLIENT_DUPLICATE_PHONE as fallback code."""
        resp = _client.get("/test/legacy-409")
        assert resp.status_code == 409
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == ErrorCode.CLIENT_DUPLICATE_PHONE.value
        assert detail["message"] == "Duplicate phone"


class TestValidationExceptionHandler:
    """Test RequestValidationError → VALIDATION_ERROR conversion."""

    def test_422_validation_pydantic(self, _client):
        """Pydantic validation error returns VALIDATION_ERROR + first msg."""
        resp = _client.get("/test/trigger-validation")
        assert resp.status_code == 422
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == ErrorCode.VALIDATION_ERROR.value
        assert isinstance(detail["message"], str)
        assert len(detail["message"]) > 0
        # Should NOT contain FastAPI's "Value error, " prefix
        assert "Value error, " not in detail["message"]


class TestIntegrityErrorHandler:
    """Test IntegrityError → INTEGRITY_VIOLATION conversion."""

    def test_422_integrity(self, _client):
        """SQLAlchemy IntegrityError returns INTEGRITY_VIOLATION code."""
        resp = _client.get("/test/trigger-integrity")
        assert resp.status_code == 422
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == ErrorCode.INTEGRITY_VIOLATION.value
        assert "integrity" in detail["message"].lower()


class TestUnhandledExceptionHandler:
    """Test catch-all Exception → 500 INTERNAL_ERROR conversion."""

    def test_500_unhandled(self, _client):
        """Generic Exception returns 500 + INTERNAL_ERROR."""
        resp = _client.get("/test/trigger-unhandled")
        assert resp.status_code == 500
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == ErrorCode.INTERNAL_ERROR.value
        assert "Internal Server Error" in detail["message"]
        # Must NOT leak internal details
        assert "Something broke" not in detail["message"]
