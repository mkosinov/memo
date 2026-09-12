"""ORM models package — re-exports all entities and join tables."""

# Session lives in src/auth/ (spec §3.1) but must register with Base.metadata:
# seed.py builds dev/E2E schema via Base.metadata.create_all on a wiped DB,
# where run_alembic_upgrade only stamps head (src/db/migrate.py:57-62).
from src.auth.session import Session  # noqa: F401 — bare registration import
from src.models.abstract import AbstractModel, AbstractModelSoftDelete
from src.models.activity import Activity
from src.models.client import Client
from src.models.enums import ArchiveStatus, Channel, RecordStatus, UserRole
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.photo import Photo, photo_tags
from src.models.position import Position, staff_positions
from src.models.record import Record
from src.models.service import Service
from src.models.service_material import ServiceMaterial
from src.models.staff import Staff
from src.models.tag import (
    Tag,
    activity_tags,
    client_tags,
    location_tags,
    master_tags,
    record_tags,
    service_tags,
    visitor_tags,
)
from src.models.tariff import Tariff
from src.models.user import User
from src.models.user_settings import UserSettings
from src.models.visit import Visit
from src.models.visitor import Visitor

__all__ = [
    "AbstractModel",
    "AbstractModelSoftDelete",
    "Activity",
    "ArchiveStatus",
    "Channel",
    "Client",
    "Location",
    "Master",
    "Material",
    "Payment",
    "Photo",
    "Position",
    "Record",
    "RecordStatus",
    "Service",
    "ServiceMaterial",
    "Staff",
    "Tag",
    "Tariff",
    "User",
    "UserRole",
    "UserSettings",
    "Visit",
    "Visitor",
    "activity_tags",
    "client_tags",
    "location_tags",
    "master_tags",
    "photo_tags",
    "record_tags",
    "service_tags",
    "staff_positions",
    "visitor_tags",
]
