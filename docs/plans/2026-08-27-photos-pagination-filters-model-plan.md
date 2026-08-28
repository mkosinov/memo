# Photos: Server Pagination + Filters + Model Expansion — Implementation Plan

- **Spec:** `docs/specs/2026-08-22-photos-pagination-filters-model-design.md` (G1b-approved, commit `b666e65`)
- **Issue:** GH #211 (absorbs #222, closed as absorbed)
- **Date:** 2026-08-27
- **Branch:** `photos-server-list-211` (worktree created off updated main AFTER G2 approval — both IMPL gates #139/#212 are merged)
- **Baseline:** fresh worktree requires `uv sync --extra dev` in `backend/` before pytest runs (spec §12.7)

## Behavioral Delta (G2 summary)

**User-visible (admin UI):**
1. /photos becomes server-paginated: 10 rows/page, honest totals, working pager; search box (≥2 chars) hits the server (`q` on filename); sort only on Файл/Публичное/Дата, default «Дата» ↓.
2. New filter bar above the table: Клиент (typeahead), Активность (typeahead), Услуга (select), Локация (select), Теги (multi-chips, AND), Сбросить. Any filter/search change resets to page 1.
3. Columns: «Посетитель» replaced by «Клиент» (real names via `client_name`), «Услуга»/«Локация» show resolved titles, «Активность» hidden by default (raw id until #213), new «Дата» column.
4. PhotoModal: «Клиент» picker replaces «Посетитель»; new «Локация» picker; picking Активность now CLEARS Услуга (auto-fill removed — they are mutually exclusive owners); submitting with 2+ owners shows a 422 error in the modal.
5. Location-owned photos (standalone gallery: interiors/venues) are a first-class thing.
6. Activity labels become canonical project-wide: «dd.mm.yyyy HH:mm — Локация — Услуга» (date-first, segments omitted when absent) via ONE shared `formatActivityLabel` — PhotoModal options/selected value, PhotosFilters typeahead; PhotoModal's datetime-only special case removed.

**API:**
6. `GET /api/v1/photos` → `PaginatedResponse[PhotoResponse]` with `page/per_page/q/client_id/location_id/activity_id/service_id/tag_id[]/sort_by/sort_order`; 422 on invalid params; unknown filter ids → empty page; `client_name` denormalized in the response.
7. `visitor_id` removed everywhere; `client_id` + `location_id` added (4-owner exclusive arc, DB CHECK + API validation); Client/Location hard-delete leaves photos owner-less (auto-nullify in the #207 dry-run tree).
8. `GET /photos/web` behavior unchanged.

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/models/photo.py` | modify | 4-owner columns, CHECK constraint, client/location relationships |
| `backend/src/admin/setup.py` | modify | PhotoAdmin column_list: `visitor_id` → `client_id`/`location_id` (import-time coupling) |
| `backend/alembic/versions/<new>_photos_owner_columns.py` | create | batch migration: drop visitor_id, add client_id/location_id + FKs + CHECK |
| `backend/src/domain/deletion.py` | modify | Client→photos, Location→photos nullify deps; remove Visitor→photos |
| `backend/src/services/visitor.py` | modify | drop photos nullify step from cascade |
| `backend/src/schemas/photo.py` | modify | PhotoListParams/PhotoSortBy, owner validators, response fields |
| `backend/src/services/photo.py` | rewrite `list`/`create`/`update`/`patch` | paginated custom list + owner-field create + merged-set owner validation |
| `backend/src/api/v1/photos.py` | modify | GET "" params + PaginatedResponse |
| `backend/src/seed/seed.py` | modify | photos section rewrite (mutually-exclusive owners) |
| `backend/tests/test_seed.py` | modify | pin update |
| `backend/tests/test_api_photos.py` | rewrite | full contract matrix + legacy test updates |
| `backend/tests/services/test_delete_cascades.py` | modify | `_insert_photo` helper, visitor-test rework, client/location photos nullify tests |
| `backend/tests/domain/test_deletion.py` | modify | exact-dep-set assertions gain `photos` |
| `backend/tests/test_models.py` | modify | `test_photo_crud` field assertions |
| `packages/api-client/src/schemas.ts` | modify | PhotoResponseSchema fields, PhotoListResponseSchema |
| `packages/api-client/src/endpoints.ts` | modify | getPhotos(params) |
| `packages/api-client/tests/schemas.test.ts`, `packages/api-client/tests/endpoints.test.ts` | modify | photo contracts (incl. getWebPhotos unchanged) |
| `frontend/admin/contexts/PhotosContext.tsx` | rewrite | server context (RecordsContext pattern) + services/locations maps |
| `frontend/admin/contexts/__tests__/PhotosContext.test.tsx` | rewrite | server semantics tests |
| `frontend/admin/lib/utils.ts` | modify | `formatActivityLabel(activity, locationsMap)` + date-first time part (next to `formatActivityStart:117`) |
| `frontend/admin/__tests__/utils.test.ts` (or colocated suite) | create | formatter unit tests (spec §10.3) |
| `frontend/admin/app/(main)/photos/components/PhotosFilters.tsx` | create | filter bar |
| `frontend/admin/app/(main)/photos/photoColumns.tsx` | modify | 8 columns |
| `frontend/admin/app/(main)/photos/components/PhotoModal.tsx` | modify | client/location pickers, auto-fill removal |
| `frontend/admin/app/(main)/photos/photoFields.tsx` | modify | select field type if needed |
| `frontend/admin/app/(main)/photos/page.tsx` (+ PhotosTable) | modify | wire filters + context |
| `frontend/admin/e2e/photos-crud.spec.ts` + new specs | modify/create | honest assertions + filters |
| `docs/domain-rules/{photos,visitors,clients,locations}.md` | modify | sync rules |
| `docs/specs/2026-08-19-list-search-q-design.md` | modify | one-line supersession note |

## Conventions & Commands

- Backend tests: `cd backend && uv run pytest tests/<file> -x` (full: `uv run pytest`). DB recreate for local runs: `./scripts/recreate_dev_db.sh` — needed after the migration lands.
- Frontend unit: `cd frontend/admin && npm run test -- <pattern>`; UI-touching tasks: `npm run test:all`. E2E: `npx playwright test e2e/<spec>.spec.ts` (verify script name once via `npm run` — dev-workflow skill is authoritative).
- TDD: RED → GREEN → REFACTOR per task. Commit after each task.
- Line references below are from main @ `b666e65`; if lines shifted, locate by symbol name.

---

## Task 1 — Model + migration + CHECK + deletion matrix (ONE atomic commit)

**Classification: large** (breaking schema change + deletion domain; must land as one commit per spec §6.1 atomicity).

**Transitional-red warning:** the model change in this task breaks `PhotoService.create/update` (they still reference `visitor_id`, `services/photo.py:65-71,100`) — existing `test_api_photos.py` POST/PUT/PATCH tests go RED here and are RESTORED by Task 3. Expected and accepted (spec atomicity binds migration+matrix+visitor-cascade into this one commit; service/schema code follows in Tasks 2-3 before anything is pushed). Task 1 verification therefore runs only deletion/seed/migration tests (1e).

### 1a. RED tests first

In the existing deletion-cascade test file `backend/tests/services/test_delete_cascades.py` (fixture names follow `backend/tests/conftest.py`: sync `api_client` for HTTP, `db_session` for direct ORM, data factories per pytest-patterns) — UPDATE first, then ADD:

- UPDATE `backend/tests/services/test_delete_cascades.py` `_insert_photo(...)` helper (`:106-114`): replace `visitor_id` param with `client_id`/`location_id`.
- REWORK that file's `test_visitor_delete_cascades_to_visits_and_nullifies_photos` (`:212`): visitor deletion no longer touches photos — keep the visits cascade assertion, drop the photos-nullify assertion, rename to `..._cascades_to_visits`.
- UPDATE `backend/tests/domain/test_deletion.py` exact-dep-set assertions (`:194`, `:245`): `FK_MATRIX[Client]` → `{"records","visitors","client_tags","photos"}`, `FK_MATRIX[Location]` → `{"activities","location_tags","photos"}`.
- UPDATE `backend/tests/test_models.py:382` `test_photo_crud`: replace `fetched.visitor_id is None` with `fetched.client_id is None` / `fetched.location_id is None`.
- ADD:

```python
def test_client_hard_delete_nullifies_photos(api_client, db_session):
    # create client + photo owned by it; hard-delete client with resolutions;
    # assert photo row survives with client_id IS NULL
    ...

def test_location_hard_delete_nullifies_photos(api_client, db_session):
    # same shape for location_id
    ...

def test_photos_single_owner_check_constraint(db_session):
    from src.models.photo import Photo
    p1 = Photo(filename="a.jpg", client_id=C1, service_id=S1)
    db_session.add(p1)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
```

Also a migration smoke test if one exists for other migrations (locate via `grep -rln "alembic" backend/tests/`); otherwise rely on `recreate_dev_db.sh` running `alembic upgrade head` in Task 1 verification.

### 1b. Model — `backend/src/models/photo.py`

```python
from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, Text, Table, Column

class Photo(AbstractModel):
    __tablename__ = "photos"
    __table_args__ = (
        CheckConstraint(
            "(client_id IS NOT NULL) + (service_id IS NOT NULL) + "
            "(activity_id IS NOT NULL) + (location_id IS NOT NULL) <= 1",
            name="ck_photos_single_owner",
        ),
    )

    filename: Mapped[str] = mapped_column(Text)
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
    )
    service_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("services.id"), nullable=True)
    activity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
    location_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)

    client = relationship("Client", foreign_keys=[client_id])
    location = relationship("Location", foreign_keys=[location_id])
    # tags relationship + photo_tags table unchanged
```

Delete the `visitor_id` column and its relationship if present.

Update `backend/src/admin/setup.py:97` in the SAME commit: `PhotoAdmin.column_list` references `Photo.visitor_id` at module import (`main.py:14` imports `setup_admin` unconditionally) — swap to `client_id`/`location_id`, or the app fails to import after the model change and EVERY `api_client` test dies (not just photos).

### 1c. Migration — `cd backend && uv run alembic revision -m "photos owner columns client location check"`, then fill:

```python
def upgrade() -> None:
    with op.batch_alter_table("photos") as batch_op:
        batch_op.drop_column("visitor_id")
        batch_op.add_column(sa.Column("client_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("location_id", sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            "fk_photos_client_id", "clients", ["client_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_photos_location_id", "locations", ["location_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_check_constraint(
            "ck_photos_single_owner",
            "(client_id IS NOT NULL) + (service_id IS NOT NULL) + "
            "(activity_id IS NOT NULL) + (location_id IS NOT NULL) <= 1",
        )

def downgrade() -> None:
    with op.batch_alter_table("photos") as batch_op:
        batch_op.drop_constraint("ck_photos_single_owner", type_="check")
        batch_op.drop_constraint("fk_photos_location_id", type_="foreignkey")
        batch_op.drop_constraint("fk_photos_client_id", type_="foreignkey")
        batch_op.drop_column("location_id")
        batch_op.drop_column("client_id")
        batch_op.add_column(sa.Column("visitor_id", sa.String(36), nullable=True))
```

Verify `alembic/env.py` does not enable `PRAGMA foreign_keys` on the migration connection (spec §6.1); if it does, disable for batch ops.

### 1d. Deletion matrix — `backend/src/domain/deletion.py`

Template = Service→photos entry (`deletion.py:147-150` + counter `:269-273` + handler `:465-471` + registration `:584-587`):

```python
# In FK_MATRIX["clients"] deps (and analogously ["locations"]):
"photos": FKDependency(entity="photos", nullable=True, action="nullify", auto=True),

# Counters:
async def _count_c_photos(db, eid): ...   # SELECT COUNT(*) WHERE photos.client_id = :eid
async def _count_l_photos(db, eid): ...   # WHERE photos.location_id = :eid

# Handlers:
async def _h_nullify_client_photos(db, eid):
    await db.execute(update(Photo).where(Photo.client_id == eid).values(client_id=None))

async def _h_nullify_location_photos(db, eid):
    await db.execute(update(Photo).where(Photo.location_id == eid).values(location_id=None))
```

Register in `NULLIFY_HANDLERS` with the exact key convention the file uses. REMOVE the Visitor→photos nullify: matrix entry + handler + the `UPDATE photos SET visitor_id=NULL` in `services/visitor.py:62` cascade and `deletion.py:555-556,568-574`.

### 1e. Verify + commit (single commit!)

```bash
cd backend && uv run pytest tests/services/test_delete_cascades.py tests/test_seed.py -x   # deletion+seed only — photos API suite is transitionally red until Task 3 (see warning above)
./scripts/recreate_dev_db.sh   # runs alembic upgrade head + seed — must succeed
uv run alembic downgrade -1 && uv run alembic upgrade head   # round-trip BOTH succeed (spec §6.1/§13)
git add -A && git commit -m "feat(#211): photos 4-owner model + migration + CHECK + deletion matrix (atomic)"
```

---

## Task 2 — Schemas: params, validators, response

**Classification: standard.**

### 2a. RED tests (`backend/tests/test_api_photos.py` — params section)

```python
@pytest.mark.parametrize("bad", [
    {"page": 0}, {"per_page": 0}, {"per_page": 101},
    {"q": "a"}, {"q": "x" * 101}, {"sort_by": "client_id"}, {"sort_order": "up"},
])
def test_photos_list_params_422(api_client, bad):
    r = api_client.get("/api/v1/photos", params=bad)
    assert r.status_code == 422

def test_photo_create_two_owners_422(api_client):
    r = api_client.post("/api/v1/photos",
                        json={"filename": "a.jpg", "client_id": C1, "service_id": S1})
    assert r.status_code == 422
```

### 2b. `backend/src/schemas/photo.py`

```python
from typing import Annotated, Literal
from pydantic import Field, model_validator
from src.schemas.common import SortOrder
from src.schemas.pagination import PaginationParams

PhotoSortBy = Literal["filename", "is_public", "created_at"]
OWNER_FIELDS = ("client_id", "service_id", "activity_id", "location_id")

def _reject_multiple_owners(values: dict) -> dict:
    owners = [f for f in OWNER_FIELDS if values.get(f) is not None]
    if len(owners) > 1:
        raise ValueError(f"photo may have at most one owner; got: {', '.join(owners)}")
    return values

class PhotoCreate(BaseModel):
    filename: str
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool = False
    tag_ids: list[str] = []
    _owners = model_validator(mode="before")(_reject_multiple_owners)

class PhotoUpdate(BaseModel):  # same fields; filename + is_public required (PUT full replace)
    ...
    _owners = model_validator(mode="before")(_reject_multiple_owners)

class PhotoPatch(BaseModel):  # all optional; no payload validator (merged-set check lives in the service)
    ...

class PhotoListParams(PaginationParams):
    q: str | None = Field(default=None, min_length=2, max_length=100)
    client_id: str | None = None
    location_id: str | None = None
    activity_id: str | None = None
    service_id: str | None = None
    tag_id: list[str] | None = Field(
        default=None,
        description="repeatable; AND semantics — photo must have ALL selected tags",
    )
    sort_by: PhotoSortBy = "created_at"
    sort_order: SortOrder = "desc"

class PhotoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    filename: str
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool = False
    tags: list[PhotoTagResponse] = []
    client_name: str | None = None
    created_at/updated_at  # keep whatever PhotoResponse carries today
```

**Injection constraint (FastAPI #12481):** the GET handler takes ALL list params via the single `Annotated[PhotoListParams, Query()]` model — no extra scalar query params.

### 2c. Commit

`git commit -m "feat(#211): PhotoListParams + 4-owner validators + response schema"`

---

## Task 3 — PhotoService.list rewrite + router + merged-set validation

**Classification: large.**

### 3a. RED tests (contract matrix — extend `test_api_photos.py`)

Fixture photos: `p_client` (client C1), `p_client2` (C1), `p_act` (activity A1, A1.service=S1, A1.location=L1), `p_svc` (service S2, no activity), `p_loc` (location L2, owner=location only), `p_tags` (tags [T1,T2]), `p_tag1` (tags [T1]), all distinct filenames sharing a searchable substring where needed.

**All tests sync TestClient style** (`api_client` fixture per conftest — pytest-patterns skill). Shared fixture:

```python
@pytest.fixture()  # FUNCTION-scoped: autouse reset_db truncates per test (conftest.py:145-156) — the 7 photos are recreated each test
def photos_fixture(api_client):
    # create clients C1, locations L1/L2, activities A1 (service S1, location L1),
    # services S1/S2, tags T1/T2 via API; then the 7 photos via POST:
    # p_client, p_client2 (C1), p_act (A1), p_svc (S2), p_loc (L2 only), p_tags ([T1,T2]), p_tag1 ([T1])
    ...

CASES = [
    ("plain", {}, {"p_client","p_client2","p_act","p_svc","p_loc","p_tags","p_tag1"}),
    ("page2_empty_for_7_per_10", {"page": 2}, set()),                      # 7 items, per_page 10
    ("q_substring_ci", {"q": "CARD"}, {card-owned filenames}),             # case-insensitive
    ("client_filter", {"client_id": C1}, {"p_client","p_client2"}),
    ("location_direct_only", {"location_id": L1}, set()),                  # p_act's ACTIVITY is at L1 — still empty
    ("location_owned", {"location_id": L2}, {"p_loc"}),
    ("service_variant_a", {"service_id": S1}, {"p_act"}),                  # via activity
    ("service_variant_a_direct", {"service_id": S2}, {"p_svc"}),           # direct
    ("tags_and", {"tag_id": [T1, T2]}, {"p_tags"}),                        # AND: p_tag1 has only T1
    ("tags_dup_dedup", {"tag_id": [T1, T1]}, {"p_tags","p_tag1"}),
    ("unknown_filter_empty", {"client_id": "00000000-0000-0000-0000-000000000000"}, set()),
    ("two_owner_filters_empty", {"client_id": C1, "service_id": S2}, set()),
    ("q_and_filter", {"q": "p_", "client_id": C1}, {"p_client","p_client2"}),
]
@pytest.mark.parametrize("name,params,expected", CASES)
def test_photos_filter_matrix(api_client, photos_fixture, name, params, expected): ...

def test_photos_sort_and_tiebreak(api_client, photos_fixture): ...  # filename asc/desc, is_public asc (False first), created_at desc default + id tiebreak
def test_photos_client_name(api_client, photos_fixture): ...       # p_client → client_name == C1.name; p_act → None; archived client still resolves
def test_photos_envelope(api_client, photos_fixture): ...          # items/total/page/per_page honest under service filter (no double-count)
def test_put_single_owner_conflicts_row(api_client, photos_fixture): ...  # PUT {location_id: L2} on p_client → 422 (exclude_unset hole, spec §6.2)
def test_patch_adding_second_owner_422(api_client, photos_fixture): ...   # PATCH {service_id: S2} on p_client → 422
def test_patch_nulling_ok(api_client, photos_fixture): ...                # PATCH {client_id: None} on p_client → 200, owner-less
def test_zero_owner_and_location_only_ok(api_client): ...                 # POST without owners → 201; POST location-only → 201
```

**Legacy test updates in the same file (cannot be "restored" by the service rewrite — rewrite them):** `test_patch_photo_visitor_id_to_null` (`:243`) → client_id-to-null; `test_patch_photo_empty_body_noop` (`:270-284`) → assert the new optional fields instead of `visitor_id`; `test_list_photos_empty` (`:102`) and `test_deleted_photo_not_in_list` (`:164`) → envelope shape (`r.json()["items"] == []`).

### 3b. `backend/src/services/photo.py` — rewrite `list` + `create` + merged-set checks in `update`/`patch`

`create()` (`services/photo.py:65-71`): swap the hardcoded `visitor_id=data.visitor_id` for the new owner fields (payload validator from Task 2 already guarantees ≤1 owner):

```python
photo = Photo(
    filename=data.filename,
    client_id=data.client_id,
    service_id=data.service_id,
    activity_id=data.activity_id,
    location_id=data.location_id,
    is_public=data.is_public,
)
# tag_ids handling unchanged
```

```python
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import selectinload
from src.models.activity import Activity
from src.models.client import Client
from src.models.photo import Photo
from src.models.tag import Tag
from src.repositories.search import SearchField, search_predicate
from src.schemas.photo import PhotoListParams, PhotoResponse

_SORT_COLUMNS = {
    "filename": Photo.filename,
    "is_public": Photo.is_public,
    "created_at": Photo.created_at,
}

async def list(self, db_session, params: PhotoListParams) -> tuple[list[PhotoResponse], int]:
    """Accepted exception to repo-owned list (GH #206, spec #211 §6.5):
    service-owned dual query — filters, q, sort, denormalized client_name."""
    client_name = select(Client.name).where(Client.id == Photo.client_id).scalar_subquery()
    stmt = select(Photo, client_name.label("client_name")).options(selectinload(Photo.tags))

    conds = []
    if params.q is not None:
        conds.append(search_predicate(params.q, [SearchField(column=Photo.filename, kind="substring")]))
    if params.client_id is not None:
        conds.append(Photo.client_id == params.client_id)
    if params.location_id is not None:
        conds.append(Photo.location_id == params.location_id)
    if params.activity_id is not None:
        conds.append(Photo.activity_id == params.activity_id)
    if params.service_id is not None:
        # variant A: direct OR via activity — LEFT OUTER JOIN required
        stmt = stmt.outerjoin(Activity, Activity.id == Photo.activity_id)
        conds.append(or_(Photo.service_id == params.service_id,
                         Activity.service_id == params.service_id))
    if params.tag_id:
        for t in dict.fromkeys(params.tag_id):          # dedupe, keep order
            conds.append(Photo.tags.any(Tag.id == t))   # per-tag EXISTS, AND-chained
    if conds:
        stmt = stmt.where(*conds)

    col = _SORT_COLUMNS[params.sort_by]
    stmt = stmt.order_by(col.desc() if params.sort_order == "desc" else col.asc(), Photo.id.asc())

    total = (await db_session.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (await db_session.execute(
        stmt.limit(params.per_page).offset((params.page - 1) * params.per_page)
    )).all()

    items = []
    for photo, name in rows:
        resp = PhotoResponse.model_validate(photo)
        resp.client_name = name
        items.append(resp)
    return items, total
```

Merged-set guard used by BOTH `update` and `patch` (after building the change dict, before setattr loop):

```python
def _merged_owner_conflict(existing: Photo, changes: dict) -> str | None:
    owners = {f: changes.get(f, getattr(existing, f)) for f in OWNER_FIELDS}
    active = [k for k, v in owners.items() if v is not None]
    return ", ".join(active) if len(active) > 1 else None

# in update()/patch():
conflict = _merged_owner_conflict(photo_obj, changes)
if conflict:
    raise HTTPException(status_code=422,
                        detail=f"photo may have at most one owner; got: {conflict}")
```

### 3c. Router — `backend/src/api/v1/photos.py`

```python
from typing import Annotated
from fastapi import Query
from src.schemas.common import PaginatedResponse
from src.schemas.photo import PhotoListParams, PhotoResponse

@router.get("", response_model=PaginatedResponse[PhotoResponse])
async def list_photos(
    params: Annotated[PhotoListParams, Query()],
    service: PhotoService = Depends(get_photo_service),
    db_session: AsyncSession = Depends(get_db),
):
    items, total = await service.list(db_session, params)
    return PaginatedResponse(items=items, total=total,
                             page=params.page, per_page=params.per_page)
```

(Adjust to the file's actual Depends wiring.) `GET /web` and the CRUD endpoints stay as-is.

### 3d. Run + commit

```bash
cd backend && uv run pytest tests/test_api_photos.py -x
git commit -m "feat(#211): paginated PhotoService.list + q/filters/sort + merged-set owner validation"
```

---

## Task 4 — Seed rewrite + pin

**Classification: small.**

`backend/src/seed/seed.py` photos section (currently `:448-469`, 7 photos — keep count 7):
- 2 client-owned (SAME client → supports client-filter e2e; distinct filenames sharing substring "client" for q tests)
- 1 service-owned (card image, service S)
- 2 activity-owned (guest photos, tag `guest` preserved) — their activities' `location_id` = L1
- 1 location-OWNED (interior shot, owner slot = location L1) → scenario 5 co-location pin: location filter L1 returns ONLY the location-owned photo, NOT the activity-owned ones
- 1 tag-pair photo: tags [T1, T2]; reuse `p_tag1` shape: one of the activity photos carries only [T1] → AND demo (both tags → only the pair photo)
- NO photo combines location_id with another owner (CHECK forbids it).

Update seed pins in `backend/tests/test_seed.py`: count-7 pin (`:132-141`) → assert ≥1 location-owned, the both-tags pair exists, no multi-owner row. ALSO update `test_seed_photos_guest_tagged` (`:143-151`): it asserts exactly 2 `photo_tags` rows — the new layout grows this to 5 (guest ×2 activity photos, T1+T2 pair, T1 single); recompute from the final layout and pin the exact number.

Commit: `feat(#211): seed rewrite — mutually exclusive owners, location gallery, tag pair`

---

## Task 5 — api-client

**Classification: standard.**

`schemas.ts`: `PhotoResponseSchema` — drop `visitor_id`, add `client_id/location_id/client_name` (nullable); add:

```ts
export const PhotoListResponseSchema = paginatedSchema(PhotoResponseSchema);
export type PhotoListResponse = z.infer<typeof PhotoListResponseSchema>;
```

`endpoints.ts` — add a param'd plain-clients fetch (today only no-arg `getClients()` `:309` and param'd `getClientsWithStats()` `:313` exist; photo typeaheads need the light list). getRecords is the serialization template — repeated params via `search.append`:

```ts
export interface ClientListParams { q?: string; per_page?: number; page?: number; status?: "active" | "archived"; }
// photo pickers always request status: "active" — archived clients must not surface (spec §7.3)

export async function getClientsPaged(params: ClientListParams): Promise<PaginatedResponse<Client>> {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) s.set(k, String(v));
  return request(`/api/v1/clients?${s}`);
}
```

```ts
export interface PhotoListParams {
  page?: number; per_page?: number; q?: string;
  client_id?: string; location_id?: string; activity_id?: string; service_id?: string;
  tag_id?: string[]; sort_by?: "filename" | "is_public" | "created_at";
  sort_order?: "asc" | "desc";
}

export async function getPhotos(params?: PhotoListParams): Promise<PhotoListResponse> {
  const s = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (k === "tag_id") (v as string[]).forEach((t) => s.append("tag_id", t));
      else s.set(k, String(v));
    }
  }
  return request(`/api/v1/photos${s.size ? `?${s}` : ""}`);
}
```

Contract tests: rewrite photo sections in `schemas.test.ts` (new fields + paginated parse) and `endpoints.test.ts` (URL building incl. repeated `tag_id`, q, filters, sort; PLUS an explicit `getWebPhotos` unchanged assertion — spec §10.2). Commit: `feat(#211): api-client paginated photos`

---

## Task 6 — PhotosContext server rewrite

**Classification: standard.**

Replace the #139 client adapter (swap-point comment `PhotosContext.tsx:7-13`) with a hand-rolled server context modeled on `RecordsContext.tsx` (state + query key + setFilters page-reset + /all dictionaries + `keepPreviousData`). Core shape:

```tsx
export interface PhotoFilters {
  client_id?: string; activity_id?: string; service_id?: string;
  location_id?: string; tag_id: string[];
}
const EMPTY_FILTERS: PhotoFilters = { tag_id: [] };

// state: page, perPage = 10, sortBy = "created_at", sortOrder = "desc",
//        search (context contract name; mapped to q in the query), filters
const query = useQuery({
  queryKey: ["photos", { page, perPage, sortBy, sortOrder, q: search || undefined, ...filters }],
  queryFn: () => getPhotos({
    page, per_page: perPage, sort_by: sortBy, sort_order: sortOrder,
    q: search || undefined, ...filters,
    tag_id: filters.tag_id.length ? filters.tag_id : undefined,
  }),
  placeholderData: keepPreviousData,
});

// setFilters/setSearch reset page to 1 (RecordsContext precedent :100-103)
// page-clamp effect when page > totalPages (last-row-deleted case)
// dictionary loads: getAllServices() + getAllLocations() once → servicesMap, locationsMap
```

Export the `PagedListState`-aligned shape the DataTable consumes (`items/total/page/perPage/…` per #139 contract) plus `filters/setFilters`, `resetFilters` (clears filters + search, page 1), `servicesMap`, `locationsMap`. Context field stays `search`/`setSearch` (contract name; maps to `q` at the fetcher — spec §7.2).

Rewrite `PhotosContext.test.tsx` (6 tests pin client-side slicing — replace): query key composition, page reset on setFilters/setSearch, ≥2-char clamp (no fetch below 2), per_page=10, sort mapping, page-clamp, maps load. Run `npm run test`. Commit: `feat(#211): PhotosContext server-driven`

---

## Task 7 — `formatActivityLabel` shared formatter

**Classification: small.**

Create in `frontend/admin/lib/utils.ts` (next to `formatActivityStart:117-121`, which stays untouched for other consumers):

```ts
// Date-first activity label — THE canonical project-wide representation (spec §7.7, user-ruled 2026-08-27)
export function formatActivityDateTime(iso: string): string {
  // «dd.mm.yyyy HH:mm», SAME local-time semantics as formatActivityStart (#212) — only the order changes
}

export interface ActivityLike {
  start: string;
  location_id?: string | null;
  service_title?: string | null;
}

export function formatActivityLabel(a: ActivityLike, locationsMap: Map<string, { title: string }>): string {
  // «{dd.mm.yyyy HH:mm} — {location title} — {service_title}»
  // Build parts array [dateTime, locationTitle, serviceTitle], drop absent segments
  // (location: only when locationsMap resolves the id — archived locations are NOT in the active-only
  // /locations/all map → segment silently omitted, no dangling «—»), join with « — ».
}
```

RED first (`utils` test suite): date-first order; full 3-segment label; no location → 2 segments; no service_title → 2 segments; neither → date-time only; archived/unresolvable location_id → segment omitted; no dangling separators in any combination. GREEN → implement. `npm run test`. Commit: `feat(#211): formatActivityLabel canonical activity label helper`

---

## Task 8 — PhotosFilters component

**Classification: standard.**

Create `frontend/admin/app/(main)/photos/components/PhotosFilters.tsx` — layout modeled on `BookingFilters.tsx` (flex-wrap, label+control markup, Сбросить button styled like records' reset). Controls:

```tsx
// Клиент: SearchableSelect, onSearch={(q) => getClientsPaged({ q, per_page: 10, status: "active" }).then(r => r.items.map(clientOption))}
// Активность: SearchableSelect, onSearch={(q) => getActivities({ q, per_page: 10 }).then(mapActivityOption)}
// Услуга: <select> over servicesMap (or getAllServices) — «Все услуги» empty option
// Локация: <select> over locationsMap — «Все локации»
// Теги: chips + add-typeahead (PhotoModal multi-emulation pattern, PhotoModal.tsx:49-94) over getAllTags()
// Сбросить: onClick={() => resetFilters()}
// every control change → setFilters({...filters, <field>: value}) → context resets page to 1
```

Activity options use the canonical label: map items via `formatActivityLabel(a, locationsMap)` (context map from Task 6) into a `label` field the SearchableSelect renders (`displayField: 'label'`). Wire into the photos page above PhotosTable. Unit tests (`PhotosFilters.test.tsx`): renders 5 controls + reset; change → setFilters called with right payload; activity options carry the canonical label (mocked getActivities + locationsMap); chips add/remove. Run `npm run test`. Commit: `feat(#211): PhotosFilters bar`

---

## Task 9 — photoColumns + PhotoModal

**Classification: standard.**

`photoColumns.tsx` — exact final array (sortable ONLY filename/is_public/created_at; sortField values match `PhotoSortBy`):

```tsx
export const photoColumns: ColumnDef<PhotoResponse>[] = [
  previewColumn,                                             // not sortable, defaultVisible
  { key: "filename", header: "Файл", sortField: "filename", render: (p) => p.filename },
  { key: "client", header: "Клиент", render: (p) => p.client_name ?? "—" },
  { key: "service", header: "Услуга", render: (p) => servicesMap.get(p.service_id ?? "")?.title ?? "—" },
  { key: "location", header: "Локация", render: (p) => locationsMap.get(p.location_id ?? "")?.title ?? "—" },
  { key: "activity", header: "Активность", defaultVisible: false, render: (p) => p.activity_id ?? "—" },
  { key: "is_public", header: "Публичное", sortField: "is_public", render: badge },
  { key: "created_at", header: "Дата", sortField: "created_at", render: (p) => formatDate(p.created_at) },
];
```

(Column/render signatures follow the existing file's `ColumnDef` — adapt names, keep LS key `photos-columns`.)

`PhotoModal.tsx` + `photoFields.tsx`:
1. Remove «Посетитель» field; add «Клиент» searchable field: `onSearch → getClientsPaged({ q, per_page: 10, status: "active" })`.
2. Add «Локация» picker: plain `<select>` over `getAllLocations()` — extend the field-type union with a `select` member (options prop) if `photoFields.tsx` lacks one.
3. REMOVE the activity→service auto-fill effect (`PhotoModal.tsx:118-121`); replace with mutually-exclusive pair semantics:

```tsx
useEffect(() => { setForm((f) => f.service_id ? { ...f, service_id: null } : f); },
  [form.activity_id]);  // picking an activity clears service
useEffect(() => { setForm((f) => f.activity_id ? { ...f, activity_id: null } : f); },
  [form.service_id]);   // and vice versa
```

(Implement with the file's actual state mechanism — the semantic requirement is: setting one of the pair clears the other; no auto-fill.)
4. Server 422 on ≥2 owners surfaces via the existing error catch — no new mechanics.
5. **Canonical activity label (spec §7.7):** in the activity branch, stop pre-formatting `start` via `formatActivityStart` + `displayField: 'service_title'` (`photoFields.tsx:48-55`, `PhotoModal.tsx:109-133`) — map options to `{...a, label: formatActivityLabel(a, locationsMap)}` with `displayField: 'label'`, `subtitleField: undefined`, for BOTH dropdown rows and the selected-value rendering. REMOVE the "datetime-only when service already selected" displayField special case (`PhotoModal.tsx:121-125`). The modal's `getAllLocations()` map (location picker, step 2) feeds the label — no extra fetch. Update `__tests__/PhotoModal.test.tsx` label assertions (`:231-232` currently expects `service_title` + «HH:mm dd.mm.yyyy») to the canonical date-first form. Verification grep (unification proof, spec §7.7 consumer list): `grep -rn "formatActivityStart\|subtitleField" frontend/admin --include="*.tsx" | grep -v __tests__` — remaining `formatActivityStart` hits must be inside `lib/utils.ts` only (or pre-existing non-photos consumers, if any appear — unify them to the formatter too).

Tests: `photoColumns` render + sortable flags + defaultVisible; PhotoModal — client picker present/visitor absent, location picker, activity-clears-service and vice versa, canonical label in options + selected value, 422 mock surfaces. `npm run test:all`. Commit: `feat(#211): photo columns + modal pickers + owner replace semantics + canonical activity label`

---

## Task 10 — E2E

**Classification: standard.**

`frontend/admin/e2e/photos-crud.spec.ts` updates + new specs (real backend, no `page.route`; full-cycle: create data via API, assert in UI):

1. Pagination honest: create 11 photos via API → table shows 10 + `11 всего`; page 2 shows 1 row.
2. Search: type ≥2 chars matching known filename → only matches; 1 char → no request fired (assert via `waitForResponse` absence); ✕ clears.
3. Client filter: typeahead select → only that client's photos; «Клиент» column shows names not UUIDs.
4. Service filter (variant A): pick service → direct + activity-derived photos both visible.
5. Location filter: pick L1 → location-OWNED photo visible; activity-owned photos at L1 NOT visible (seed pin from Task 4).
6. Tags AND: select T1+T2 chips → only the pair photo.
7. Modal: create photo with client + location; attempt client+service → error surfaced; activity pick clears service field; selected activity value displays the canonical label («dd.mm.yyyy HH:mm — …», date-first visible).
8. `clients-delete-cascade.spec.ts`: extend with photos — client with photos → dry-run tree lists photos auto-nullify; after delete, photo row shows «Клиент» = «—».

Run the photos + clients-delete e2e suites; `npm run test:all` green. Commit: `test(#211): honest photos e2e — pagination/search/filters/modal`

---

## Task 11 — Docs

**Classification: trivial.**

1. `docs/domain-rules/photos.md`: fields table (4 owners + client_name response field + location_id), Cross-field rule (≤1 owner, 422 on ≥2, DB CHECK), Invariants (+ group copies independent rows; owner-less allowed), endpoints table (paginated + params), Business Logic (AND tag filter, variant A service filter).
2. `docs/domain-rules/visitors.md`: remove Photo relationship.
3. `docs/domain-rules/clients.md` + `locations.md`: delete-cascade sections gain "photos → nullify (auto)".
4. `docs/domain-rules/activities.md` (create if absent): pin `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»` as the PROJECT-WIDE activity display convention (spec §7.7 — shared formatter, segment omission, #213 cross-pin); back-ref from photos.md.
4. `docs/specs/2026-08-19-list-search-q-design.md`: add supersession note near the photos non-goal line — "Amended by #211 (2026-08-27): photos list now has server `q`."

Commit: `docs(#211): domain rules + #212 spec supersession note`

---

## Final verification (before docser/finishing)

```bash
cd backend && uv run pytest            # full suite green
cd frontend/admin && npm run test:all  # unit + e2e green
cd frontend/admin && npx playwright test e2e/photos-crud.spec.ts e2e/clients-delete-cascade.spec.ts
```

Acceptance: walk spec §13 checklist; visual compliance §14 at the visual gate (Step 4.5).
