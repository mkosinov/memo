# #493 Photo Public Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous photo showcase moves to `GET /api/v1/public/photos` (minimal per-audience schema, ADR-015's first resident); bare `GET /photos` + `GET /photos/{id}` close to anonymous via `photos:read`; web gallery + api-client migrate; test pins follow.

**Architecture:** Route split per spec/ADR-015 — new dedicated router `backend/src/api/v1/public.py` mounted at `/api/v1/public`; the shared composite `list_photos_view` gains an `item_mapper` seam (overloads, default path byte-identical) reused by a thin `list_public_photos_view` with forced `is_public=True`; `PUBLIC_ROUTES` swaps −2/+1; `ALLOWED_UNSCOPED` gains the new route; frontend consumes a new typed `getPublicPhotos`.

**Tech Stack:** FastAPI + pydantic v2 + SQLAlchemy (backend), zod + vitest (api-client), React Query + vitest (web).

**Спека:** `docs/specs/2026-11-08-photo-public-contract-design.md` (rev 3) · **ADR:** `docs/decisions/015-api-url-audience-namespaces.md`. Behavioral Delta живёт в спеке §4 — план её не повторяет.

**Команды тестов:** backend — `cd backend && uv run pytest <file> -q` (полный прогон: `cd backend && uv run pytest -q`); api-client — `pnpm --filter @memo/api-client test`; web — `pnpm --filter @memo/web test`.

---

## Task 1: Public surface — schema, service seam, `/api/v1/public/photos` route
### Classification: standard
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.1 (схема), §6.2 (маррут), §6.3 (allowlist/ALLOWED_UNSCOPED), §3 сценарии 1–2
- `.opencode/skills/pytest-patterns/SKILL.md` — fixtures/TestClient-паттерны
- `docs/decisions/015-api-url-audience-namespaces.md` — clause 1-2 (почему префикс + conscious allowlist)

### Files
- `backend/src/schemas/photo.py` — add `PhotoPublicResponse` (after `PhotoResponse`)
- `backend/src/services/photo.py` — `item_mapper` overloads on `list_photos_view` (~:386); new `list_public_photos_view` (next to it)
- `backend/src/api/v1/public.py` — NEW router
- `backend/src/main.py` — import + `include_router` (~:27 imports, ~:264 mounts)
- `backend/src/auth/public.py` — `PUBLIC_ROUTES` + entry; docstring bullet (~:11-15)
- `backend/tests/test_master_scope_contract.py` — `ALLOWED_UNSCOPED` entry (~:111)
- `backend/tests/test_list_id_uniform_guards.py` — pin 19 → 20 (~:52)
- `backend/tests/test_auth_permissions.py` — точный allowlist-пин: + `("GET", "/api/v1/public/photos")` (~:210-246)
- `backend/tests/test_api_photos.py` — `anon_client` fixture + `TestPhotosPublicRoute`

### Task Description
Создать публичную витрину: минимальная схема, сервисный шов, маршрут в новом неймспейсе, allowlist-записи, пины, RED-GREEN тесты сценариев 1–2. Bare photo GET остаются публичными до Task 2 (каждый шаг зелёный).

### Steps

- [ ] **RED.** В `backend/tests/test_api_photos.py` добавь fixture (форма — копия `test_auth_guards.py:97-108`) и тест-класс:

```python
@pytest.fixture
def anon_client(app):
    """A FRESH TestClient with an empty cookie jar (anonymous view)."""
    client = TestClient(app)
    yield client
    client.close()
```

(импорт `TestClient` — как в `test_auth_guards.py`; `app` уже есть в conftest). Класс — рядом с `TestPhotosListContract`:

```python
class TestPhotosPublicRoute:
    """#493 сценарии 1–2: публичная витрина ``/api/v1/public/photos``."""

    def test_minimal_schema_public_only(
        self, api_client, anon_client, photos_fixture
    ) -> None:
        public = photos_fixture["p_client"]    # создан с is_public=True
        private = photos_fixture["p_client2"]  # дефолт: private
        # непустая выдача тегов: публикуем фото с тегами (tag id — из ответа p_tags)
        tag_ids = [t["id"] for t in photos_fixture["p_tags"]["tags"]]
        tagged = api_client.post(
            PHOTOS_URL,
            json={
                "filename": "p_public_tagged.jpg",
                "is_public": True,
                "tag_ids": tag_ids,
            },
        )
        assert tagged.status_code == 201, tagged.text

        resp = anon_client.get("/api/v1/public/photos")
        assert resp.status_code == 200, resp.text
        ids = [p["id"] for p in resp.json()["items"]]
        assert public["id"] in ids
        assert private["id"] not in ids
        assert tagged.json()["id"] in ids
        for item in resp.json()["items"]:
            assert set(item.keys()) == {"id", "filename", "tags"}
            assert all(isinstance(t, str) for t in item["tags"])
        tagged_item = next(
            p for p in resp.json()["items"] if p["id"] == tagged.json()["id"]
        )
        assert tagged_item["tags"]  # непусто: теги-строки реально проходят

    def test_id_filter_ands_with_forced_is_public(
        self, anon_client, photos_fixture
    ) -> None:
        """Guard 1 #371: ``?id=`` опубликован и AND-ится с форсом is_public —
        приватный id через фильтр не достаётся."""
        public = photos_fixture["p_client"]
        private = photos_fixture["p_client2"]

        picked = anon_client.get(
            "/api/v1/public/photos", params={"id": public["id"]}
        )
        assert picked.status_code == 200, picked.text
        assert [p["id"] for p in picked.json()["items"]] == [public["id"]]

        bypass = anon_client.get(
            "/api/v1/public/photos", params={"id": private["id"]}
        )
        assert bypass.status_code == 200, bypass.text
        assert bypass.json()["items"] == []

    def test_owner_filters_not_wired_unknown_params_ignored(
        self, anon_client, photos_fixture
    ) -> None:
        baseline = anon_client.get("/api/v1/public/photos")
        assert baseline.status_code == 200, baseline.text
        baseline_ids = [p["id"] for p in baseline.json()["items"]]

        probed = anon_client.get(
            "/api/v1/public/photos",
            params={
                "client_id": "00000000-0000-0000-0000-000000000000",
                "is_public": "false",
                "q": "zz-no-such-phrase",
                "sort_by": "filename",
            },
        )
        assert probed.status_code == 200, probed.text
        assert [p["id"] for p in probed.json()["items"]] == baseline_ids
```

- [ ] Запусти: `cd backend && uv run pytest tests/test_api_photos.py::TestPhotosPublicRoute -q` → оба теста падают (404: маршрута нет).
- [ ] **Схема.** В `backend/src/schemas/photo.py` после класса `PhotoResponse`:

```python
class PhotoPublicResponse(BaseModel):
    """Public gallery photo — deliberately NOT PhotoResponse (ADR-015).

    Audience schema for the anonymous showcase ``GET /api/v1/public/photos``:
    only what the web gallery consumes. Tags resolve to plain title strings
    server-side (the ``MyPhotoItem`` convention, ``schemas/my.py``).
    Owner/service fields, timestamps and ``is_public`` never leave through
    this schema — ``is_public`` is a forced constant on the route.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    tags: list[str] = []
```

- [ ] **Сервисный шов.** В `backend/src/services/photo.py`: в backend включены ruff TC-правила (flake8-type-checking), поэтому импорты, используемые ТОЛЬКО в аннотациях, кладём в `TYPE_CHECKING`-блок: `from collections.abc import Callable` и `from src.schemas.pagination import PaginationParams` → TYPE_CHECKING; runtime-импорты: `from typing import TypeVar, overload` и `PhotoPublicResponse` (конструируется) — `PhotoPublicResponse` добавь в существующий import из `src.schemas.photo`. Над `list_photos_view` (:386):

```python
ResponseT = TypeVar("ResponseT")


@overload
async def list_photos_view(
    db_session: AsyncSession,
    params: PhotoListParams,
    master_key: str | None = ...,
    *,
    item_mapper: None = ...,
) -> tuple[list[PhotoResponse], int]: ...


@overload
async def list_photos_view(
    db_session: AsyncSession,
    params: PhotoListParams,
    master_key: str | None = ...,
    *,
    item_mapper: Callable[[Photo], ResponseT],
) -> tuple[list[ResponseT], int]: ...
```

Реализацию функции поменяй только в хвосте (маппинг :470-475) и сигнатуре:

```python
async def list_photos_view(
    db_session: AsyncSession,
    params: PhotoListParams,
    master_key: str | None = None,
    *,
    item_mapper: Callable[[Photo], PhotoResponse | ResponseT] | None = None,
) -> tuple[list[PhotoResponse | ResponseT], int]:
```

и в цикле маппинга (ветка `item_mapper is None` — текущее поведение байт-в-байт: `model_validate` + `resp.client_name = name`; else — `items.append(item_mapper(photo))`). Всё между сигнатурой и циклом (stmt/filters/order/limit) не трогай.

- [ ] **Публичный композит.** Сразу после `list_photos_view`:

```python
async def list_public_photos_view(
    db_session: AsyncSession,
    params: PaginationParams,
) -> tuple[list[PhotoPublicResponse], int]:
    """``/api/v1/public/photos`` showcase composite (ADR-015).

    Forced ``is_public=True``, pinned default sort (``created_at desc`` +
    ``id asc`` — the shared list defaults), minimal per-audience schema.
    Owner filters are unreachable: only the PaginationParams brick is
    wired through. The admin ``client_name`` subquery still runs (shared
    stmt) but its result is dropped by the explicit item mapper
    (``MyPhotoItem`` pattern — ``tag.title`` strings).
    """

    list_params = PhotoListParams(
        page=params.page,
        per_page=params.per_page,
        id=params.id,
        is_public=True,
    )

    def _public_item(photo: Photo) -> PhotoPublicResponse:
        return PhotoPublicResponse(
            id=photo.id,
            filename=photo.filename,
            tags=sorted(tag.title for tag in photo.tags),
        )

    return await list_photos_view(
        db_session, list_params, item_mapper=_public_item
    )
```

Осознанное решение (спека §6.2 допускает оба варианта — выбираем меньший диф): `client_name`-subquery остаётся в общем stmt, его результат отбрасывается маппером; отключение потребовало бы разрезания композита — не делаем.

- [ ] **Роутер.** Новый файл `backend/src/api/v1/public.py`:

```python
"""Anonymous showcase routes — the ``/api/v1/public`` namespace (ADR-015).

Audience: anonymous callers. The prefix alone exposes nothing: every route
here also carries an explicit ``PUBLIC_ROUTES`` allowlist entry (the
default-deny walk, ``src/auth/public.py``). Schemas are minimal
per-audience variants — never the admin contract (``MyPhotoItem``
precedent, ``schemas/my.py``).
"""

from typing import Annotated

from fastapi import APIRouter, Query

from src.db import SessionDep
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.photo import PhotoPublicResponse
from src.services.photo import list_public_photos_view

router = APIRouter(tags=["public"])


@router.get("/photos", response_model=PaginatedResponse[PhotoPublicResponse])
async def list_public_photos(
    session: SessionDep,
    params: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[PhotoPublicResponse]:
    """Public gallery list: forced ``is_public=True``, pinned sort
    (``created_at desc`` + ``id asc``), minimal schema (tags — title
    strings). Owner filters are not wired; unknown query params are
    ignored (repo convention: silent result, not 4xx)."""
    items, total = await list_public_photos_view(session, params)
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page
    )
```

- [ ] **Маунт.** В `backend/src/main.py`: импорт `from src.api.v1.public import router as public_router` вставь в алфавитном порядке между position и records (ruff `I001`); маунт `app.include_router(public_router, prefix="/api/v1/public")` — рядом со строкой photos-маунта (:264).
- [ ] **Линт/типы шва.** Линт-гейт как в CI: `cd backend && uv run python scripts/lint_budget.py` (бюджетный скрипт; новые TC/I001-нарушения не должны поднимать счётчики — если поднял, перенеси импорт в TYPE_CHECKING/исправь порядок); mypy, если он в CI-workflow, — по изменённым файлам.
- [ ] **Allowlist.** В `backend/src/auth/public.py`: в `PUBLIC_ROUTES` после блока activities добавь:

```python
    # ADR-015: anonymous showcase namespace. The prefix exposes nothing —
    # entries here ARE the exposure (default-deny walk).
    ("GET", "/api/v1/public/photos"),
```

В docstring (:11-15) добавь строку-буллет после словарной: `- ``GET /api/v1/public/photos`` — the photo showcase (ADR-015 audience namespace; bare photo GETs stay until GH #493 closes them).`
- [ ] **Scope-контракт.** В `backend/tests/test_master_scope_contract.py`, в `ALLOWED_UNSCOPED` (кластер dictionary/auth, ~:114):

```python
    ("GET", "/api/v1/public/photos"): "public showcase (ADR-015): forced is_public=True, minimal schema, unscoped by design",
```

- [ ] **Пин пагинации.** `backend/tests/test_list_id_uniform_guards.py` (:52): `EXPECTED_PAGINATED_LISTS = 20`; в комментарий над пином допиши `+ GET /api/v1/public/photos (#493)`.
- [ ] **Пин точного allowlist.** `backend/tests/test_auth_permissions.py` (:210-246): в frozenset-литерал добавь `("GET", "/api/v1/public/photos"),` (две bare-фото-записи пока ОСТАЮТСЯ — они уходят в Task 2).
- [ ] **GREEN-прогон:** `cd backend && uv run pytest tests/test_api_photos.py::TestPhotosPublicRoute tests/test_auth_contract.py tests/test_auth_permissions.py tests/test_auth_guards.py tests/test_list_id_uniform_guards.py tests/test_master_scope_contract.py -q` → всё зелёное (сценарии 1–2 спеки покрыты; walk/stale/paginated/scope пины сходятся).
- [ ] `git add -A && git commit -m "feat(photos): public showcase route /api/v1/public/photos (#493)"`

**DoD:** сценарии 1–2 спеки проходят (RED→GREEN); default-deny walk, точный allowlist-пин, scope-walk, пин пагинации — зелёные.

---

## Task 2: Close bare photo GETs — `photos:read` guard, allowlist −2, pin migrations
### Classification: standard
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.3 (закрытие + allowlist), §6.5 (миграции пинов), §3 сценарий 3
- `docs/domain-rules/auth.md` — Public Access (механизм default-deny), Roles & Permissions (`photos:read` у мастера)

### Files
- `backend/src/api/v1/photos.py` — `_READ_GUARD` + декораторы list/get
- `backend/src/auth/public.py` — −2 записи + комментарий #479 + docstring
- `backend/tests/test_api_photos.py` — `TestPhotosBareGetClosed`
- `backend/tests/test_auth_permissions.py` — точный пин −2
- `backend/tests/test_auth_guards.py` — `_PUBLIC_GETS` swap
- `backend/tests/test_master_scope_photos.py` — переписать анонимный кейс (:367-382)

### Task Description
Закрыть анонимный доступ к bare GET (401), убрать старые allowlist-записи, мигрировать пины старой публичной поверхности. Сценарии 4–5 (админ/мастер без изменений) подтверждаются существующими зелёными тестами.

### Steps

- [ ] **RED.** В `backend/tests/test_api_photos.py` рядом с `TestPhotosPublicRoute`:

```python
class TestPhotosBareGetClosed:
    """#493 сценарий 3: bare GET закрыты от анонима (staff-only, photos:read)."""

    def test_anonymous_list_gets_401(self, anon_client) -> None:
        resp = anon_client.get("/api/v1/photos")
        assert resp.status_code == 401, resp.text

    def test_anonymous_single_get_gets_401(
        self, anon_client, photos_fixture
    ) -> None:
        photo_id = photos_fixture["p_client"]["id"]
        resp = anon_client.get(f"/api/v1/photos/{photo_id}")
        assert resp.status_code == 401, resp.text
```

- [ ] Запусти: `cd backend && uv run pytest tests/test_api_photos.py::TestPhotosBareGetClosed -q` → падают (200 ≠ 401).
- [ ] **Guard.** В `backend/src/api/v1/photos.py` сразу после `router = APIRouter(tags=["photos"])` (:38):

```python
_READ_GUARD = [Depends(require_permission("photos:read"))]
```

В декоратор `list_photos` (`@router.get("", ...)`, ~:111) и `get_photo` (`@router.get("/{photo_id}", ...)`) добавь аргумент `dependencies=_READ_GUARD`, сохранив все прочие аргументы декораторов. Тела функций и scope-зависимости (`get_optional_scope`/`get_scope`) не трогай: guard срабатывает раньше и отсекает только анонима.
- [ ] **Docstring-чистка photos.py.** Перепиши docstring/комментарии `list_photos` и `get_photo` (:111-139), упоминающие анонимную галерею / публичный список с `?is_public=true`, под staff-only семантику (витрина — `/api/v1/public/photos`, ADR-015). Это последний носитель старой формулировки после правки `public.py`.
- [ ] **Allowlist −2.** В `backend/src/auth/public.py` удали записи `("GET", "/api/v1/photos")`, `("GET", "/api/v1/photos/{id}")` и следующий за ними комментарий `# GH #479 (Изменение 4): ... photos/web ...` (строки ~:49-52). В docstring (:11-15) перепиши словарную строку-буллет: фото уходит из перечисления словарей, вместо неё — `photos` НЕ анонимно: `bare photo GETs are staff-only (photos:read); the showcase lives at GET /api/v1/public/photos (ADR-015)`. Строку-буллет про public-неймспейс из Task 1 сведи с этой формулировкой (одна строка, без «until»).
- [ ] **Точный пин.** `backend/tests/test_auth_permissions.py`: из frozenset-литерала удали `("GET", "/api/v1/photos"),` и `("GET", "/api/v1/photos/{id}"),` (запись `/api/v1/public/photos` добавлена в Task 1 — итог: −2 +1).
- [ ] **`_PUBLIC_GETS`.** `backend/tests/test_auth_guards.py` (~:86-94): замени элемент `"/api/v1/photos"` на `"/api/v1/public/photos"`; docstring модуля (:15) и `TestPublicSurface`, если упоминают фото-список, — переформулируй под витрину `/public/photos`.
- [ ] **Анонимный кейс scope-файла.** `backend/tests/test_master_scope_photos.py` (:367-382) — замени метод целиком:

```python
    def test_anonymous_public_route_sees_foreign_public_photo(
        self, photo_scope_world, api_client, anon_client,
    ) -> None:
        """Anonymous showcase moved to ``/api/v1/public/photos`` (#493):
        the foreign master's public photo IS listed; items carry exactly
        id/filename/tags — no owner fields, no is_public key."""
        patch = api_client.patch(
            f"/api/v1/photos/{photo_scope_world['foreign']['photo']['id']}",
            json={"is_public": True},
        )
        assert patch.status_code == 200, patch.text
        resp = anon_client.get("/api/v1/public/photos")
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        ids = [p["id"] for p in items]
        assert photo_scope_world["foreign"]["photo"]["id"] in ids
        assert all(set(p.keys()) == {"id", "filename", "tags"} for p in items)
```

- [ ] **GREEN-прогон:** `cd backend && uv run pytest tests/test_api_photos.py tests/test_auth_contract.py tests/test_auth_permissions.py tests/test_auth_guards.py tests/test_master_scope_photos.py tests/test_master_scope_contract.py -q` → зелёное (сценарий 3 закрыт; сценарии 4–5 — существующие CRUD/scope-тесты в этих файлах зелёные без правок).
- [ ] `git add -A && git commit -m "feat(photos): close bare GETs to anonymous — photos:read guard, allowlist swap (#493)"`

**DoD:** сценарий 3 проходит (RED→GREEN); сценарии 4–5 (существующие админ/мастер тесты) зелёные без правок контракта.

---

## Task 3: api-client — public schemas + `getPublicPhotos`
### Classification: standard
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.4 (api-client часть)
- `packages/api-client/src/endpoints.test.ts` — блок `describe('getPhotos')` (:338-349) как образец
- `packages/api-client/src/schemas.test.ts` — блок `describe('PhotoResponseSchema')` (:1424) как образец

### Files
- `packages/api-client/src/schemas.ts` — `PhotoPublicResponseSchema` (после `PhotoResponseSchema` ~:251) + envelope (~:1183)
- `packages/api-client/src/endpoints.ts` — стереть устаревший комментарий (:365-366) + `getPublicPhotos`
- `packages/api-client/src/schemas.test.ts`, `packages/api-client/src/endpoints.test.ts` — новые describe-блоки

### Task Description
Типизированная публичная поверхность в api-client: зеркало §6.1 (теги — строки), конверт `paginatedSchema`, метод на `/api/v1/public/photos`; полный `PhotoResponseSchema` не меняется.

### Steps

- [ ] **RED (schemas).** В `schemas.test.ts` рядом с `describe('PhotoResponseSchema')` добавь по образцу соседнего блока:

```ts
describe('PhotoPublicResponseSchema (#493: ADR-015 audience schema)', () => {
  it('accepts the minimal public shape with string tags', () => {
    const parsed = PhotoPublicResponseSchema.parse({
      id: 'p1',
      filename: '/images/gallery/p1.jpg',
      tags: ['масло', 'акварель'],
    });
    expect(parsed.tags).toEqual(['масло', 'акварель']);
  });

  it('defaults tags to [] and strips owner keys (zod non-strict)', () => {
    const parsed = PhotoPublicResponseSchema.parse({ id: 'p2', filename: 'f.jpg' });
    expect(parsed.tags).toEqual([]);
    const withOwner = PhotoPublicResponseSchema.parse({
      id: 'p2', filename: 'f.jpg', client_id: null,
    } as never) as Record<string, unknown>;
    expect(withOwner).not.toHaveProperty('client_id'); // extra keys stripped, owner data never typed
  });
});
```

(импорты — как у соседних describe; zod-объекты в этом файле не strict — лишние ключи стрипаются, что и проверяет второй кейс.)

- [ ] **GREEN (schemas).** В `schemas.ts` после блока `PhotoResponseSchema` + `PhotoResponse` (~:251):

```ts
/** #493: public gallery photo — minimal audience schema (ADR-015);
 * tags are plain title strings (server resolves), never tag objects. */
export const PhotoPublicResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  tags: z.array(z.string()).default([]),
});
export type PhotoPublicResponse = z.infer<typeof PhotoPublicResponseSchema>;
```

Рядом с `PhotoListResponseSchema` (~:1183):

```ts
export const PhotoPublicListResponseSchema = paginatedSchema(PhotoPublicResponseSchema);
export type PhotoPublicListResponse = z.infer<typeof PhotoPublicListResponseSchema>;
```

Экспорты: в `endpoints.ts` добавь в существующий import из `'./schemas'` ОБА имени — value `PhotoPublicListResponseSchema` и type `PhotoPublicListResponse` (паттерн соседей: `PhotoListResponseSchema,` + `type PhotoListResponse,` — строки ~:101-102); в `src/index.ts` проверь grep'ом, как экспортируются соседи (`getPhotos`, `PhotoListResponseSchema` — явные строки или `export *`), и добавь оба новых имени по тому же паттерну.

- [ ] **RED (endpoints).** В `endpoints.test.ts` рядом с `describe('getPhotos')` (:338-349), по его образцу (`vi.mocked(api)` — мок уже настроен в файле):

```ts
describe('getPublicPhotos (#493: /api/v1/public/photos)', () => {
  it('calls the public route with pagination params', async () => {
    vi.mocked(api).mockResolvedValueOnce({ items: [], total: 0, page: 1, per_page: 12 });
    await getPublicPhotos({ per_page: 12 });
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/api/v1/public/photos?per_page=12',
      PhotoPublicListResponseSchema,
    );
  });

  it('sends repeatable id params and omits empties', async () => {
    vi.mocked(api).mockResolvedValueOnce({ items: [], total: 0, page: 2, per_page: 20 });
    await getPublicPhotos({ id: ['a', 'b'], page: 2, per_page: 20 });
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/api/v1/public/photos?id=a&id=b&page=2&per_page=20',
      PhotoPublicListResponseSchema,
    );
  });
});
```

(сверь имя мока/импорты с соседним describe — используй те же.)

- [ ] **GREEN (endpoints).** В `endpoints.ts`: сотри устаревший комментарий `// GH #479: getWebPhotos ... use getPhotos({ is_public: true }) for public galleries.` (:365-366; заголовок-разделитель `─── Photos ...` остаётся). После `getPhotos` добавь:

```ts
export interface PhotoPublicListParams {
  page?: number;
  per_page?: number;
  id?: string[];
}

/** #493 / ADR-015: anonymous gallery list — minimal schema,
 * `is_public` is forced server-side and not a parameter. */
export async function getPublicPhotos(params?: PhotoPublicListParams): Promise<PhotoPublicListResponse> {
  const search = new URLSearchParams();
  if (params) {
    if (params.id) params.id.forEach((i) => search.append('id', i));
    if (params.page !== undefined) search.set('page', String(params.page));
    if (params.per_page !== undefined) search.set('per_page', String(params.per_page));
  }
  const qs = search.toString();
  return api(`/api/v1/public/photos${qs ? `?${qs}` : ''}`, PhotoPublicListResponseSchema);
}
```

- [ ] `pnpm --filter @memo/api-client test` → зелёное; type-check: запусти скрипт type-check/build из `packages/api-client/package.json` (имя смотри там — обычно `build`/`typecheck`) → ноль ошибок типов.
- [ ] `git add -A && git commit -m "feat(api-client): getPublicPhotos + PhotoPublicResponseSchema (#493)"`

**DoD:** новые describe зелёные (RED→GREEN); `PhotoResponseSchema` и `getPhotos` не изменены.

---

## Task 4: Web gallery migration — useGallery + mapper + tests
### Classification: standard
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.4 (web-часть)
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — vitest-паттерны
- `frontend/web/app/lib/mappers/__tests__/to-gallery-vm.test.ts` — текущая форма фабрики

### Files
- `frontend/web/app/lib/mappers/to-gallery-vm.ts` — сигнатура + caption
- `frontend/web/app/lib/mappers/__tests__/to-gallery-vm.test.ts` — фабрика + кейсы
- `frontend/web/app/hooks/useGallery.ts` — вызов
- `frontend/web/app/hooks/__tests__/useGallery.test.tsx` — мок + фикстура + ассерты

### Task Description
Галерея переходит на `getPublicPhotos({ per_page: 12 })`; маппер типизирован публичной схемой (теги — строки, caption — склейка строк). Единственный прод-потребитель `getPhotos` в web — `useGallery` (проверено), «Мои фото» имеет собственный маппер — его не трогаем.

### Steps

- [ ] **RED.** `useGallery.test.tsx`: замени мок и фикстуру:

```ts
vi.mock('@memo/api-client', () => ({
  getPublicPhotos: vi.fn(),
}));

import { getPublicPhotos } from '@memo/api-client';

const mockedGetPublicPhotos = getPublicPhotos as Mock;
```

Фикстура контрактных строк (тип — `PhotoPublicResponse` из `@memo/api-client`):

```ts
const contractPhotos: PhotoPublicResponse[] = [
  { id: 'p1', filename: '/images/gallery/p1.jpg', tags: ['масло', 'акварель'] },
  { id: 'p2', filename: 'images/gallery/p2.jpg', tags: [] },
  { id: 'p3', filename: 'https://cdn.example.com/p3.jpg', tags: ['масло'] },
];
```

`beforeEach`: `mockedGetPublicPhotos.mockResolvedValue({ items: contractPhotos, total: contractPhotos.length, page: 1, per_page: 12 });`. Ассерт вызова: `expect(mockedGetPublicPhotos).toHaveBeenCalledWith({ per_page: 12 });`. Ожидания views (`p1` → caption `'масло · акварель'`, `p2` → `''`, `p3` → `'масло'`) не меняются. Остальные кейсы файла (allowlist-drop/empty/error) — на новую фикстуру/мок по тому же принципу.
- [ ] Запусти `pnpm --filter @memo/web test` → падает (мок не вызывается: хук зовёт `getPhotos`).
- [ ] **Хук.** `useGallery.ts`: импорт → `import { getPublicPhotos } from '@memo/api-client';`; queryFn → `() => getPublicPhotos({ per_page: 12 })`; docstring хука перепиши: витрина едет публичным маршрутом `getPublicPhotos` (ADR-015), не `getPhotos({is_public:true})`. Ключ `['photos', 'public']` и stale/gc — без изменений.
- [ ] **Маппер.** `to-gallery-vm.ts` (:23): импорт типа → `import type { PhotoPublicResponse } from '@memo/api-client';` (строку `PhotoResponse` убери, если больше нигде в файле не нужна); сигнатура → `raw: PhotoPublicResponse`; caption → `raw.tags.join(' · ')`; комментарий шапки файла (4-11) дополни: маппер типизирован публичной схемой #493.
- [ ] **Маппер-тест.** `to-gallery-vm.test.ts`: фабрика → 

```ts
import type { PhotoPublicResponse } from '@memo/api-client';

/** Contract row factory — minimal public schema (#493). */
function publicPhoto(overrides: Partial<PhotoPublicResponse> = {}): PhotoPublicResponse {
  return { id: 'p1', filename: '/images/gallery/p1.jpg', tags: [], ...overrides };
}
```

Кейсы: caption из строк-тегов (`tags: ['масло', 'акварель']` → `'масло · акварель'`), пустые теги → `''`, allowlist-url кейсы — на новой фабрике; describe-заголовок → `toGalleryPhotoView (#493: PhotoPublicResponse → gallery view)`.
- [ ] `pnpm --filter @memo/web test` → всё зелёное.
- [ ] `git add -A && git commit -m "feat(web): gallery rides getPublicPhotos on /api/v1/public/photos (#493)"`

**DoD:** витест web зелёный; `getPhotos` в `frontend/web` больше не вызывается прод-кодом (только admin-контексты, их не трогали).

---

## Task 5: Stale comment — records.py wiring ownership
### Classification: trivial
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.6

### Files
- `backend/src/api/v1/records.py` (~:69-72)

### Steps

- [ ] Прочитай комментарий (:69-72). Первые две строки не трогай. Последнюю фразу с `#493 owns that wiring` замени на: `#499 owns that wiring (client accounts branch; Gate B #499, 2026-10-21)`. Никаких других изменений.
- [ ] `cd backend && uv run pytest tests/test_api_records.py -q` → зелёное (комментарий поведения не меняет — контрольный прогон).
- [ ] `git add -A && git commit -m "docs(records): stale wiring comment points to #499 (#493)"`

**DoD:** комментарий ссылается на #499; поведение не изменилось.

---

## Task 6: Domain rules update + full verification
### Classification: small
### Required Docs
- `docs/specs/2026-11-08-photo-public-contract-design.md` §6.7 (полный список правок)
- `docs/domain-rules/photos.md` — текущее состояние (таблица эндпоинтов, Master role)
- `docs/domain-rules/auth.md` — Public Access (:25-34)

### Files
- `docs/domain-rules/photos.md`
- `docs/domain-rules/auth.md`

### Task Description
Доменные правила отражают новый механизм: витрина — отдельный маршрут, bare GET — staff-only; стелющиеся фразы про «галерея едет в общем списке с is_public=true» убраны; добавлена заметка PII-in-filename.

### Steps

- [ ] `photos.md`, таблица API Endpoints: добавь строку `GET /api/v1/public/photos` (anonymous, minimal schema, forced is_public); двум bare GET добавь пометку staff-only (`anon → 401`, `photos:read`).
- [ ] `photos.md` (:40 и :63): сотри/перепиши фразы «the web gallery sends `is_public=true` (#479)» и «the public gallery rides it with `is_public=true`» — витрина теперь отдельный публичный маршрут (ADR-015).
- [ ] `photos.md`, раздел Master role: «Публичная витрина» — новый механизм (мастер на `/public/photos` видит все публичные фото, нескоупленно; `/photos` — скоуп #263); краткое упоминание вариантной публичной схемы (`PhotoPublicResponse` — теги названиями, без владельческих полей).
- [ ] `photos.md`, новая доменная заметка (раздел правил/заметок): публичные фото-файлы не должны нести PII в имени — `filename` это админский свободный текст («Иванов.jpg» утечёт на публичном маршруте даже после чистки id); правило процесса загрузки, без валидации в #493.
- [ ] `auth.md`, Public Access (:28, словарная строка): убери `photos` из перечисления анонимных словарей; фото-витрина — `GET /api/v1/public/photos` (ADR-015; строка-ссылка на ADR уже есть строкой выше — не дублируй). Строку про `#479 removal` рядом с фото-упоминанием приведи в соответствие (бare GET закрыты #493).
- [ ] **Полный прогон (форма — как в CI, `.github/workflows/test.yml`):** backend — `cd backend && uv run pytest -q` + `uv run python scripts/lint_budget.py` (mypy, если настроен в workflow) → зелёное; api-client — vitest + type-check/build-скрипт из package.json → зелёное; web — vitest + type-check (по workflow) → зелёное. Команды бери из workflow-файла, не изобретай свои.
- [ ] `git add -A && git commit -m "docs(domain-rules): photos public showcase route, staff-only bare GETs (#493)"`

**DoD:** все суиты зелёные; grep по `docs/domain-rules/` не находит «rides it with `is_public`» / «gallery sends `is_public`»; обе таблицы эндпоинтов содержат `/api/v1/public/photos`.
