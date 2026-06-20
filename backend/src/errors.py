"""Error contract for the Memo backend.

Defines machine-readable error codes and the ErrorDetail Pydantic model
that flows through every error response from the API.

Spec: docs/specs/2026-06-20-error-flow-design.md (section 5 — Error Code Registry)
"""

from enum import Enum

from pydantic import BaseModel


class ErrorCode(str, Enum):
    """Stable machine-readable error codes returned in ``detail.code``."""

    # 409 — conflict
    ACTIVITY_AT_CAPACITY = "ACTIVITY_AT_CAPACITY"
    CLIENT_DUPLICATE_PHONE = "CLIENT_DUPLICATE_PHONE"

    # 404 — not found (one per entity)
    ACTIVITY_NOT_FOUND = "ACTIVITY_NOT_FOUND"
    RECORD_NOT_FOUND = "RECORD_NOT_FOUND"
    CLIENT_NOT_FOUND = "CLIENT_NOT_FOUND"
    LOCATION_NOT_FOUND = "LOCATION_NOT_FOUND"
    MASTER_NOT_FOUND = "MASTER_NOT_FOUND"
    SERVICE_NOT_FOUND = "SERVICE_NOT_FOUND"
    TAG_NOT_FOUND = "TAG_NOT_FOUND"
    PHOTO_NOT_FOUND = "PHOTO_NOT_FOUND"
    MATERIAL_NOT_FOUND = "MATERIAL_NOT_FOUND"
    VISITOR_NOT_FOUND = "VISITOR_NOT_FOUND"
    VISIT_NOT_FOUND = "VISIT_NOT_FOUND"
    PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND"
    SETTINGS_NOT_FOUND = "SETTINGS_NOT_FOUND"

    # 422 — validation / integrity
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTEGRITY_VIOLATION = "INTEGRITY_VIOLATION"

    # 500 — internal
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorDetail(BaseModel):
    """Shape of every ``detail`` field in error responses.

    Backend fills these in handlers; api-client reads them; admin maps
    code → user-friendly Russian message via parseApiError.
    """

    code: str
    message: str


# Default Russian messages per code. Frontend uses these as fallback when
# err.message from backend is empty. The frontend parseApiError has its own
# copy; this is the source of truth for the API itself.
ERROR_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.ACTIVITY_AT_CAPACITY: "Недостаточно мест",
    ErrorCode.ACTIVITY_NOT_FOUND: "Активность не найдена",
    ErrorCode.RECORD_NOT_FOUND: "Запись не найдена",
    ErrorCode.CLIENT_NOT_FOUND: "Клиент не найден",
    ErrorCode.CLIENT_DUPLICATE_PHONE: "Клиент с таким телефоном уже существует",
    ErrorCode.LOCATION_NOT_FOUND: "Локация не найдена",
    ErrorCode.MASTER_NOT_FOUND: "Мастер не найден",
    ErrorCode.SERVICE_NOT_FOUND: "Услуга не найдена",
    ErrorCode.TAG_NOT_FOUND: "Тег не найден",
    ErrorCode.PHOTO_NOT_FOUND: "Фото не найдено",
    ErrorCode.MATERIAL_NOT_FOUND: "Материал не найден",
    ErrorCode.VISITOR_NOT_FOUND: "Посетитель не найден",
    ErrorCode.VISIT_NOT_FOUND: "Визит не найден",
    ErrorCode.PAYMENT_NOT_FOUND: "Платёж не найден",
    ErrorCode.SETTINGS_NOT_FOUND: "Настройки не найдены",
    ErrorCode.VALIDATION_ERROR: "Проверьте правильность заполнения полей",
    ErrorCode.INTEGRITY_VIOLATION: "Нарушение целостности данных",
    ErrorCode.INTERNAL_ERROR: "Ошибка сервера",
}
