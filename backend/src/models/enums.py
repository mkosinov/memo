"""StrEnum definitions for model fields."""

import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    MASTER = "master"
    # #499 (spec §3): client accounts (OTP phone-verification flow). NOT in
    # ROLE_PERMISSIONS — client endpoints authorize by the client-session
    # fact, not permission tokens; the matrix invariant stays «admin+master».
    CLIENT = "client"


class RecordStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CARD = "card"
    TRANSFER = "transfer"


class Channel(str, enum.Enum):
    TELEGRAM = "telegram"
    MAX = "max"
    WHATSAPP = "whatsapp"


class TariffAudience(str, enum.Enum):
    KID = "kid"
    ADULT = "adult"
    ALL = "all"


class ArchiveStatus(str, enum.Enum):
    """List filter for soft-delete entities: active (default), archived, or all."""

    ACTIVE = "active"
    ARCHIVED = "archived"
    ALL = "all"
