"""SQLAdmin model views and setup — GH #247 §3.9.

``SqlAdminAuth`` wires the stock sqladmin login screen to ``AuthService``
(phone + password form fields ``username``/``password``; ``is_active``
filter and the §2.11 lockout ladder live inside the service) and admits
``role == "admin"`` only. The backend mounts its own SessionMiddleware
with ``settings.SECRET_KEY`` — the app does NOT add one manually.

``UserAdmin`` renders ``password_hash`` as a write-only ``PasswordField``
(never populated from the model, never rendered back) with the policy hint
as help text; ``on_model_change`` applies the semantics — create: required →
``validate_password`` → hash; edit: blank leaves ``password_hash``
unchanged (the key is dropped so sqladmin skips the column), filled →
validate + hash.
"""

from typing import Any, ClassVar

from fastapi import HTTPException
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from sqlalchemy import Column, create_engine
from starlette.requests import Request
from wtforms import PasswordField
from wtforms.validators import Optional

from src.auth.passwords import (
    PASSWORD_POLICY_HINT_RU,
    PasswordPolicyError,
    hash_password,
    validate_password,
)
from src.auth.service import get_auth_service
from src.core.config import settings
from src.db import db_manager
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.material import Material
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.position import Position
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag
from src.models.tariff import Tariff
from src.models.user import User
from src.models.visit import Visit
from src.models.visitor import Visitor


class StaffAdmin(ModelView, model=Staff):
    """Staff card view (GH #266): the employee directory row + the master
    schedule-extension (specialty/color/is_active) edited INLINE — the
    extension is 1:0..1 and never exists without its card."""

    # The extension relationship is declared on Staff.master — inline_models
    # accepts the relationship attribute for a ModelView on the parent.
    inline_models: ClassVar[list] = [Staff.master]
    column_list: ClassVar[list[Column]] = [
        Staff.id, Staff.first_name, Staff.last_name, Staff.avatar_url,
        Staff.sort_order, Staff.is_active,
    ]
    column_searchable_list: ClassVar[list[Column]] = [
        Staff.first_name, Staff.last_name,
    ]
    column_sortable_list: ClassVar[list[Column]] = [
        Staff.first_name, Staff.last_name, Staff.sort_order, Staff.is_active,
    ]
    name = "Staff"
    name_plural = "Staff"
    icon = "fa-solid fa-user-tie"


class PositionAdmin(ModelView, model=Position):
    """Position dictionary view (GH #266): salary-side entries; built-ins
    (``is_system``) are not deletable — enforced at the API layer
    (``POSITION_IS_SYSTEM``), surfaced here via the flag column."""

    column_list: ClassVar[list[Column]] = [
        Position.id, Position.title, Position.is_system,
    ]
    column_searchable_list: ClassVar[list[Column]] = [Position.title]
    column_sortable_list: ClassVar[list[Column]] = [Position.title, Position.is_system]
    name = "Position"
    name_plural = "Positions"
    icon = "fa-solid fa-id-badge"


class SqlAdminAuth(AuthenticationBackend):
    """GH #247 §3.9 — sqladmin login via AuthService, role=admin only.

    The constructor takes ONLY ``secret_key`` (sqladmin 0.20+ API — there is
    no ``secret_url``; the login URL is the stock ``admin:login`` route) and
    mounts its own SessionMiddleware with that key. ``login`` reads the
    standard form (phone in the ``username`` field + password), verifies via
    ``AuthService`` (which enforces ``is_active`` and the §2.11 lockout
    ladder) and requires ``role == "admin"``; the sqladmin session stores
    only ``{"user_id": ...}``.
    """

    def __init__(self, secret_key: str) -> None:
        super().__init__(secret_key=secret_key)

    async def login(self, request: Request) -> bool:
        form = await request.form()
        phone = str(form.get("username", "")).strip()
        password = str(form.get("password", ""))
        client_ip = request.client.host if request.client else "unknown"
        try:
            async with db_manager.async_session() as session:
                user, _token = await get_auth_service().login(
                    session, phone, password, client_ip
                )
        except HTTPException:
            # 401 invalid credentials / 429 locked out — either way the
            # stock login screen re-renders with its error message.
            return False
        if user.role != "admin":
            return False
        request.session.update({"user_id": user.id})
        return True

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return bool(request.session.get("user_id"))


class UserAdmin(ModelView, model=User):
    column_list: ClassVar[list[Column]] = [User.id, User.phone, User.email, User.role, User.staff_id, User.is_active]
    column_searchable_list: ClassVar[list[Column]] = [User.phone, User.email]
    # Write-only password field (never populated from the model, never
    # rendered back). NOTE: sqladmin looks form_overrides up by STRING prop
    # name — a Column-object key would silently no-op.
    form_overrides: ClassVar[dict[str, type]] = {"password_hash": PasswordField}
    # ``Optional()`` FIRST relaxes the InputRequired sqladmin auto-adds for
    # the non-nullable column (review blocker): wtforms runs validators in
    # order and ``Optional`` raises StopValidation on blank input, so a
    # blank EDIT submits instead of failing form validation with a 400 —
    # without it, "edit: blank = unchanged" (and the lockout-reset flow)
    # is unreachable. Required-ness on CREATE is enforced in
    # ``on_model_change`` (is_created and blank → PasswordPolicyError).
    form_args: ClassVar[dict[str, dict[str, Any]]] = {
        "password_hash": {
            "description": PASSWORD_POLICY_HINT_RU,
            "validators": [Optional()],
        },
    }
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-user"

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        """Password semantics (spec §3.9): create — required, validate, hash;
        edit — blank leaves ``password_hash`` unchanged (key dropped so the
        column is not written), filled — validate + hash.
        """
        password = data.get("password_hash")
        if is_created:
            if not password or not password.strip():
                raise PasswordPolicyError()
            data["password_hash"] = hash_password(validate_password(password))
            return
        if password is None or not password.strip():
            data.pop("password_hash", None)
            return
        data["password_hash"] = hash_password(validate_password(password))


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
    column_list: ClassVar[list[Column]] = [Photo.id, Photo.filename, Photo.client_id, Photo.service_id, Photo.activity_id, Photo.location_id]
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


class MaterialAdmin(ModelView, model=Material):
    column_list: ClassVar[list[Column]] = [Material.id, Material.title, Material.description, Material.is_active]
    column_searchable_list: ClassVar[list[Column]] = [Material.title]
    name = "Material"
    name_plural = "Materials"
    icon = "fa-solid fa-paint-brush"


ALL_ADMIN_VIEWS: ClassVar = [
    StaffAdmin,
    PositionAdmin,
    MaterialAdmin,
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


def setup_admin(app) -> Admin:
    """Mount SQLAdmin at /admin with all model views.

    Creates a sync engine from the global db_manager's async engine URL
    for sqladmin to use. Schema is managed by alembic, not by this module.
    """
    sync_url = str(db_manager.engine.url).replace("sqlite+aiosqlite://", "sqlite://")
    sync_engine = create_engine(sync_url)
    admin = Admin(app, engine=sync_engine, authentication_backend=SqlAdminAuth(settings.SECRET_KEY))
    for view_cls in ALL_ADMIN_VIEWS:
        admin.add_view(view_cls)
    return admin
