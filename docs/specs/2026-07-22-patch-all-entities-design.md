# PATCH Endpoints for All Entities — Design Spec

> Date: 2026-07-22
> Status: Draft (pending G1a approval)
> Related: #124 (visitor PATCH), #171 (service layer refactor)

## 1. Problem

5 of 13 backend entities have `@router.patch` endpoints (clients, activities, records, visits, payments). The remaining 8 do not. The `GenericService.patch()` method exists and is inherited by all services, but the HTTP-layer routers + `Patch` schemas were only added where frontend needed partial updates.

**Goal:** Add PATCH endpoints to all 8 remaining entities for API consistency.

## 2. Scope

**In scope:**
- Add `@router.patch("/{id}")` endpoint + `<Entity>Patch` schema for 8 entities
- Add `NOT_NULL_FIELDS` to service classes where needed
- Add `ServiceService.patch()` and `PhotoService.patch()` overrides for nested tag handling
- Tests for every new endpoint
- Update domain-rules markdown for each entity (add PATCH row to API Endpoints table)

**Out of scope (tracked in #171):**
- TariffService extraction from ServiceService
- RecordService → VisitService/PaymentService delegation
- Any frontend changes (frontend already uses PUT for these entities)

## 3. Entities

### 3.1 Simple entities (use inherited GenericService.patch())

These 5 entities have no nested collections and no custom service overrides. PATCH is trivial: add schema + router + NOT_NULL_FIELDS + tests.

| # | Entity | Patch fields | NOT_NULL_FIELDS |
|---|--------|-------------|-----------------|
| 1 | **visitors** | `name`, `age` | `{"name"}` |
| 2 | **locations** | `name`, `short_title`, `address`, `description`, `capacity`, `yandex_map_url`, `review_url`, `record_info`, `image_url`, `location_hint`, `sort_order` | `{"name", "capacity", "sort_order"}` |
| 3 | **materials** | `title`, `description` | `{"title", "description"}` |
| 4 | **tags** | `tag` | `{"tag"}` |
| 5 | **masters** | `first_name`, `last_name`, `color`, `position`, `specialty`, `avatar_url`, `sort_order` | `{"first_name", "last_name", "color", "position", "specialty", "sort_order"}` |

#### Excluded fields (not patchable)

| Entity | Excluded from Patch | Reason |
|--------|---------------------|--------|
| visitors | `client_id` | Cannot reassign visitor to different client (foreign key, business invariant) |

### 3.2 Entities with nested tag_ids (require service override)

These 2 entities have M2M tag relationships managed through join tables. PATCH must handle `tag_ids`: if sent → hard-replace links, if not sent → leave untouched.

#### services

| Patch fields | NOT_NULL_FIELDS |
|-------------|-----------------|
| `title`, `description`, `image_url`, `specialty`, `min_age`, `max_age`, `duration`, `record_info`, `material_hint`, `tag_ids` | `{"title", "description", "image_url", "specialty", "min_age", "duration", "record_info"}` |

**Excluded from Patch:** `tariffs` — managed via PUT only (see #171 for TariffService extraction).

**ServiceService.patch() override:**
1. Fetch service by ID (eager-load tariffs + tags)
2. Apply scalar fields from `exclude_unset=True` (skip NOT_NULL nulls)
3. If `tag_ids` in patch data → `delete(service_tags).where(service_id == id)` + insert new links
4. If `tag_ids` NOT in patch data → skip tag handling entirely
5. Flush + reload + return

#### photos

| Patch fields | NOT_NULL_FIELDS |
|-------------|-----------------|
| `filename`, `visitor_id`, `service_id`, `activity_id`, `is_public`, `tag_ids` | `{"filename", "is_public"}` |

**PhotoService.patch() override:**
1. Fetch photo by ID (eager-load tags)
2. Apply scalar fields from `exclude_unset=True`
3. If `tag_ids` in patch data → `select(Tag).where(Tag.id.in_(tag_ids))` → `orm.tags = list(tags)` (ORM relationship assignment, same as update())
4. If `tag_ids` NOT in patch data → skip tag handling
5. Flush + reload + return

### 3.3 user_settings — standalone service (no GenericService)

`UserSettingsService` is standalone (not GenericService). Its `update_by_user_id()` already does partial updates via `exclude_unset=True`. The `UserSettingsUpdate` schema already has all fields optional. NOT_NULL handling is already built into the service (`_not_null_fields` set).

**Change:** Add `@router.patch("")` endpoint alongside the existing `@router.put("")`. Both call the same `service.update_by_user_id()`. The PATCH method is added for API consistency (clients using PATCH get the same behavior as PUT).

No new schema needed — `UserSettingsUpdate` is already a Patch schema.
No NOT_NULL_FIELDS change needed — already handled in the service.

## 4. Schema Pattern

All `<Entity>Patch` schemas follow the established pattern:

```python
class EntityPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/entities/{id}).
    All fields optional. None means 'don't change'.
    """
    field: str | None = None
    ...
```

- Inherit from `BaseModel` directly (not from `EntityBase` — that has required fields)
- All fields: `type | None = None`
- `exclude_unset=True` in service layer distinguishes "not sent" from "sent as null"
- `NOT_NULL_FIELDS` in service class strips null values for NOT NULL columns

## 5. Router Pattern

Standard pattern (simple entities):

```python
@router.patch("/{entity_id}", response_model=EntityResponse)
async def patch_entity(
    entity_id: str,
    data: EntityPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> EntityResponse:
    """Partial-update an entity by ID (PATCH)."""
    entity = await service.patch(db_session=session, id=entity_id, data=data)
    if not entity:
        raise HTTPException(status_code=404, ...)
    return entity
```

## 6. Testing Strategy

Per entity, test these scenarios:

| Test | Description |
|------|-------------|
| `test_patch_<entity>_partial_update` | Send 1 field, verify only that field changed, others preserved |
| `test_patch_<entity>_not_found_404` | PATCH nonexistent ID → 404 |
| `test_patch_<entity>_empty_body` | Send `{}` → 200, no fields changed |
| `test_patch_<entity>_null_not_null_stripped` | Send NOT_NULL field as null → field stripped, not changed |
| `test_patch_<entity>_updates_updated_at` | Verify `updated_at` timestamp changes after PATCH |
| `test_patch_<entity>_multiple_fields` | Send 2+ fields → all changed |
| `test_patch_<entity>_nullable_field_to_null` | Send nullable field as null → field set to null |

Entities with nested tag_ids (services, photos) get additional tests:

| Test | Description |
|------|-------------|
| `test_patch_<entity>_tag_ids_replaces` | Send `tag_ids` → links replaced |
| `test_patch_<entity>_without_tag_ids_preserves` | Don't send `tag_ids` → existing links preserved |

## 7. Domain Rules Updates

After implementation, update `docs/domain-rules/<entity>.md` for each of the 8 entities — add PATCH row to the API Endpoints table.

## 8. User Scenarios

| # | Scenario | Entity | E2E Test Mapping |
|---|----------|--------|-----------------|
| 1 | Admin edits visitor name without sending age | visitors | PATCH /api/v1/visitors/{id} with `{name: "New"}` |
| 2 | Admin toggles location capacity without re-sending all fields | locations | PATCH /api/v1/locations/{id} with `{capacity: 20}` |
| 3 | Admin renames material title only | materials | PATCH /api/v1/materials/{id} with `{title: "New"}` |
| 4 | Admin renames tag | tags | PATCH /api/v1/tags/{id} with `{tag: "New"}` |
| 5 | Admin updates master color only | masters | PATCH /api/v1/masters/{id} with `{color: "#FF0000"}` |
| 6 | Admin updates service duration + tag links, tariffs untouched | services | PATCH /api/v1/services/{id} with `{duration: 120, tag_ids: [...]}` |
| 7 | Admin updates photo visibility + tags | photos | PATCH /api/v1/photos/{id} with `{is_public: true, tag_ids: [...]}` |
| 8 | User changes theme setting only | user_settings | PATCH /api/v1/user-settings?user_id=... with `{theme: "dark"}` |

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| ServiceService.patch() override changes PUT behavior | PUT calls `update()`, PATCH calls `patch()` — separate methods, no interaction |
| NOT_NULL stripping hides client errors | Same behavior as existing 5 PATCH endpoints — proven pattern |
| user_settings PUT + PATCH coexist | Same service method, different HTTP method — FastAPI handles routing |
| tag_ids hard-replace on PATCH deletes existing tags | By design: if `tag_ids` sent → replace. If not sent → preserve. Documented in schema docstring. |

## 10. Visual Compliance Checks

Backend-only change — no UI elements to verify. Visual compliance gate passes automatically.