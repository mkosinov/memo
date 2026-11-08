# Спека: #493 — чистка служебных полей из публичного фото-контракта

Дата: 2026-11-08 · Статус: черновик для Gate B · Источник: GH #493 (объём сужен гейтами B #479 20.10 и #499 21.10)

## 1. Проблема (для читателя, не видевшего issue)

Публичные (анонимные) GET-эндпоинты фото отдают анонимному вызывающему полную административную схему `PhotoResponse`, включая служебные/владельческие поля:

- `client_id`, `client_name` — привязка фото к карточке клиента (персональные данные);
- `service_id`, `activity_id`, `location_id` — владельческие слоты (внутренние идентификаторы).

Анонимный сбор этих идентификаторов — исходный пункт 7 security-ревью #479. Остальная часть исходного #493 (цена из тарифа, запрет `client_id`/`visitor_id` анонимам, лимиты, `verify_fetch_metadata`) потеряла предмет: публичное создание записи закрыто в #479 (`POST /records` под `records:write`, аноним → 401), а те же цели в клиентской ветке достигнуты строгой схемой #499. `GET /photos/web` удалён #479 (тест фиксирует 404).

Попутно в коде остался устаревший комментарий (см. §6.6).

## 2. Решение (Gate A — выбран один подход)

**Разделение по маршрутам (route split):** публичная витрина получает собственный маршрут с минимальной публичной схемой; существующие GET-эндпоинты закрываются от анонима штатным read-guard'ом. Админский контракт не меняется вообще.

Отброшенные подходы (по правилам фильтра Gate A):

- *Удалить поля из общего `PhotoResponse`* — нарушает факт: админ рендерит `client_name` и `activity_id` из общего списка (`photoColumns.tsx:71,103`), api-client и тесты завязаны на поля. Ломает админку.
- *Один URL, форма ответа зависит от аутентификации* — нарушает зафиксированное в коде решение «форма фото — на аудиторию» (`MyPhotoItem` в `schemas/my.py:191-204`, docstring: «deliberately NOT PhotoResponse») и принцип типизированного api-client как единого источника правды: схема, меняющаяся по auth, честно не типизируется.

Переиспользуется (reuse wins): билдер списка `list_photos_view` (принудительный `is_public=True`), паттерн `_READ_GUARD = [Depends(require_permission("X:read"))]` (services/tags/masters/records), конверт `PaginatedResponse`, прецедент аудит-специфичной схемы `MyPhotoItem`.

## 3. User Scenarios (каждая → проверяющий тест)

E2E-якоря: изменения не имеют браузерного дельта-эффекта (галерея рендерится как сегодня), поэтому сценарии закреплены за API-тестами (pytest TestClient) в `backend/tests/`.

1. **Гость открывает веб-галерею** → `GET /api/v1/photos/public` → 200; только публичные фото; каждый item содержит ровно `id`, `filename`, `tags` — и НЕ содержит `client_id`, `client_name`, `service_id`, `activity_id`, `location_id`. → новый API-тест (класс `TestPhotosPublicRoute`).
2. **Гость пытается передать владельческий фильтр в публичный маршрут** (`?client_id=...`) → параметр не влияет на выдачу (фильтры владельцев на публичном маршруте не подключены). → новый API-тест.
3. **Аноним обращается к старым эндпоинтам** → `GET /api/v1/photos` → 401; `GET /api/v1/photos/{id}` → 401. → новые API-тесты.
4. **Администратор открывает таблицу фото** → `GET /api/v1/photos` → 200, полный контракт без изменений (`client_name`, `activity_id`, фильтры, сортировка). → существующие тесты `test_api_photos.py` остаются зелёными.
5. **Мастер открывает список фото** → видит только свои строки (скоуп #263 не сужается): `photos:read` у мастера есть (`permissions.py:51`), guard не добавляет сужения. → существующие тесты `test_master_scope_photos.py` остаются зелёными (кроме миграции анонимного кейса, §6.5).

## 4. Behavioral Delta (before → after)

| Поверхность | Было | Стало |
|---|---|---|
| `GET /api/v1/photos` (аноним) | 200, полный `PhotoResponse` со служебными полями | **401** (`AUTH_UNAUTHORIZED`) |
| `GET /api/v1/photos/{id}` (аноним) | 200, полный `PhotoResponse` | **401** |
| `GET /api/v1/photos` / `GET /photos/{id}` (staff) | полный `PhotoResponse`; мастер — скоуп #263 | без изменений (добавлен только guard `photos:read`) |
| `GET /api/v1/photos/public` (аноним) | — маршрута нет | **новый**: 200, `PaginatedResponse[PhotoPublicResponse]` (теги — названия), `is_public=True` принудительно, параметры `page`/`per_page`/`id`, сортировка зафиксирована |
| Веб-галерея (`useGallery`) | `getPhotos({is_public:true, per_page:12})` → `/photos` | `getPublicPhotos({per_page:12})` → `/photos/public` (для гостя визуально ничего не меняется) |
| api-client | только полный `PhotoResponseSchema` | + `PhotoPublicResponseSchema`, `PhotoPublicListResponseSchema`, `getPublicPhotos`; полный контракт не тронут |
| Комментарий `records.py:69-72` | «#493 owns that wiring» (устарел) | ссылка на #499 (см. §6.6) |

## 5. Вне объёма (решено на гейтах #479/#499 — не переоткрывать)

Цена из тарифа; запрет `client_id`/`visitor_id` анонимам; обязательность/формат телефона; `verify_fetch_metadata` на POST /records (виринг → #499); лимиты/анти-спам (→ #499/клиентские учётки); подтверждение владения телефоном (отдельная будущая задача). Изменений админского контракта, CUD-эндпоинтов и хранилища — нет.

## 6. Требования

### 6.1 Публичная схема (`backend/src/schemas/photo.py`)

```python
class PhotoPublicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    tags: list[str] = []  # названия тегов, резолвятся на сервере
```

Минимум, который потребляет галерея (`to-gallery-vm` читает только `id`/`filename`/`tags` → caption из названий). Форма тегов — по конвенции публичных поверхностей (`MyPhotoItem`, `schemas/my.py:197-199`; api-client `:1011-1012`): названия строками; объекты тегов с id остаются в админском контракте — публичные id тегов не отдаются. `is_public` не включается (на маршруте константа true), `created_at`/`updated_at`/владельческие поля — не включаются. `from_attributes=True` — для `model_validate` из ORM/Row. Docstring по образцу `MyPhotoItem`: почему схема отделена от `PhotoResponse`.

### 6.2 Публичный маршрут (`backend/src/api/v1/photos.py`)

- `GET /api/v1/photos/public` → `PaginatedResponse[PhotoPublicResponse]`; аноним разрешён (без scope-зависимости).
- Параметры: стандартный кирпич `PaginationParams` — `page`, `per_page`, `id` (Guard 1 #371 / domain rule 8: каждый пагинированный GET публикует `?id=`; пин `EXPECTED_PAGINATED_LISTS` 19 → 20, `test_list_id_uniform_guards.py:52`). `?id=` безопасен: AND-сочетается с принудительным `is_public=True`, обойти фильтр не может. Фильтры владельцев/`q`/`tag_id`/`sort_by`/`is_public` не подключаются; незнакомые параметры игнорируются (FastAPI default — явное решение, в конвенции репо «неизвестный фильтр → молчаливый результат, не 4xx»).
- Сортировка зафиксирована: `created_at desc` + tiebreak `id asc` (дефолт общего списка), не настраивается — порядок галереи не дрейфует.
- Реализация: переиспользование композита списка (`list_photos_view`, `services/photo.py:386-474`) с форсированным `is_public=True`. Уточнение: билдер сегодня жёстко маппит Row → `PhotoResponse` (включая scalar-subquery `client_name`); переиспользование — через параметр целевой схемы/маппинга на общем композите (или route-level `PhotoPublicResponse.model_validate`), точный шов — в плане. Прогон `client_name`-subquery на публичном маршруте безвреден (поле в ответ не попадает), но предпочтительно отключить для публичного вызова.
- **Ограничение порядка объявления:** маршрут объявляется в роутере ДО `GET /photos/{photo_id}` (иначе path-param проглатывает `public`).

### 6.3 Закрытие старых GET (`backend/src/api/v1/photos.py`)

- На `list_photos` и `get_photo` добавляется `_READ_GUARD = [Depends(require_permission("photos:read"))]` (паттерн `services.py:52`); `get_optional_scope` сохраняется — скоуп #263 для мастера работает как сегодня (guard срабатывает раньше и только отсекает анонима: 401).
- Право `photos:read` в реестре существует и выдано мастеру (`permissions.py:51`), админу — `*` (`permissions.py:45`): регрессии ролей нет.
- **Анонимный allowlist** (`backend/src/auth/public.py:49-50`) — точка принудительного исполнения публичной поверхности (default-deny walk `test_every_api_v1_route_is_guarded_or_allowlisted`, `test_auth_contract.py:139`): записи `("GET", "/api/v1/photos")` и `("GET", "/api/v1/photos/{id}")` удаляются (эндпоинты стали guarded — иначе `test_public_routes_allowlist_has_no_stale_entries`, `:153`), добавляется `("GET", "/api/v1/photos/public")`; docstring модуля (`public.py:12-15`, «галерея едет в общем списке») переписывается под новый механизм.
- **Scope-контракт роутера:** `photos` — scope-wired роутер; для нового маршрута без scope-зависимости добавляется явная запись в `UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS["photos"]` (`test_master_scope_contract.py:218-263,388`) с обоснованием «публичный маршрут по дизайну, данные только публичные». Явное решение: залогиненный мастер на `/photos/public` видит ВСЕ публичные фото (нескоупленно), в отличие от сегодняшнего скоупленного пути; утечки приватного нет — маршрут отдаёт только `is_public=true`.

### 6.4 api-client + веб-галерея

- `packages/api-client/src/schemas.ts`: `PhotoPublicResponseSchema` (зеркало §6.1: теги — названия строками) + обёртка-конверт; `PhotoResponseSchema` не меняется.
- `packages/api-client/src/endpoints.ts`: `getPublicPhotos(params)` → `/api/v1/photos/public`; попутно стирается устаревающий комментарий «use `getPhotos({ is_public: true })` for public galleries» (`endpoints.ts:365-366`).
- `frontend/web/app/hooks/useGallery.ts:21`: переход на `getPublicPhotos({ per_page: 12 })`; ключ react-query без изменений.
- Маппер `toGalleryPhotoView` (`frontend/web/app/lib/mappers/to-gallery-vm.ts:23`) сегодня типизирован `raw: PhotoResponse` — входной тип сужается до публичной схемы; тело меняется точечно: теги приходят названиями (строками), склейка caption — по строкам.
- Витстест `useGallery.test.tsx` (мок `getPhotos`, ассерт вызова `:9-15,79-80`) переводится на `getPublicPhotos`.

### 6.5 Тесты (`backend/tests/`)

- Новые: сценарии 1–3 из §3 (минимальный состав полей, игнор владельческих фильтров, 401 на обоих старых GET).
- Миграции (пины старой публичной поверхности):
  - `test_master_scope_photos.py:377` — анонимный кейс витрины (`anon_client.get("/api/v1/photos", params={"is_public": "true"})`) → на `GET /photos/public`.
  - `test_auth_guards.py:86-94` — `_PUBLIC_GETS` пинит анонимный `GET /photos` → 200 («public surface intact»); кейс переезжает на `/photos/public` (+ docstring `:15`).
  - `test_auth_permissions.py:221-246` — `test_equals_spec_allowlist_exactly` пинит точный состав `PUBLIC_ROUTES`; обновляется под новый набор (−2 старых фото-записи, + `/photos/public`).
  - `test_list_id_uniform_guards.py:52` — пин `EXPECTED_PAGINATED_LISTS` 19 → 20.
  - `test_master_scope_contract.py` — запись unscoped-исключения (§6.3).
- Существующие админ/мастер API-тесты (`test_api_photos.py` — CRUD/фильтры/скоуп) — без правок, остаются зелёными (сценарии 4–5).

### 6.6 Устаревший комментарий (`backend/src/api/v1/records.py:69-72`)

Заменить последнюю фразу комментария: «`#493 owns that wiring`» → ссылка на #499 (защита мутаций / CSR-слой переехали в задачу клиентских учёток по решению Gate B #499 от 21.10). Первые две строки комментария остаются (они верны). Текст правки — в плане.

### 6.7 Domain rules (`docs/domain-rules/photos.md`)

Обновить: таблицу API Endpoints (новая строка `GET /photos/public`; пометка «staff-only, anon → 401» на двух GET); раздел Master role («Публичная витрина» — новый механизм вместо общего списка с `?is_public=true`); краткое упоминание публичной вариантной схемы; стелющие фразы — строка 40 («the web gallery sends `is_public=true` (#479)») и строка 63 таблицы («the public gallery rides it with `is_public=true`»). Плюс `docs/domain-rules/auth.md:27` (раздел Public Access — тот же механизм). Новая доменная заметка: публичные фото-файлы не должны нести PII в имени (filename — админский свободный текст; «Иванов.jpg» на публичном маршруте утечёт даже после чистки id) — правило для процесса загрузки, без новой валидации в этом объёме.

## 7. Visual Compliance Checks

- N/A

## 8. Риски и совместимость

- **Разрыв анонимного доступа к старым GET** — единственный анонимный потребитель веб-галереи мигрирует в этом же изменении (перепись вызовов: `useGallery` — единственный в web, прямых fetch мимо api-client нет; single-GET не потребляется никем). Внешних потребителей нет (приложение не в проде).
- **Лимиты на новом анонимном маршруте** — вне объёма (лимиты/анти-спам ушли в #499 по решению гейта); риск принимается явно: маршрут отдаёт только публичные данные с пином `per_page`, остаток OWASP API4:2023 фиксируется здесь как осознанное отклонение до задачи #499.
- **Опечатка в правах** — `photos:read` уже в реестре, сиды не трогаются.
- **Порядок маршрутов** — явное ограничение §6.2 снимает коллизию `{photo_id}` vs `public`.
- **Allowlist как точка исполнения** — публичная поверхность репо объявляется в `PUBLIC_ROUTES` (default-deny walk); все изменения публичной поверхности в этой спеке идут через правку allowlist + его пин-тесты (§6.3, §6.5), а не только через guard'ы.
- Обратимость: изменение чисто добавляет маршрут/схему и guard; откат — обратный коммит без миграций данных.
