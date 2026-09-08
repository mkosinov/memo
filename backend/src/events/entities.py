"""GH #239 — canonical entity names for the invalidation channel (spec §3.4).

One map ``MODEL_ENTITY: model class → entity name`` (snake-case plural =
``__tablename__``). Built by an import-walk over every module in
``src/services/``, calling each zero-arg ``get_*_service()`` factory and
reading the instance's ``_model`` (constructors are dependency-free: stateless
repos + model/schema classes; factories are ``@lru_cache`` singletons, so the
walk reuses live instances).

``_model`` is an INSTANCE attribute (set in ``GenericService.__init__``), so a
service CLASS cannot be resolved through it directly — the walk therefore also
records ``_SERVICE_ENTITY: service class → entity name`` as the class-level
fallback used by :func:`resolve_entity_name`.

Two deviations from a pure walk, both spec-mandated (§3.3/§3.4):

* ``users`` has NO service of its own — it is written only by the
  ``MasterService.archive/restore`` user-cascade — but the canonical
  vocabulary binds it, so ``User → "users"`` is declared here explicitly
  (cascade-only entry).
* the standalone pair (``VisitService``/``UserSettingsService``) declares
  ``entity_name`` explicitly (no ``_model`` — spec §1 trap); their models are
  still mapped here so the map stays uniformly model-keyed.

``tariffs`` etc. join automatically if a service for them ever appears — the
import-walk decides, not a hand-typed list.

Task 3 note: completeness discovery will move to ``@transactional``-marker
introspection; this map + resolver stay the source of truth.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
from typing import TYPE_CHECKING, Any, cast

import src.services
from src.models.user import User
from src.models.user_settings import UserSettings
from src.models.visit import Visit
from src.services.generic import GenericService

# Standalone transactional services — not GenericService subclasses, no _model.
from src.services.user_settings import UserSettingsService
from src.services.visit import VisitService

if TYPE_CHECKING:
    from collections.abc import Iterator

# Cascade-only entity (spec §3.3 MasterService.archive/restore → users):
# no UserService exists, the walk cannot derive it.
_CASCADE_ONLY_MODEL_ENTITY: dict[type, str] = {
    User: "users",
}


def _iter_service_modules() -> Iterator[Any]:
    """Import and yield every module in ``src/services/`` (import-walk)."""
    for mod_info in pkgutil.iter_modules(src.services.__path__):
        yield importlib.import_module(f"src.services.{mod_info.name}")


def _factory_functions(module: Any) -> Iterator[Any]:
    """Yield zero-arg ``get_*_service()`` factories defined or re-exported in a module.

    Duplicate calls are harmless: factories are ``@lru_cache`` singletons.
    """
    for name, obj in vars(module).items():
        if (
            name.startswith("get_")
            and name.endswith("_service")
            and callable(obj)
            and not inspect.signature(obj).parameters
        ):
            yield obj


def _build_maps() -> tuple[dict[type, str], dict[type, str]]:
    """Walk services; return ``(MODEL_ENTITY, _SERVICE_ENTITY)``.

    MODEL_ENTITY — model class → entity name (canonical form, spec §3.4).
    _SERVICE_ENTITY — service class → entity name (class-level resolver
    fallback; ``_model`` exists only on instances).
    """
    model_entity: dict[type, str] = {}
    service_entity: dict[type, str] = {}
    for module in _iter_service_modules():
        for factory in _factory_functions(module):
            instance = factory()
            if not isinstance(instance, GenericService):
                continue  # e.g. HealthService (read-only, not transactional)
            model = getattr(instance, "_model", None)
            if isinstance(model, type):
                name = str(cast("Any", model).__tablename__)
                model_entity[model] = name
                service_entity[type(instance)] = name
    # Standalone pair: no _model — their models mapped explicitly so the map
    # stays uniformly model-keyed; the services themselves resolve via their
    # entity_name ClassVar.
    model_entity[Visit] = "visits"
    model_entity[UserSettings] = "user_settings"
    service_entity[VisitService] = "visits"
    service_entity[UserSettingsService] = "user_settings"
    # Cascade-only entities (spec §3.3): written by other services' cascades,
    # no own service — merge last.
    model_entity.update(_CASCADE_ONLY_MODEL_ENTITY)
    return model_entity, service_entity


MODEL_ENTITY, _SERVICE_ENTITY = _build_maps()


def resolve_entity_name(service_cls: Any) -> str | None:
    """Resolve the canonical entity name for a service class (or instance).

    Declared explicitly (standalone services) wins; otherwise the model map
    decides — directly when ``_model`` is reachable (instance), else via the
    walk-recorded service-class map (class). ``None`` for unknown classes.
    """
    if name := getattr(service_cls, "entity_name", None):
        return str(name)
    model = getattr(service_cls, "_model", None)
    if isinstance(model, type):
        return MODEL_ENTITY.get(model)
    cls = service_cls if isinstance(service_cls, type) else type(service_cls)
    return _SERVICE_ENTITY.get(cls)
