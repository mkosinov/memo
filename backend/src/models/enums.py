"""StrEnum definitions for model fields."""

import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    MASTER = "master"


class RecordStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class VisitStatus(str, enum.Enum):
    WAITING = "waiting"
    VISITED = "visited"
    MISSED = "missed"
    CANCELLED = "cancelled"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CARD = "card"
    TRANSFER = "transfer"


class Channel(str, enum.Enum):
    TELEGRAM = "telegram"
    MAX = "max"
    WHATSAPP = "whatsapp"


class ArchiveStatus(str, enum.Enum):
    """List filter for soft-delete entities: active (default), archived, or all."""

    ACTIVE = "active"
    ARCHIVED = "archived"
    ALL = "all"
