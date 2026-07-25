# PATCH Endpoints for All Entities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@router.patch` endpoints + `<Entity>Patch` schemas to all 8 remaining backend entities for API consistency.

**Architecture:** Each entity gets a `<Entity>Patch` Pydantic schema (all fields optional) + a `@router.patch("/{id}")` router handler that calls `service.patch()`. Simple entities use the inherited `GenericService.patch()`. Services and photos get a custom `patch()` override for `tag_ids` handling. User settings reuses its existing partial-update schema.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2.0 async, pytest (sync TestClient)

**Spec:** `docs/specs/2026-07-22-patch-all-entities-design.md`

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **PATCH a visitor's name without sending age** → `PATCH /api/v1/visitors/{id} {"name": "New"}` changes only the name, age untouched
- **PATCH a location's capacity** → `PATCH /api/v1/locations/{id} {"capacity": 20}` changes only capacity, other fields untouched
- **PATCH a material's title** → `PATCH /api/v1/materials/{id} {"title": "New"}` changes only title
- **PATCH a tag's label** → `PATCH /api/v1/tags/{id} {"tag": "New"}` changes only the tag string
- **PATCH a master's color** → `PATCH /api/v1/masters/{id} {"color": "#FF0000"}` changes only the color
- **PATCH a service's duration + tags (tariffs untouched)** → `PATCH /api/v1/services/{id} {"duration": 120, "tag_ids": [...]}` changes duration + replaces tag links, tariffs NOT touched
- **PATCH a photo's visibility + tags** → `PATCH /api/v1/photos/{id} {"is_public": true, "tag_ids": [...]}` changes visibility + replaces tag links
- **PATCH user settings theme** → `PATCH /api/v1/user-settings?user_id=... {"theme": "dark"}` changes only theme
- **Send null for a NOT NULL field** → silently stripped, field unchanged, 200 OK returned
- **Send empty body** → 200 OK, nothing changes

---

## File Structure

### New code (schema additions to existing files)

| File | What's added |
|------|-------------|
| `backend/src/schemas/tag.py` | `TagPatch` class |
| `backend/src/schemas/material.py` | `MaterialPatch` class |
| `backend/src/schemas/visitor.py` | `VisitorPatch` class |
| `backend/src/schemas/master.py` | `MasterPatch` class |
| `backend/src/schemas/location.py` | `LocationPatch` class |
| `backend/src/schemas/service.py` | `ServicePatch` class |
| `backend/src/schemas/photo.py` | `PhotoPatch` class |

### Modified files (router additions + service overrides)

| File | What's modified |
|------|----------------|
| `backend/src/api/v1/tags.py` | + `@router.patch("/{tag_id}")` handler |
| `backend/src/api/v1/materials.py` | + `@router.patch("/{material_id}")` handler |
| `backend/src/api/v1/visitors.py` | + `@router.patch("/{visitor_id}")` handler |
| `backend/src/api/v1/masters.py` | + `@router.patch("/{master_id}")` handler |
| `backend/src/api/v1/locations.py` | + `@router.patch("/{location_id}")` handler |
| `backend/src/api/v1/services.py` | + `@router.patch("/{service_id}")` handler |
| `backend/src/api/v1/photos.py` | + `@router.patch("/{photo_id}")` handler |
| `backend/src/api/v1/user_settings.py` | + `@router.patch("")` handler |
| `backend/src/services/visitor.py` | + `NOT_NULL_FIELDS = {"name"}` |
| `backend/src/services/location.py` | + `NOT_NULL_FIELDS = {"name", "capacity", "sort_order"}` |
| `backend/src/services/material.py` | + `NOT_NULL_FIELDS = {"title", "description"}` |
| `backend/src/services/tag.py` | + `NOT_NULL_FIELDS = {"tag"}` |
| `backend/src/services/master.py` | + `NOT_NULL_FIELDS = {"first_name", "last_name", "color", "position", "specialty", "sort_order"}` |
| `backend/src/services/service.py` | + `NOT_NULL_FIELDS`, + `patch()` method override |
| `backend/src/services/photo.py` | + `NOT_NULL_FIELDS`, + `patch()` method override |

### New test code (additions to existing test files)

| File | What's added |
|------|-------------|
| `backend/tests/test_api_tags.py` | Patch test class |
| `backend/tests/test_api_materials.py` | Patch test class |
| `backend/tests/test_api_visitors.py` | Patch test class |
| `backend/tests/test_api_masters.py` | Patch test class |
| `backend/tests/test_api_locations.py` | Patch test class |
| `backend/tests/test_api_services.py` | Patch test class (incl. tag_ids) |
| `backend/tests/test_api_photos.py` | Patch test class (incl. tag_ids) |
| `backend/tests/test_api_user_settings.py` | Patch test class |

### Docs

| File | What's modified |
|------|----------------|
| `docs/domain-rules/visitors.md` | + PATCH row in API Endpoints table |
| `docs/domain-rules/locations.md` | + PATCH row |
| `docs/domain-rules/materials.md` | + PATCH row (create file if missing) |
| `docs/domain-rules/tags.md` | + PATCH row (create file if missing) |
| `docs/domain-rules/masters.md` | + PATCH row |
| `docs/domain-rules/services.md` | + PATCH row |
| `docs/domain-rules/photos.md` | + PATCH row (create if missing) |
| `docs/domain-rules/user_settings.md` | + PATCH row (create if missing) |

---

## Task 1: TAGS — Add PATCH endpoint

### Classification: small

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — design spec, section 3.1 (simple entities), section 4 (schema pattern), section 5 (router pattern), section 6 (testing strategy)
- `docs/domain-rules/visitors.md` — not needed for this task, but pattern reference for how domain-rules look

### Task Description

Add `PATCH /api/v1/tags/{tag_id}` endpoint with `TagPatch` schema. Tags have 1 field (`tag`, NOT NULL). Tags currently use `TagCreate` as both create and update schema — no `TagUpdate` exists. We add `TagPatch` as a new schema.

**Step 1: Add TagPatch schema**

File: `backend/src/schemas/tag.py`

Add after `TagCreate`:

```python
class TagPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/tags/{id}).
    All fields optional. None means 'don't change'.
    """
    tag: str | None = None
```

**Step 2: Add NOT_NULL_FIELDS to tag service**

File: `backend/src/services/tag.py`

Read the file first. It uses a factory function returning a plain `GenericService` instance. We need to change it to a subclass with `NOT_NULL_FIELDS`.

If the service file uses a plain `GenericService` instance (no subclass), we need to create a `TagService` subclass. **Keep the existing UpdateSchemaT** (don't change the second type parameter) — the `patch()` method accepts `BaseModel` regardless of the type annotation:

```python
from src.services.generic import GenericService
from src.models.tag import Tag
from src.schemas.tag import TagCreate, TagResponse


class TagService(GenericService[TagCreate, TagCreate, TagResponse]):
    """Tag service with NOT NULL field protection on PATCH."""
    NOT_NULL_FIELDS = {"tag"}
```

Update the factory function to use `TagService` instead of bare `GenericService`.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/tags.py`

Add after the `update_tag` function (before `delete_tag`):

```python
@router.patch("/{tag_id}", response_model=TagResponse)
async def patch_tag(
    tag_id: str,
    data: TagPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Partial-update a tag by ID (PATCH)."""
    tag = await service.patch(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag
```

Also update the import line to include `TagPatch`:
```python
from src.schemas.tag import TagCreate, TagPatch, TagResponse
```

And update the `_ServiceDep` type annotation to use the new `TagService`:
```python
_ServiceDep = Annotated[TagService, Depends(_get_tag_service)]
```

Also update the `_get_tag_service` return type:
```python
def _get_tag_service() -> TagService:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()
```

**Step 4: Write tests**

File: `backend/tests/test_api_tags.py`

Add a `TestTagPatch` class inside the file:

```python
class TestTagPatch:
    """Tests for PATCH /api/v1/tags/{id}."""

    def test_patch_tag_partial_update(self, api_client) -> None:
        """PATCH updates only the sent field."""
        create = api_client.post("/api/v1/tags", json={"tag": "Old"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={"tag": "New"})
        assert response.status_code == 200
        assert response.json()["tag"] == "New"

    def test_patch_tag_not_found_404(self, api_client) -> None:
        """PATCH nonexistent tag returns 404."""
        response = api_client.patch("/api/v1/tags/nonexistent-id", json={"tag": "New"})
        assert response.status_code == 404

    def test_patch_tag_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/tags", json={"tag": "Unchanged"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={})
        assert response.status_code == 200
        assert response.json()["tag"] == "Unchanged"

    def test_patch_tag_null_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL field is silently stripped."""
        create = api_client.post("/api/v1/tags", json={"tag": "KeepMe"})
        tag_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/tags/{tag_id}", json={"tag": None})
        assert response.status_code == 200
        assert response.json()["tag"] == "KeepMe"
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_tags.py -v
```

All tests must pass.

**Step 6: Commit**

```bash
git add backend/src/schemas/tag.py backend/src/services/tag.py backend/src/api/v1/tags.py backend/tests/test_api_tags.py
git commit -m "feat(backend): add PATCH /api/v1/tags/{id} endpoint with TagPatch schema"
```

---

## Task 2: MATERIALS — Add PATCH endpoint

### Classification: small

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.1, 4, 5, 6

### Task Description

Add `PATCH /api/v1/materials/{material_id}` with `MaterialPatch` schema. Materials have 2 fields (`title` NOT NULL, `description` NOT NULL).

**Step 1: Add MaterialPatch schema**

File: `backend/src/schemas/material.py`

Add after `MaterialUpdate`:

```python
class MaterialPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/materials/{id}).
    All fields optional. None means 'don't change'.
    """
    title: str | None = None
    description: str | None = None
```

**Step 2: Add NOT_NULL_FIELDS to material service**

File: `backend/src/services/material.py`

If the service uses bare `GenericService`, create a `MaterialService` subclass. **Keep the existing UpdateSchemaT** — the `patch()` method accepts `BaseModel` regardless:

```python
class MaterialService(GenericService[MaterialCreate, MaterialUpdate, MaterialResponse]):
    """Material service with NOT NULL field protection on PATCH."""
    NOT_NULL_FIELDS = {"title", "description"}
```

Update the factory function to return `MaterialService` instance.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/materials.py`

Add after the `update_material` function:

```python
@router.patch("/{material_id}", response_model=MaterialResponse)
async def patch_material(
    material_id: str,
    data: MaterialPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Partial-update a material by ID (PATCH)."""
    material = await service.patch(db_session=session, id=material_id, data=data)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material
```

Update import: `from src.schemas.material import MaterialCreate, MaterialPatch, MaterialResponse`

Also update `_ServiceDep` to use `MaterialService` (if the service was changed from bare GenericService to MaterialService):
```python
_ServiceDep = Annotated[MaterialService, Depends(_get_material_service)]
```

**Step 4: Write tests**

File: `backend/tests/test_api_materials.py`

```python
class TestMaterialPatch:
    """Tests for PATCH /api/v1/materials/{id}."""

    def test_patch_material_partial_update(self, api_client) -> None:
        """PATCH updates only the sent field."""
        create = api_client.post("/api/v1/materials", json={"title": "Old", "description": "Old desc"})
        material_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/materials/{material_id}", json={"title": "New Title"})
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "New Title"
        assert body["description"] == "Old desc"  # unchanged

    def test_patch_material_not_found_404(self, api_client) -> None:
        """PATCH nonexistent material returns 404."""
        response = api_client.patch("/api/v1/materials/nonexistent-id", json={"title": "New"})
        assert response.status_code == 404

    def test_patch_material_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/materials", json={"title": "Keep", "description": "Keep desc"})
        material_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/materials/{material_id}", json={})
        assert response.status_code == 200
        assert response.json()["title"] == "Keep"
        assert response.json()["description"] == "Keep desc"

    def test_patch_material_null_title_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL title is silently stripped."""
        create = api_client.post("/api/v1/materials", json={"title": "KeepTitle", "description": "desc"})
        material_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/materials/{material_id}", json={"title": None})
        assert response.status_code == 200
        assert response.json()["title"] == "KeepTitle"

    def test_patch_material_null_description_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL description is silently stripped."""
        create = api_client.post("/api/v1/materials", json={"title": "Title", "description": "KeepDesc"})
        material_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/materials/{material_id}", json={"description": None})
        assert response.status_code == 200
        assert response.json()["description"] == "KeepDesc"

    def test_patch_material_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        create = api_client.post("/api/v1/materials", json={"title": "Old", "description": "Old desc"})
        material_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/materials/{material_id}", json={
            "title": "New Title",
            "description": "New Desc",
        })
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "New Title"
        assert body["description"] == "New Desc"
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_materials.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/material.py backend/src/services/material.py backend/src/api/v1/materials.py backend/tests/test_api_materials.py
git commit -m "feat(backend): add PATCH /api/v1/materials/{id} endpoint with MaterialPatch schema"
```

---

## Task 3: VISITORS — Add PATCH endpoint

### Classification: small

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.1, 4, 5, 6
- `docs/domain-rules/visitors.md` — entity fields, API Endpoints table

### Task Description

Add `PATCH /api/v1/visitors/{visitor_id}` with `VisitorPatch` schema. Visitors have 2 patchable fields (`name` NOT NULL, `age` nullable). `client_id` is excluded (business invariant — cannot reassign visitor to different client).

**Step 1: Add VisitorPatch schema**

File: `backend/src/schemas/visitor.py`

Add after `VisitorUpdate`:

```python
class VisitorPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/visitors/{id}).
    All fields optional. None means 'don't change'.

    Note: client_id is NOT patchable — visitors cannot be reassigned
    to a different client.
    """
    name: str | None = None
    age: int | None = None
```

**Step 2: Add NOT_NULL_FIELDS to VisitorService**

File: `backend/src/services/visitor.py`

`VisitorService` already extends `GenericService`. Add `NOT_NULL_FIELDS`:

```python
class VisitorService(GenericService[VisitorCreate, VisitorUpdate, VisitorResponse]):
    """Visitor service with client-based filtering."""
    NOT_NULL_FIELDS = {"name"}

    # ... existing code unchanged
```

Also update the import to include `VisitorPatch` if needed by the type parameter. The GenericService type param for UpdateSchemaT can remain `VisitorUpdate` — the `patch()` method accepts `BaseModel` which `VisitorPatch` is.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/visitors.py`

Add after `update_visitor`:

```python
@router.patch("/{visitor_id}", response_model=VisitorResponse)
async def patch_visitor(
    visitor_id: str,
    data: VisitorPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> VisitorResponse:
    """Partial-update a visitor by ID (PATCH)."""
    visitor = await service.patch(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor
```

Update import: `from src.schemas.visitor import VisitorCreate, VisitorPatch, VisitorResponse, VisitorUpdate`

**Step 4: Write tests**

File: `backend/tests/test_api_visitors.py`

Add `TestVisitorPatch` class:

```python
class TestVisitorPatch:
    """Tests for PATCH /api/v1/visitors/{id}."""

    def test_patch_visitor_name_only(self, api_client) -> None:
        """PATCH updates only name, age preserved."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Alice", "age": 28,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"name": "Alice Updated"})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Alice Updated"
        assert body["age"] == 28  # unchanged

    def test_patch_visitor_age_only(self, api_client) -> None:
        """PATCH updates only age, name preserved."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Bob", "age": 30,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"age": 31})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Bob"  # unchanged
        assert body["age"] == 31

    def test_patch_visitor_not_found_404(self, api_client) -> None:
        """PATCH nonexistent visitor returns 404."""
        response = api_client.patch("/api/v1/visitors/nonexistent-id", json={"name": "New"})
        assert response.status_code == 404

    def test_patch_visitor_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Unchanged", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Unchanged"
        assert body["age"] == 25

    def test_patch_visitor_null_name_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL name silently strips."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "KeepName", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"name": None})
        assert response.status_code == 200
        assert response.json()["name"] == "KeepName"

    def test_patch_visitor_age_to_null(self, api_client) -> None:
        """PATCH can set nullable age to null."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Adult", "age": 25,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={"age": None})
        assert response.status_code == 200
        assert response.json()["age"] is None

    def test_patch_visitor_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        client_id = _create_client(api_client)
        create = api_client.post("/api/v1/visitors", json={
            "client_id": client_id, "name": "Old", "age": 20,
        })
        visitor_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/visitors/{visitor_id}", json={
            "name": "New Name", "age": 21,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "New Name"
        assert body["age"] == 21
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_visitors.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/visitor.py backend/src/services/visitor.py backend/src/api/v1/visitors.py backend/tests/test_api_visitors.py
git commit -m "feat(backend): add PATCH /api/v1/visitors/{id} endpoint with VisitorPatch schema"
```

---

## Task 4: MASTERS — Add PATCH endpoint

### Classification: small

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.1, 4, 5, 6
- `docs/domain-rules/masters.md` — entity fields, validation rules

### Task Description

Add `PATCH /api/v1/masters/{master_id}` with `MasterPatch` schema. Masters have 7 patchable fields (6 NOT NULL: first_name, last_name, color, position, specialty, sort_order; 1 nullable: avatar_url).

**Step 1: Add MasterPatch schema**

File: `backend/src/schemas/master.py`

Add after `MasterUpdate`:

```python
class MasterPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/masters/{id}).
    All fields optional. None means 'don't change'.
    """
    first_name: str | None = None
    last_name: str | None = None
    color: str | None = None
    position: str | None = None
    specialty: str | None = None
    avatar_url: str | None = None
    sort_order: int | None = None
```

**Step 2: Add NOT_NULL_FIELDS to MasterService**

File: `backend/src/services/master.py`

If the service uses bare `GenericService`, create a `MasterService` subclass. **Keep the existing UpdateSchemaT** — the `patch()` method accepts `BaseModel` regardless:

```python
class MasterService(GenericService[MasterCreate, MasterUpdate, MasterResponse]):
    """Master service with NOT NULL field protection on PATCH."""
    NOT_NULL_FIELDS = {"first_name", "last_name", "color", "position", "specialty", "sort_order"}
```

Update factory function to return `MasterService`.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/masters.py`

Add after `update_master` (before `delete_master`). Note: this file has a `/reorder` route — the PATCH must be placed after `/{master_id}` PUT but before `/{master_id}` DELETE:

```python
@router.patch("/{master_id}", response_model=MasterResponse)
async def patch_master(
    master_id: str,
    data: MasterPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Partial-update a master by ID (PATCH)."""
    master = await service.patch(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master
```

Update import: `from src.schemas.master import MasterCreate, MasterPatch, MasterResponse, MasterUpdate`

Also update `_ServiceDep` to use `MasterService` (if the service was changed from bare GenericService to MasterService):
```python
_ServiceDep = Annotated[MasterService, Depends(_get_master_service)]
```

**Step 4: Write tests**

File: `backend/tests/test_api_masters.py`

```python
class TestMasterPatch:
    """Tests for PATCH /api/v1/masters/{id}."""

    def test_patch_master_color_only(self, api_client) -> None:
        """PATCH updates only color, other fields preserved."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Anna", "last_name": "Smith",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={"color": "#FF0000"})
        assert response.status_code == 200
        body = response.json()
        assert body["color"] == "#FF0000"
        assert body["first_name"] == "Anna"  # unchanged

    def test_patch_master_not_found_404(self, api_client) -> None:
        """PATCH nonexistent master returns 404."""
        response = api_client.patch("/api/v1/masters/nonexistent-id", json={"color": "#FF0000"})
        assert response.status_code == 404

    def test_patch_master_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Test", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={})
        assert response.status_code == 200
        assert response.json()["first_name"] == "Test"

    def test_patch_master_null_color_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL color is stripped."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Keep", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={"color": None})
        assert response.status_code == 200
        assert response.json()["color"] == "#5B8C7A"

    def test_patch_master_avatar_url_to_null(self, api_client) -> None:
        """PATCH can set nullable avatar_url to null."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Photo", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
            "avatar_url": "https://example.com/avatar.jpg",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={"avatar_url": None})
        assert response.status_code == 200
        assert response.json()["avatar_url"] is None

    def test_patch_master_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Old", "last_name": "Name",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={
            "first_name": "New", "color": "#FF0000",
        })
        assert response.status_code == 200
        body = response.json()
        assert body["first_name"] == "New"
        assert body["color"] == "#FF0000"
        assert body["last_name"] == "Name"  # unchanged

    def test_patch_master_sort_order(self, api_client) -> None:
        """PATCH can update sort_order."""
        create = api_client.post("/api/v1/masters", json={
            "first_name": "Sorted", "last_name": "Master",
            "color": "#5B8C7A", "position": "мастер", "specialty": "живопись",
        })
        master_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/masters/{master_id}", json={"sort_order": 5})
        assert response.status_code == 200
        assert response.json()["sort_order"] == 5
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_masters.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/master.py backend/src/services/master.py backend/src/api/v1/masters.py backend/tests/test_api_masters.py
git commit -m "feat(backend): add PATCH /api/v1/masters/{id} endpoint with MasterPatch schema"
```

---

## Task 5: LOCATIONS — Add PATCH endpoint

### Classification: small

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.1, 4, 5, 6
- `docs/domain-rules/locations.md` — entity fields, validation rules
- Note: `location.name` rename to `title` tracked in #172, NOT in this scope — use `name` field name as-is

### Task Description

Add `PATCH /api/v1/locations/{location_id}` with `LocationPatch` schema. Locations have 11 patchable fields (3 NOT NULL: name, capacity, sort_order; 8 nullable).

**Step 1: Add LocationPatch schema**

File: `backend/src/schemas/location.py`

Add after `LocationUpdate`:

```python
class LocationPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/locations/{id}).
    All fields optional. None means 'don't change'.
    """
    name: str | None = None
    short_title: str | None = None
    address: str | None = None
    description: str | None = None
    capacity: int | None = None
    yandex_map_url: str | None = None
    review_url: str | None = None
    record_info: str | None = None
    image_url: str | None = None
    location_hint: str | None = None
    sort_order: int | None = None
```

**Step 2: Add NOT_NULL_FIELDS to LocationService**

File: `backend/src/services/location.py`

Create a `LocationService` subclass (if bare GenericService). **Keep the existing UpdateSchemaT** — the `patch()` method accepts `BaseModel` regardless:

```python
class LocationService(GenericService[LocationCreate, LocationUpdate, LocationResponse]):
    """Location service with NOT NULL field protection on PATCH."""
    NOT_NULL_FIELDS = {"name", "capacity", "sort_order"}
```

Update factory function.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/locations.py`

Add after `update_location` (before `delete_location`). Note: this file has a `/reorder` route — place PATCH carefully:

```python
@router.patch("/{location_id}", response_model=LocationResponse)
async def patch_location(
    location_id: str,
    data: LocationPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> LocationResponse:
    """Partial-update a location by ID (PATCH)."""
    location = await service.patch(db_session=session, id=location_id, data=data)
    if not location:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.LOCATION_NOT_FOUND,
                message="Location not found",
            ).model_dump(),
        )
    return location
```

Update import: `from src.schemas.location import LocationCreate, LocationPatch, LocationResponse, LocationUpdate`

Also update `_ServiceDep` to use `LocationService` (if the service was changed from bare GenericService to LocationService):
```python
_ServiceDep = Annotated[LocationService, Depends(_get_location_service)]
```

**Step 4: Write tests**

File: `backend/tests/test_api_locations.py`

```python
class TestLocationPatch:
    """Tests for PATCH /api/v1/locations/{id}."""

    def test_patch_location_capacity_only(self, api_client) -> None:
        """PATCH updates only capacity, other fields preserved."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Test Studio", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"capacity": 30})
        assert response.status_code == 200
        body = response.json()
        assert body["capacity"] == 30
        assert body["name"] == "Test Studio"  # unchanged

    def test_patch_location_not_found_404(self, api_client) -> None:
        """PATCH nonexistent location returns 404."""
        response = api_client.patch("/api/v1/locations/nonexistent-id", json={"capacity": 10})
        assert response.status_code == 404

    def test_patch_location_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Unchanged", "capacity": 15,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={})
        assert response.status_code == 200
        assert response.json()["name"] == "Unchanged"
        assert response.json()["capacity"] == 15

    def test_patch_location_null_name_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL name is stripped."""
        create = api_client.post("/api/v1/locations", json={
            "name": "KeepName", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"name": None})
        assert response.status_code == 200
        assert response.json()["name"] == "KeepName"

    def test_patch_location_null_capacity_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL capacity is stripped."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Studio", "capacity": 20,
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"capacity": None})
        assert response.status_code == 200
        assert response.json()["capacity"] == 20

    def test_patch_location_nullable_field_to_null(self, api_client) -> None:
        """PATCH can set nullable address to null."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Studio", "capacity": 20, "address": "123 Main St",
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={"address": None})
        assert response.status_code == 200
        assert response.json()["address"] is None

    def test_patch_location_multiple_fields(self, api_client) -> None:
        """PATCH updates multiple fields at once."""
        create = api_client.post("/api/v1/locations", json={
            "name": "Old", "capacity": 10, "address": "Old Addr",
        })
        loc_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/locations/{loc_id}", json={
            "name": "New Name", "capacity": 25,
        })
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "New Name"
        assert body["capacity"] == 25
        assert body["address"] == "Old Addr"  # unchanged
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_locations.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/location.py backend/src/services/location.py backend/src/api/v1/locations.py backend/tests/test_api_locations.py
git commit -m "feat(backend): add PATCH /api/v1/locations/{id} endpoint with LocationPatch schema"
```

---

## Task 6: USER_SETTINGS — Add PATCH endpoint

### Classification: trivial

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.3 (standalone service)

### Task Description

Add `PATCH /api/v1/user-settings` endpoint. User settings already has `UserSettingsUpdate` schema with all fields optional and `update_by_user_id()` service method that does partial updates. Just add the HTTP method.

No new schema needed. No service changes needed.

**Step 1: Add @router.patch endpoint**

File: `backend/src/api/v1/user_settings.py`

Add after `update_settings`:

```python
@router.patch("", response_model=UserSettingsResponse)
async def patch_settings(
    user_id: str,
    data: UserSettingsUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Partial-update settings by user_id (PATCH).

    Same behavior as PUT — both use update_by_user_id() with exclude_unset.
    """
    result = await service.update_by_user_id(session, user_id, data)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SETTINGS_NOT_FOUND,
                message="No settings found for user",
            ).model_dump(),
        )
    return result
```

No import changes needed — `UserSettingsUpdate` is already imported.

**Step 2: Write tests**

File: `backend/tests/test_api_user_settings.py`

Add a `TestPatchSettings` class (check existing test patterns in the file first):

```python
class TestPatchSettings:
    """Tests for PATCH /api/v1/user-settings?user_id=..."""

    def test_patch_theme_only(self, api_client, _user) -> None:
        """PATCH updates only theme."""
        # Create settings first
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "dark"
        assert body["language"] == "ru"  # unchanged

    def test_patch_language_only(self, api_client, _user) -> None:
        """PATCH updates only language."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"language": "en"},
        )
        assert response.status_code == 200
        assert response.json()["language"] == "en"
        assert response.json()["theme"] == "light"  # unchanged

    def test_patch_not_found_404(self, api_client, _user) -> None:
        """PATCH for nonexistent user settings returns 404."""
        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={"theme": "dark"},
        )
        assert response.status_code == 404

    def test_patch_empty_body_noop(self, api_client, _user) -> None:
        """PATCH with empty body makes no changes."""
        api_client.post("/api/v1/user-settings", json={
            "user_id": _user["id"], "theme": "light", "language": "ru",
        })

        response = api_client.patch(
            f"/api/v1/user-settings?user_id={_user['id']}",
            json={},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["theme"] == "light"
        assert body["language"] == "ru"
```

**Step 3: Run tests**

```bash
cd backend && uv run pytest tests/test_api_user_settings.py -v
```

**Step 4: Commit**

```bash
git add backend/src/api/v1/user_settings.py backend/tests/test_api_user_settings.py
git commit -m "feat(backend): add PATCH /api/v1/user-settings endpoint (reuses UserSettingsUpdate)"
```

---

## Task 7: SERVICES — Add PATCH endpoint with tag_ids override

### Classification: standard

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.2 (nested tag_ids), 4, 5, 6
- `docs/domain-rules/services.md` — entity fields, validation rules
- Note: tariffs excluded from PATCH (managed via PUT only). #171 tracks TariffService extraction.

### Task Description

Add `PATCH /api/v1/services/{service_id}` with `ServicePatch` schema. Service has 9 scalar fields (7 NOT NULL: title, description, image_url, specialty, min_age, duration, record_info; 2 nullable: max_age, material_hint) + `tag_ids` (M2M links, hard-replace if sent, preserve if not sent).

Requires `ServiceService.patch()` override — the generic `patch()` doesn't handle `tag_ids` (which is not a column on the Service model, it's a join table).

**Step 1: Add ServicePatch schema**

File: `backend/src/schemas/service.py`

Add after `ServiceUpdate`:

```python
class ServicePatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/services/{id}).
    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    ``tariffs``: NOT included — managed via PUT only (see #171 for TariffService extraction).
    """
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    specialty: str | None = None
    min_age: int | None = None
    max_age: int | None = None
    duration: int | None = None
    record_info: str | None = None
    material_hint: str | None = None
    tag_ids: list[str] | None = None
```

**Step 2: Add NOT_NULL_FIELDS + patch() override to ServiceService**

File: `backend/src/services/service.py`

Add `NOT_NULL_FIELDS` to the class:

```python
class ServiceService(GenericService[ServiceCreate, ServiceUpdate, ServiceResponse]):
    """Service service with eager-loaded tariffs/tags and nested create/update."""
    NOT_NULL_FIELDS = {"title", "description", "image_url", "specialty", "min_age", "duration", "record_info"}
```

Add `patch()` method override after `update()` method:

```python
    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: ServicePatch
    ) -> Service | None:
        """Partial-update a service — only sent fields are changed.

        Scalar fields: applied via exclude_unset. NOT NULL fields
        with null values are silently stripped.

        tag_ids: if sent → hard-replace all tag links (delete + insert).
        If not sent → existing tag links are preserved.

        tariffs: NOT touched by PATCH. Use PUT to replace tariffs.
        """
        service = await self.get(db_session, id)
        if not service:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids from scalar fields
        tag_ids = data_dict.pop("tag_ids", None)

        # Strip NOT NULL fields sent as null
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]

        # Apply scalar fields
        for key, value in data_dict.items():
            setattr(service, key, value)

        # Handle tag_ids: if sent (even if empty list), hard-replace links
        if tag_ids is not None:
            await db_session.execute(
                delete(service_tags).where(service_tags.c.service_id == id)
            )
            if tag_ids:
                for tid in tag_ids:
                    await db_session.execute(
                        service_tags.insert().values(
                            service_id=id, tag_id=tid
                        )
                    )

        await db_session.flush()
        db_session.expunge(service)
        return await self.get(db_session, id)
```

The `delete` import is already present at the top of the file (`from sqlalchemy import delete, select`). The `service_tags` import is also present. The `Service` import is also present.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/services.py`

Add after `update_service`:

```python
@router.patch("/{service_id}", response_model=ServiceResponse)
async def patch_service(
    service_id: str,
    data: ServicePatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ServiceResponse:
    """Partial-update a service by ID (PATCH)."""
    svc = await service.patch(db_session=session, id=service_id, data=data)
    if not svc:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SERVICE_NOT_FOUND,
                message="Service not found",
            ).model_dump(),
        )
    return ServiceResponse.model_validate(svc)
```

Update import: `from src.schemas.service import ServiceCreate, ServicePatch, ServiceResponse, ServiceUpdate`

**Step 4: Write tests**

File: `backend/tests/test_api_services.py`

Add a `TestServicePatch` class:

```python
class TestServicePatch:
    """Tests for PATCH /api/v1/services/{id}."""

    def test_patch_service_duration_only(self, api_client) -> None:
        """PATCH updates only duration, other fields preserved."""
        # Create a tag to use later
        tag = api_client.post("/api/v1/tags", json={"tag": "popular"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Test Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tariffs": [{"title": "Adult", "price": 3500}],
            "tag_ids": [tag["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"duration": 120})
        assert response.status_code == 200
        body = response.json()
        assert body["duration"] == 120
        assert body["title"] == "Test Service"  # unchanged
        # Tariffs preserved (not touched by PATCH)
        assert len(body["tariffs"]) == 1
        assert body["tariffs"][0]["title"] == "Adult"
        # Tags preserved (not sent in patch)
        assert len(body["tags"]) == 1
        assert body["tags"][0]["tag"] == "popular"

    def test_patch_service_not_found_404(self, api_client) -> None:
        """PATCH nonexistent service returns 404."""
        response = api_client.patch("/api/v1/services/nonexistent-id", json={"duration": 120})
        assert response.status_code == 404

    def test_patch_service_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/services", json={
            "title": "Keep", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={})
        assert response.status_code == 200
        assert response.json()["title"] == "Keep"

    def test_patch_service_null_title_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL title is stripped."""
        create = api_client.post("/api/v1/services", json={
            "title": "KeepTitle", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"title": None})
        assert response.status_code == 200
        assert response.json()["title"] == "KeepTitle"

    def test_patch_service_max_age_to_null(self, api_client) -> None:
        """PATCH can set nullable max_age to null."""
        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 18,
            "duration": 90, "record_info": "info",
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"max_age": None})
        assert response.status_code == 200
        assert response.json()["max_age"] is None

    def test_patch_service_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "tag1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "tag2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "tag3"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        service_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        # Replace with only tag3
        response = api_client.patch(f"/api/v1/services/{service_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "tag3"

    def test_patch_service_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        # Patch a scalar field, don't send tag_ids
        response = api_client.patch(f"/api/v1/services/{service_id}", json={"duration": 60})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve"

    def test_patch_service_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove"}).json()

        create = api_client.post("/api/v1/services", json={
            "title": "Service", "description": "desc",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
            "tag_ids": [tag1["id"]],
        })
        service_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/services/{service_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_services.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/service.py backend/src/services/service.py backend/src/api/v1/services.py backend/tests/test_api_services.py
git commit -m "feat(backend): add PATCH /api/v1/services/{id} endpoint with tag_ids handling"
```

---

## Task 8: PHOTOS — Add PATCH endpoint with tag_ids override

### Classification: standard

### Required Docs
- `docs/specs/2026-07-22-patch-all-entities-design.md` — section 3.2 (nested tag_ids), 4, 5, 6

### Task Description

Add `PATCH /api/v1/photos/{photo_id}` with `PhotoPatch` schema. Photos have 5 scalar fields (2 NOT NULL: filename, is_public; 3 nullable: visitor_id, service_id, activity_id) + `tag_ids` (M2M links via ORM relationship).

Requires `PhotoService.patch()` override — the generic `patch()` doesn't handle `tag_ids`.

**Step 1: Add PhotoPatch schema**

File: `backend/src/schemas/photo.py`

Add after `PhotoUpdate`:

```python
class PhotoPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/photos/{id}).
    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    """
    filename: str | None = None
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool | None = None
    tag_ids: list[str] | None = None
```

**Step 2: Add NOT_NULL_FIELDS + patch() override to PhotoService**

File: `backend/src/services/photo.py`

Add `NOT_NULL_FIELDS` to the class:

```python
class PhotoService(GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]):
    """Extended photo service with tag handling."""
    NOT_NULL_FIELDS = {"filename", "is_public"}
```

Add `patch()` method after `update()`:

```python
    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: PhotoPatch
    ) -> PhotoResponse | None:
        """Partial-update a photo — only sent fields are changed.

        Scalar fields: applied via exclude_unset. NOT NULL fields
        with null values are silently stripped.

        tag_ids: if sent → hard-replace all tag links via ORM relationship.
        If not sent → existing tags are preserved.
        """
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids from scalar fields
        tag_ids = data_dict.pop("tag_ids", None)

        # Strip NOT NULL fields sent as null
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]

        # Apply scalar fields
        for key, value in data_dict.items():
            setattr(orm, key, value)

        # Handle tag_ids: if sent (even if empty list), replace tags
        if tag_ids is not None:
            if tag_ids:
                result = await db_session.execute(
                    select(Tag).where(Tag.id.in_(tag_ids))
                )
                tags = result.scalars().all()
                orm.tags = list(tags)
            else:
                orm.tags = []

        await db_session.flush()
        # Reload with tags eagerly loaded
        return await self.get(db_session, id)
```

The `select` and `Tag` imports are already present at the top of the file.

**Step 3: Add @router.patch endpoint**

File: `backend/src/api/v1/photos.py`

Read the file first. Add after `update_photo`:

```python
@router.patch("/{photo_id}", response_model=PhotoResponse)
async def patch_photo(
    photo_id: str,
    data: PhotoPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> PhotoResponse:
    """Partial-update a photo by ID (PATCH)."""
    photo = await service.patch(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo
```

Update import to include `PhotoPatch`: `from src.schemas.photo import PhotoCreate, PhotoPatch, PhotoResponse, PhotoUpdate`

**Step 4: Write tests**

File: `backend/tests/test_api_photos.py`

Read the existing test file first to match patterns (how photos are created in tests). Add a `TestPhotoPatch` class:

```python
class TestPhotoPatch:
    """Tests for PATCH /api/v1/photos/{id}."""

    def test_patch_photo_is_public_only(self, api_client) -> None:
        """PATCH updates only is_public, filename preserved."""
        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": False,
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"is_public": True})
        assert response.status_code == 200
        body = response.json()
        assert body["is_public"] is True
        assert body["filename"] == "test.jpg"  # unchanged

    def test_patch_photo_not_found_404(self, api_client) -> None:
        """PATCH nonexistent photo returns 404."""
        response = api_client.patch("/api/v1/photos/nonexistent-id", json={"is_public": True})
        assert response.status_code == 404

    def test_patch_photo_empty_body(self, api_client) -> None:
        """PATCH with empty body makes no changes."""
        create = api_client.post("/api/v1/photos", json={
            "filename": "keep.jpg", "is_public": False,
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={})
        assert response.status_code == 200
        assert response.json()["filename"] == "keep.jpg"

    def test_patch_photo_null_filename_stripped(self, api_client) -> None:
        """PATCH with null for NOT NULL filename is stripped."""
        create = api_client.post("/api/v1/photos", json={
            "filename": "keepname.jpg", "is_public": False,
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"filename": None})
        assert response.status_code == 200
        assert response.json()["filename"] == "keepname.jpg"

    def test_patch_photo_visitor_id_to_null(self, api_client) -> None:
        """PATCH can set nullable visitor_id to null."""
        # Create a client + visitor first
        client = api_client.post("/api/v1/clients", json={
            "name": "Test", "phone": "+79990001234", "email": None, "channel": "telegram",
        }).json()
        visitor = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Test Visitor",
        }).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": False,
            "visitor_id": visitor["id"],
        })
        photo_id = create.json()["id"]
        assert create.json()["visitor_id"] == visitor["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"visitor_id": None})
        assert response.status_code == 200
        assert response.json()["visitor_id"] is None

    def test_patch_photo_tag_ids_replaces(self, api_client) -> None:
        """PATCH with tag_ids replaces all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-1"}).json()
        tag2 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-2"}).json()
        tag3 = api_client.post("/api/v1/tags", json={"tag": "photo-tag-3"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"], tag2["id"]],
        })
        photo_id = create.json()["id"]
        assert len(create.json()["tags"]) == 2

        # Replace with only tag3
        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={
            "tag_ids": [tag3["id"]],
        })
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "photo-tag-3"

    def test_patch_photo_without_tag_ids_preserves(self, api_client) -> None:
        """PATCH without tag_ids preserves existing tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "preserve-photo"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        # Patch a scalar field, don't send tag_ids
        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"is_public": False})
        assert response.status_code == 200
        tags = response.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["tag"] == "preserve-photo"

    def test_patch_photo_tag_ids_empty_clears(self, api_client) -> None:
        """PATCH with empty tag_ids clears all tag links."""
        tag1 = api_client.post("/api/v1/tags", json={"tag": "remove-photo"}).json()

        create = api_client.post("/api/v1/photos", json={
            "filename": "test.jpg", "is_public": True,
            "tag_ids": [tag1["id"]],
        })
        photo_id = create.json()["id"]

        response = api_client.patch(f"/api/v1/photos/{photo_id}", json={"tag_ids": []})
        assert response.status_code == 200
        assert response.json()["tags"] == []
```

**Step 5: Run tests**

```bash
cd backend && uv run pytest tests/test_api_photos.py -v
```

**Step 6: Commit**

```bash
git add backend/src/schemas/photo.py backend/src/services/photo.py backend/src/api/v1/photos.py backend/tests/test_api_photos.py
git commit -m "feat(backend): add PATCH /api/v1/photos/{id} endpoint with tag_ids handling"
```

---

## Task 9: Full test suite run + domain-rules updates

### Classification: small

### Required Docs
- All 8 domain-rules files (see file structure table above)

### Task Description

Run the full backend test suite to ensure nothing is broken, then update domain-rules markdown files.

**Step 1: Run full backend test suite**

```bash
cd backend && uv run pytest -v --tb=short
```

All tests must pass — both existing and new PATCH tests.

If any test fails, fix before proceeding.

**Step 2: Update domain-rules markdown files**

For each of the 8 entities, add a PATCH row to the API Endpoints table in the corresponding `docs/domain-rules/<entity>.md` file.

If the file doesn't exist for an entity (materials, tags, photos, user_settings), create a minimal one based on the pattern of existing files (e.g., `docs/domain-rules/visitors.md`).

For each entity, add this row to the API Endpoints table:

```markdown
| PATCH | /api/v1/<entity>/{id} | Partial update |
```

Or for user_settings:

```markdown
| PATCH | /api/v1/user-settings | Partial update (by user_id query param) |
```

**Step 3: Commit**

```bash
git add docs/domain-rules/
git commit -m "docs: update domain-rules with PATCH endpoints for all entities"
```

---

## Definition of Done

- [ ] All 8 PATCH endpoints respond correctly (200 OK on success, 404 on not found)
- [ ] NOT_NULL_FIELDS protect all NOT NULL columns from null PATCH values
- [ ] tag_ids hard-replace works for services and photos (sent = replace, not sent = preserve)
- [ ] Existing PUT endpoints are NOT broken
- [ ] Full backend test suite passes
- [ ] Domain-rules updated for all 8 entities
- [ ] All commits are clean and atomic