"""ORM models package — re-exports all entities and join tables."""

from src.models.abstract import AbstractModel
from src.models.activity import Activity
from src.models.client import Client
from src.models.enums import RecordStatus, UserRole
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.photo import Photo, photo_tags
from src.models.record import Record
from src.models.service import Service
from src.models.tag import (
    Tag,
    activity_tags, client_tags, location_tags,
    master_tags, record_tags, service_tags, visitor_tags,
)
from src.models.tariff import Tariff
from src.models.user import User
from src.models.visit import Visit
from src.models.visitor import Visitor

__all__ = [
    "AbstractModel",
    "Activity", "Client", "Location", "Master", "Material", "Payment", "Photo",
    "Record", "Service", "Tag", "Tariff", "User", "Visit", "Visitor",
    "RecordStatus", "UserRole",
    "activity_tags", "client_tags", "location_tags",
    "master_tags", "photo_tags", "record_tags", "service_tags", "visitor_tags",
]
