"""Test all ORM models — import, table creation, CRUD round-trip."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session

from src.db.base import Base

pytestmark = pytest.mark.unit


def _make_engine():
    """In-memory SQLite engine with string-based FK support."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def _create_all_and_session(engine):
    """Create tables and return a Session."""
    # Import models so they register with Base.metadata
    from src.models import (  # noqa: F401
        Activity,
        Client,
        Location,
        Master,
        Material,
        Payment,
        Photo,
        Record,
        Service,
        Tag,
        Tariff,
        User,
        Visit,
        Visitor,
        activity_tags,
        client_tags,
        location_tags,
        master_tags,
        photo_tags,
        record_tags,
        service_tags,
        visitor_tags,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


class TestModelImports:
    """All models and join tables are importable from src.models."""

    def test_imports(self):
        from src.models import (
            Activity,
            Client,
            Location,
            Master,
            Material,
            Payment,
            Photo,
            Record,
            Service,
            Tag,
            Tariff,
            User,
            Visit,
            Visitor,
        )
        # Verify they are actual classes / Table objects
        for cls in [Master, User, Location, Service, Tariff, Tag,
                    Activity, Client, Visitor, Photo, Record, Visit, Payment,
                    Material]:
            assert hasattr(cls, "__tablename__")

    def test_all_exports(self):
        from src.models import __all__
        expected = [
            "AbstractModel",
            "Master", "User", "Location", "Service", "Tariff", "Tag",
            "Activity", "Client", "Visitor", "Photo", "Record", "Visit", "Payment",
            "Material",
            "Channel", "RecordStatus", "UserRole",
            "service_tags", "activity_tags", "photo_tags",
            "master_tags", "location_tags", "client_tags", "visitor_tags", "record_tags",
        ]
        assert sorted(__all__) == sorted(expected)


class TestModelTables:
    """Each model maps to the correct table name and has expected columns."""

    @pytest.fixture
    def inspector(self):
        engine = _make_engine()
        _create_all_and_session(engine)
        return inspect(engine)

    @pytest.mark.parametrize("table_name", [
        "masters", "users", "locations", "services", "tariffs",
        "tags", "activities", "clients", "visitors",
        "photos", "records", "visits", "payments",
        "materials",
        "service_tags", "activity_tags", "photo_tags",
        "master_tags", "location_tags", "client_tags", "visitor_tags", "record_tags",
    ])
    def test_table_exists(self, inspector, table_name):
        tables = inspector.get_table_names()
        assert table_name in tables


class TestModelCrud:
    """Each model can be created, saved, and read back with correct values."""

    @pytest.fixture
    def session(self):
        engine = _make_engine()
        s = _create_all_and_session(engine)
        yield s
        s.close()

    def _now(self) -> datetime:
        return datetime.utcnow()

    def test_master_crud(self, session: Session):
        from src.models import Master
        m = Master(
            first_name="Anna",
            last_name="Ivanova",
            color="#FF5733",
            position="мастер",
            specialty="живопись",
            avatar_url="https://example.com/avatar.jpg",
        )
        session.add(m)
        session.flush()
        fetched = session.get(Master, m.id)
        assert fetched.first_name == "Anna"
        assert fetched.last_name == "Ivanova"
        assert fetched.color == "#FF5733"
        assert fetched.position == "мастер"
        assert fetched.specialty == "живопись"
        assert fetched.avatar_url == "https://example.com/avatar.jpg"
        assert fetched.is_active is True

    def test_user_crud(self, session: Session):
        from src.models import User
        u = User(
            phone="+79001234567",
            email="test@example.com",
            password_hash="hashed_pw",
            role="admin",
            email_is_confirmed=True,
            phone_is_confirmed=False,
        )
        session.add(u)
        session.flush()
        fetched = session.get(User, u.id)
        assert fetched.phone == "+79001234567"
        assert fetched.email == "test@example.com"
        assert fetched.role == "admin"

    def test_user_master_fk_nullable(self, session: Session):
        from src.models import Master, User
        m = Master(first_name="A", last_name="B", color="#000000", position="мастер", specialty="живопись")
        session.add(m)
        session.flush()
        u = User(
            phone="+79001111111",
            password_hash="h",
            role="master",
            master_id=m.id,
        )
        session.add(u)
        session.flush()
        fetched = session.get(User, u.id)
        assert fetched.master_id == m.id

    def test_location_crud(self, session: Session):
        from src.models import Location
        loc = Location(
            name="Studio 1",
            address="Moscow, street 1",
            description="Main hall",
            capacity=20,
            yandex_map_url="https://yandex.ru/map/1",
            review_url="https://example.com/review",
            record_info="Ring the bell",
            image_url="https://example.com/img.jpg",
        )
        session.add(loc)
        session.flush()
        fetched = session.get(Location, loc.id)
        assert fetched.name == "Studio 1"
        assert fetched.capacity == 20

    def test_service_crud(self, session: Session):
        from src.models import Service
        svc = Service(
            title="Portrait Painting",
            description="Learn to paint portraits",
            image_url="https://example.com/service.jpg",
            specialty="живопись",
            min_age=12,
            max_age=99,
            duration=120,
            record_info="Bring your own brushes",
        )
        session.add(svc)
        session.flush()
        fetched = session.get(Service, svc.id)
        assert fetched.title == "Portrait Painting"
        assert fetched.duration == 120

    def test_tariff_crud(self, session: Session):
        from src.models import Service, Tariff
        svc = Service(
            title="S1", description="d", image_url="http://x.com/i",
            specialty="живопись", min_age=1, max_age=99, duration=60, record_info="r",
        )
        session.add(svc)
        session.flush()
        t = Tariff(
            service_id=svc.id,
            title="Single Visit",
            description="One-time payment",
            price=1500,
        )
        session.add(t)
        session.flush()
        fetched = session.get(Tariff, t.id)
        assert fetched.title == "Single Visit"
        assert fetched.price == 1500
        assert fetched.service_id == svc.id

    def test_tag_crud(self, session: Session):
        from src.models import Tag
        t = Tag(tag="beginner")
        session.add(t)
        session.flush()
        fetched = session.get(Tag, t.id)
        assert fetched.tag == "beginner"

    def test_material_crud(self, session: Session):
        from src.models import Material
        m = Material(
            title="Масло",
            description="Масляные краски на основе льняного масла",
        )
        session.add(m)
        session.flush()
        fetched = session.get(Material, m.id)
        assert fetched.title == "Масло"
        assert fetched.description == "Масляные краски на основе льняного масла"
        assert fetched.is_active is True
        assert fetched.created_at is not None
        assert fetched.updated_at is not None

    def test_activity_crud(self, session: Session):
        from src.models import Activity, Location, Master, Service
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L", capacity=10)
        session.add_all([m, svc, loc])
        session.flush()
        a = Activity(
            master_id=m.id,
            service_id=svc.id,
            location_id=loc.id,
            start=now,
            duration=90,
            capacity=15,
            is_private=True,
            comment="Private event",
            record_info="Arrive 10 min early",
        )
        session.add(a)
        session.flush()
        fetched = session.get(Activity, a.id)
        assert fetched.master_id == m.id
        assert fetched.is_private is True
        assert fetched.comment == "Private event"

    def test_client_crud(self, session: Session):
        from src.models import Client
        c = Client(
            name="Maria Petrova",
            phone="+79002223344",
            email="maria@example.com",
            channel="telegram",
        )
        session.add(c)
        session.flush()
        fetched = session.get(Client, c.id)
        assert fetched.name == "Maria Petrova"
        assert fetched.channel == "telegram"

    def test_client_nullable_fields(self, session: Session):
        """Client name, phone, and channel can be NULL (optional fields).

        A client may be created with incomplete info (e.g. walk-in without
        phone or name). The database must allow NULL for these columns.
        """
        from src.models import Client
        c = Client(
            name=None,
            phone=None,
            email=None,
            channel=None,
        )
        session.add(c)
        session.flush()
        fetched = session.get(Client, c.id)
        assert fetched.name is None
        assert fetched.phone is None
        assert fetched.email is None
        assert fetched.channel is None

    def test_client_nullable_via_inspector(self):
        """Verify the clients table DDL declares name, phone, channel as nullable."""
        engine = _make_engine()
        _create_all_and_session(engine)
        insp = inspect(engine)
        cols = {col["name"]: col for col in insp.get_columns("clients")}
        assert cols["name"]["nullable"] is True, "clients.name should be nullable"
        assert cols["phone"]["nullable"] is True, "clients.phone should be nullable"
        assert cols["channel"]["nullable"] is True, "clients.channel should be nullable"

    def test_visitor_crud(self, session: Session):
        from src.models import Client, Visitor
        c = Client(name="Parent", phone="+79001111111", channel="phone")
        session.add(c)
        session.flush()
        v = Visitor(
            client_id=c.id,
            name="Child Visitor",
            age=8,
        )
        session.add(v)
        session.flush()
        fetched = session.get(Visitor, v.id)
        assert fetched.name == "Child Visitor"
        assert fetched.age == 8

    def test_photo_crud(self, session: Session):
        from src.models import Photo
        p = Photo(filename="photo_001.jpg")
        session.add(p)
        session.flush()
        fetched = session.get(Photo, p.id)
        assert fetched.filename == "photo_001.jpg"
        assert fetched.visitor_id is None
        assert fetched.is_public is False  # default

    def test_photo_is_public(self, session: Session):
        from src.models import Photo
        p = Photo(filename="photo_002.jpg", is_public=True)
        session.add(p)
        session.flush()
        fetched = session.get(Photo, p.id)
        assert fetched.is_public is True

    def test_record_crud(self, session: Session):
        from src.models import Activity, Client, Location, Master, Record, Service
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L", capacity=10)
        client = Client(name="Client", phone="+79001234567", channel="phone")
        session.add_all([m, svc, loc, client])
        session.flush()
        act = Activity(master_id=m.id, service_id=svc.id, location_id=loc.id,
                        start=now, duration=60, capacity=10)
        session.add(act)
        session.flush()
        r = Record(
            activity_id=act.id,
            client_id=client.id,
            status="confirmed",
            seats=2,
            comment="Window seat please",
        )
        session.add(r)
        session.flush()
        fetched = session.get(Record, r.id)
        assert fetched.status == "confirmed"
        assert fetched.seats == 2

    def test_visit_crud(self, session: Session):
        from src.models import (
            Activity,
            Client,
            Location,
            Master,
            Record,
            Service,
            Visit,
            Visitor,
        )
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L", capacity=10)
        client = Client(name="C", phone="+79001234567", channel="phone")
        session.add_all([m, svc, loc, client])
        session.flush()
        act = Activity(master_id=m.id, service_id=svc.id, location_id=loc.id,
                        start=now, duration=60, capacity=10)
        session.add(act)
        session.flush()
        rec = Record(activity_id=act.id, status="confirmed", seats=1)
        session.add(rec)
        session.flush()
        vis = Visitor(client_id=client.id, name="V")
        session.add(vis)
        session.flush()
        visit = Visit(
            record_id=rec.id,
            visitor_id=vis.id,
            price=1500,
            status="visited",
        )
        session.add(visit)
        session.flush()
        fetched = session.get(Visit, visit.id)
        assert fetched.price == 1500
        assert fetched.status == "visited"

    def test_payment_crud(self, session: Session):
        from src.models import (
            Activity,
            Client,
            Location,
            Master,
            Payment,
            Record,
            Service,
        )
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L", capacity=10)
        client = Client(name="C", phone="+79001234567", channel="phone")
        session.add_all([m, svc, loc, client])
        session.flush()
        act = Activity(master_id=m.id, service_id=svc.id, location_id=loc.id,
                        start=now, duration=60, capacity=10)
        session.add(act)
        session.flush()
        rec = Record(activity_id=act.id, status="confirmed", seats=1)
        session.add(rec)
        session.flush()
        p = Payment(
            record_id=rec.id,
            amount=3000,
            method="card",
        )
        session.add(p)
        session.flush()
        fetched = session.get(Payment, p.id)
        assert fetched.amount == 3000
        assert fetched.method == "card"

    def test_service_with_material_hint(self, session: Session):
        """Service can be created with an optional material_hint field."""
        from src.models import Service
        svc = Service(
            title="Portrait Painting",
            description="Learn to paint portraits",
            image_url="https://example.com/service.jpg",
            specialty="живопись",
            min_age=12,
            max_age=99,
            duration=120,
            record_info="Bring your own brushes",
            material_hint="Масляные краски, холст на подрамнике 40×50 см",
        )
        session.add(svc)
        session.flush()
        fetched = session.get(Service, svc.id)
        assert fetched.material_hint == "Масляные краски, холст на подрамнике 40×50 см"

    def test_service_material_hint_nullable(self, session: Session):
        """Service can be created without material_hint (nullable)."""
        from src.models import Service
        svc = Service(
            title="No Hint Service",
            description="desc",
            image_url="https://example.com/img.jpg",
            specialty="керамика",
            min_age=5,
            max_age=50,
            duration=90,
            record_info="Just come",
        )
        session.add(svc)
        session.flush()
        fetched = session.get(Service, svc.id)
        assert fetched.material_hint is None

    def test_location_with_location_hint(self, session: Session):
        """Location can be created with an optional location_hint field."""
        from src.models import Location
        loc = Location(
            name="Main Studio",
            address="Moscow, Arbat 1",
            capacity=20,
            location_hint="1 этаж, светлая студия с панорамными окнами",
        )
        session.add(loc)
        session.flush()
        fetched = session.get(Location, loc.id)
        assert fetched.location_hint == "1 этаж, светлая студия с панорамными окнами"

    def test_location_location_hint_nullable(self, session: Session):
        """Location can be created without location_hint (nullable)."""
        from src.models import Location
        loc = Location(
            name="No Hint Location",
            capacity=10,
        )
        session.add(loc)
        session.flush()
        fetched = session.get(Location, loc.id)
        assert fetched.location_hint is None

    def test_service_tags_join(self, session: Session):
        from src.models import Service, Tag, service_tags
        svc = Service(title="S2", description="d", image_url="http://x.com/i", specialty="керамика",
                       min_age=5, max_age=50, duration=90, record_info="r")
        tag1 = Tag(tag="for-kids")
        tag2 = Tag(tag="weekend")
        session.add_all([svc, tag1, tag2])
        session.flush()
        session.execute(service_tags.insert().values(service_id=svc.id, tag_id=tag1.id))
        session.execute(service_tags.insert().values(service_id=svc.id, tag_id=tag2.id))
        session.flush()
        # Verify via raw select
        from sqlalchemy import select
        rows = session.execute(select(service_tags.c.tag_id).where(
            service_tags.c.service_id == svc.id
        )).all()
        assert len(rows) == 2
        tag_ids = {r[0] for r in rows}
        assert tag1.id in tag_ids
        assert tag2.id in tag_ids

    def test_activity_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Activity, Location, Master, Service, Tag, activity_tags
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S3", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L3", capacity=10)
        tag = Tag(tag="private-class")
        session.add_all([m, svc, loc, tag])
        session.flush()
        act = Activity(master_id=m.id, service_id=svc.id, location_id=loc.id,
                        start=now, duration=60, capacity=10)
        session.add(act)
        session.flush()
        session.execute(activity_tags.insert().values(activity_id=act.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(activity_tags.c.activity_id).where(
            activity_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == act.id

    def test_photo_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Photo, Tag, photo_tags
        p = Photo(filename="pic.jpg")
        tag = Tag(tag="portrait")
        session.add_all([p, tag])
        session.flush()
        session.execute(photo_tags.insert().values(photo_id=p.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(photo_tags.c.photo_id).where(
            photo_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == p.id

    def test_master_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Master, Tag, master_tags
        m = Master(first_name="Elena", last_name="Sidorova", color="#33FF57",
                   position="мастер", specialty="керамика")
        tag = Tag(tag="pottery-master")
        session.add_all([m, tag])
        session.flush()
        session.execute(master_tags.insert().values(master_id=m.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(master_tags.c.master_id).where(
            master_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == m.id

    def test_location_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Location, Tag, location_tags
        loc = Location(name="Workshop Hall", capacity=30)
        tag = Tag(tag="large-space")
        session.add_all([loc, tag])
        session.flush()
        session.execute(location_tags.insert().values(location_id=loc.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(location_tags.c.location_id).where(
            location_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == loc.id

    def test_client_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Client, Tag, client_tags
        c = Client(name="VIP Client", phone="+79005555555", channel="referral")
        tag = Tag(tag="vip")
        session.add_all([c, tag])
        session.flush()
        session.execute(client_tags.insert().values(client_id=c.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(client_tags.c.client_id).where(
            client_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == c.id

    def test_visitor_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import Client, Tag, Visitor, visitor_tags
        c = Client(name="Parent", phone="+79001111111", channel="phone")
        session.add(c)
        session.flush()
        v = Visitor(client_id=c.id, name="Child", age=7)
        tag = Tag(tag="birthday-party")
        session.add_all([v, tag])
        session.flush()
        session.execute(visitor_tags.insert().values(visitor_id=v.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(visitor_tags.c.visitor_id).where(
            visitor_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == v.id

    def test_record_tags_join(self, session: Session):
        from sqlalchemy import select

        from src.models import (
            Activity, Client, Location, Master, Record, Service, Tag, record_tags,
        )
        now = self._now()
        m = Master(first_name="A", last_name="B", color="#000", position="мастер", specialty="живопись")
        svc = Service(title="S", description="d", image_url="http://x.com/i", specialty="живопись",
                       min_age=1, max_age=99, duration=60, record_info="r")
        loc = Location(name="L", capacity=10)
        session.add_all([m, svc, loc])
        session.flush()
        act = Activity(master_id=m.id, service_id=svc.id, location_id=loc.id,
                        start=now, duration=60, capacity=10)
        session.add(act)
        session.flush()
        rec = Record(activity_id=act.id, status="confirmed", seats=1)
        tag = Tag(tag="early-booking")
        session.add_all([rec, tag])
        session.flush()
        session.execute(record_tags.insert().values(record_id=rec.id, tag_id=tag.id))
        session.flush()
        rows = session.execute(select(record_tags.c.record_id).where(
            record_tags.c.tag_id == tag.id
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == rec.id
