"""GH #239 — canonical entity-name completeness + drift mirror (spec §3.4).

Two guards:

1. **Completeness** — every class carrying a ``@transactional`` method
   (discovered via the ``__memo_transactional__`` marker set by the
   decorator, OWN or inherited) resolves to a non-None entity name. A new
   transactional service without an entity name fails here loudly —
   including the standalone pair (``VisitService`` /
   ``UserSettingsService``), covered automatically by the marker.
2. **Drift mirror** — ``MODEL_ENTITY.values()`` equals the canonical set.
   Pairs with the frontend mirror (spec §4.1): adding/removing an entity
   anywhere breaks exactly one of the two mirrors in CI.
"""

import importlib
import pkgutil

import pytest

import src.services
from src.events.entities import MODEL_ENTITY, resolve_entity_name
from src.services.generic import ArchiveService, GenericService

pytestmark = pytest.mark.pure_unit

# Canonical entity names (backend side of the mirror; frontend pairs in
# frontend/admin — spec §4.1 drift guard).
CANONICAL_ENTITIES = {
    "activities",
    "clients",
    "locations",
    "masters",
    "materials",
    "payments",
    "photos",
    "records",
    "services",
    "tags",
    "user_settings",
    "users",
    "visits",
    "visitors",
}


def _has_transactional_method(cls: type) -> bool:
    """True when ``cls`` carries any ``@transactional``-decorated method.

    ``dir(cls)`` includes inherited methods — a pure-inheriting subclass
    of ``GenericService`` counts too (its inherited wrappers resolve
    ``type(self)`` at call time, so IT must have an entity name).
    """
    return any(
        getattr(getattr(cls, name, None), "__memo_transactional__", False)
        for name in dir(cls)
    )


def _iter_transactional_service_classes():
    """Import every module in src/services/; yield classes with marked methods.

    The two framework bases (``GenericService``/``ArchiveService``) are
    skipped — they are abstract infrastructure, never instantiated as a
    service (their own resolution is intentionally undefined). Everything
    else with a ``@transactional`` method — GenericService subclass,
    ArchiveService subclass, or standalone service — is yielded, so a new
    transactional service is covered AUTOMATICALLY (no explicit list).
    """
    seen: set[type] = set()
    for mod_info in pkgutil.iter_modules(src.services.__path__):
        mod = importlib.import_module(f"src.services.{mod_info.name}")
        for obj in vars(mod).values():
            if not isinstance(obj, type) or obj in seen:
                continue
            if obj in (GenericService, ArchiveService):
                continue
            if _has_transactional_method(obj):
                seen.add(obj)
                yield obj


class TestEntityNameResolution:
    def test_resolve_entity_name_explicit_declaration_wins(self) -> None:
        """Standalone services declare entity_name explicitly (spec §1 trap)."""
        from src.services.user_settings import UserSettingsService
        from src.services.visit import VisitService

        assert getattr(VisitService, "entity_name", None) == "visits"
        assert getattr(UserSettingsService, "entity_name", None) == "user_settings"
        assert resolve_entity_name(VisitService) == "visits"
        assert resolve_entity_name(UserSettingsService) == "user_settings"

    def test_resolve_entity_name_from_model_map(self) -> None:
        """GenericService subclasses resolve via the model→name map."""
        from src.services.activity import ActivityService

        name = resolve_entity_name(ActivityService)
        assert name == "activities"

    def test_resolve_entity_name_unknown_class_returns_none(self) -> None:
        """A class with neither entity_name nor a mapped _model → None."""

        class Unrelated:
            pass

        assert resolve_entity_name(Unrelated) is None


class TestCompleteness:
    def test_every_transactional_service_resolves_an_entity_name(self) -> None:
        """Completeness: no transactional service silently never-emit."""
        missing = []
        count = 0
        for cls in _iter_transactional_service_classes():
            if resolve_entity_name(cls) is None:
                missing.append(cls.__qualname__)
            count += 1
        assert not missing, (
            f"Transactional services without an entity name: {missing}. "
            "Declare entity_name explicitly or add the model to MODEL_ENTITY."
        )
        assert count >= 12, f"Expected at least 12 transactional services, walked {count}"

    def test_standalone_services_are_covered_by_marker_walk(self) -> None:
        """The standalone pair (no GenericService base) is discovered by
        the marker walk — no explicit list to keep in sync."""
        walked = {
            cls.__name__
            for cls in _iter_transactional_service_classes()
        }
        assert {"VisitService", "UserSettingsService"} <= walked


class TestDriftMirror:
    def test_model_entity_values_match_canonical_set(self) -> None:
        """Backend-side drift mirror — pairs with the frontend mirror (§4.1)."""
        assert set(MODEL_ENTITY.values()) == CANONICAL_ENTITIES

    def test_activities_present_in_map(self) -> None:
        """DoD: activities is present in the entity map."""
        from src.models.activity import Activity

        assert MODEL_ENTITY[Activity] == "activities"
