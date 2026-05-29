"""SQLAdmin model views and setup."""

from typing import ClassVar

from sqladmin import Admin, ModelView
from sqlalchemy import Column, Engine

from app.db.models.activity import Activity
from app.db.models.client import Client
from app.db.models.location import Location
from app.db.models.master import Master
from app.db.models.payment import Payment
from app.db.models.photo import Photo
from app.db.models.record import Record
from app.db.models.service import Service
from app.db.models.tag import Tag
from app.db.models.tariff import Tariff
from app.db.models.user import User
from app.db.models.visit import Visit
from app.db.models.visitor import Visitor


class MasterAdmin(ModelView, model=Master):
    column_list: ClassVar[list[Column]] = [Master.id, Master.first_name, Master.last_name, Master.position, Master.specialty, Master.is_active]
    column_searchable_list: ClassVar[list[Column]] = [Master.first_name, Master.last_name]
    column_sortable_list: ClassVar[list[Column]] = [Master.first_name, Master.last_name, Master.position]
    name = "Master"
    name_plural = "Masters"
    icon = "fa-solid fa-user-tie"


class UserAdmin(ModelView, model=User):
    column_list: ClassVar[list[Column]] = [User.id, User.phone, User.email, User.role, User.master_id, User.is_active]
    column_searchable_list: ClassVar[list[Column]] = [User.phone, User.email]
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-user"


class LocationAdmin(ModelView, model=Location):
    column_list: ClassVar[list[Column]] = [Location.id, Location.name, Location.capacity, Location.is_active]
    column_searchable_list: ClassVar[list[Column]] = [Location.name]
    name = "Location"
    name_plural = "Locations"
    icon = "fa-solid fa-location-dot"


class ServiceAdmin(ModelView, model=Service):
    column_list: ClassVar[list[Column]] = [Service.id, Service.title, Service.specialty, Service.duration, Service.min_age, Service.max_age]
    column_searchable_list: ClassVar[list[Column]] = [Service.title]
    name = "Service"
    name_plural = "Services"
    icon = "fa-solid fa-palette"


class TariffAdmin(ModelView, model=Tariff):
    column_list: ClassVar[list[Column]] = [Tariff.id, Tariff.service_id, Tariff.title, Tariff.price]
    name = "Tariff"
    name_plural = "Tariffs"
    icon = "fa-solid fa-tag"


class TagAdmin(ModelView, model=Tag):
    column_list: ClassVar[list[Column]] = [Tag.id, Tag.tag]
    column_searchable_list: ClassVar[list[Column]] = [Tag.tag]
    name = "Tag"
    name_plural = "Tags"
    icon = "fa-solid fa-hashtag"


class ActivityAdmin(ModelView, model=Activity):
    column_list: ClassVar[list[Column]] = [Activity.id, Activity.master_id, Activity.service_id, Activity.location_id, Activity.start, Activity.duration, Activity.capacity, Activity.is_private]
    name = "Activity"
    name_plural = "Activities"
    icon = "fa-solid fa-calendar-day"


class ClientAdmin(ModelView, model=Client):
    column_list: ClassVar[list[Column]] = [Client.id, Client.name, Client.phone, Client.channel, Client.is_active]
    column_searchable_list: ClassVar[list[Column]] = [Client.name, Client.phone]
    name = "Client"
    name_plural = "Clients"
    icon = "fa-solid fa-address-book"


class VisitorAdmin(ModelView, model=Visitor):
    column_list: ClassVar[list[Column]] = [Visitor.id, Visitor.client_id, Visitor.name, Visitor.age]
    column_searchable_list: ClassVar[list[Column]] = [Visitor.name]
    name = "Visitor"
    name_plural = "Visitors"
    icon = "fa-solid fa-users"


class PhotoAdmin(ModelView, model=Photo):
    column_list: ClassVar[list[Column]] = [Photo.id, Photo.filename, Photo.visitor_id, Photo.service_id, Photo.activity_id]
    name = "Photo"
    name_plural = "Photos"
    icon = "fa-solid fa-image"


class RecordAdmin(ModelView, model=Record):
    column_list: ClassVar[list[Column]] = [Record.id, Record.activity_id, Record.client_id, Record.status, Record.seats]
    name = "Record"
    name_plural = "Records"
    icon = "fa-solid fa-clipboard-list"


class VisitAdmin(ModelView, model=Visit):
    column_list: ClassVar[list[Column]] = [Visit.id, Visit.record_id, Visit.visitor_id, Visit.price, Visit.status]
    name = "Visit"
    name_plural = "Visits"
    icon = "fa-solid fa-check"


class PaymentAdmin(ModelView, model=Payment):
    column_list: ClassVar[list[Column]] = [Payment.id, Payment.record_id, Payment.amount, Payment.method]
    name = "Payment"
    name_plural = "Payments"
    icon = "fa-solid fa-credit-card"


ALL_ADMIN_VIEWS: ClassVar = [
    MasterAdmin,
    UserAdmin,
    LocationAdmin,
    ServiceAdmin,
    TariffAdmin,
    TagAdmin,
    ActivityAdmin,
    ClientAdmin,
    VisitorAdmin,
    PhotoAdmin,
    RecordAdmin,
    VisitAdmin,
    PaymentAdmin,
]


def setup_admin(app, engine: Engine) -> Admin:
    """Mount SQLAdmin at /admin with all model views."""
    admin = Admin(app, engine)
    for view_cls in ALL_ADMIN_VIEWS:
        admin.add_view(view_cls)
    return admin
