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
| `GET /api/v1/photos/public` (аноним) | — маршрута нет | **новый**: 200, `PaginatedResponse[PhotoPublicResponse]`, `is_public=True` принудительно, параметры только `page`/`per_page` |
| Веб-галерея (`useGallery`) | `getPhotos({is_public:true, per_page:12})` → `/photos` | `getPublicPhotos({per_page:12})` → `/photos/public` (для гостя визуально ничего не меняется) |
| api-client | только полный `PhotoResponseSchema` | + `PhotoPublicResponseSchema`, `PhotoPublicListResponseSchema`, `getPublicPhotos`; полный контракт не тронут |
| Комментарий `records.py:69-72` | «#493 owns that wiring» (устарел) | ссылка на #499 (см. §6.6) |

## 5. Вне объёма (решено на гейтах #479/#499 — не переоткрывать)

Цена из тарифа; запрет `client_id`/`visitor_id` анонимам; обязательность/формат телефона; `verify_fetch_metadata` на POST /records (виринг → #499); лимиты/анти-спам (→ #499/клиентские учётки); подтверждение владения телефоном (отдельная будущая задача). Изменений админского контракта, CUD-эндпоинтов и хранилища — нет.

## 6. Требования

### 6.1 Публичная схема (`backend/src/schemas/photo.py`)

```python
class PhotoPublicResponse(BaseModel):
    id: str
    filename: str
    tags: list[PhotoTagResponse] = []
```

Минимум, который потребляет галерея (`to-gallery-vm` читает только `id`/`filename`/`tags`). `is_public` не включается (на маршруте константа true), `created_at`/`updated_at`/владельческие поля — не включаются. Docstring по образцу `MyPhotoItem`: почему схема отделена от `PhotoResponse`.

### 6.2 Публичный маршрут (`backend/src/api/v1/photos.py`)

- `GET /api/v1/photos/public` → `PaginatedResponse[PhotoPublicResponse]`; аноним разрешён (без scope-зависимости).
- Параметры: только `page`, `per_page` (та же валидация, что у общего списка). Фильтры владельцев/`q`/`tag_id`/`sort_by` не подключаются; `is_public=True` принудительно в билдере.
- Реализация через переиспользование `list_photos_view` с форсированным фильтром и маппингом Row → `PhotoPublicResponse`.
- **Ограничение порядка объявления:** маршрут объявляется в роутере ДО `GET /photos/{photo_id}` (иначе path-param проглатывает `public`).

### 6.3 Закрытие старых GET (`backend/src/api/v1/photos.py`)

- На `list_photos` и `get_photo` добавляется `_READ_GUARD = [Depends(require_permission("photos:read"))]` (паттерн `services.py:52`); `get_optional_scope` сохраняется — скоуп #263 для мастера работает как сегодня (guard срабатывает раньше и только отсекает анонима: 401).
- Право `photos:read` в реестре существует и выдано мастеру (`permissions.py:51`), админу — `*` (`permissions.py:45`): регрессии ролей нет.

### 6.4 api-client + веб-галерея

- `packages/api-client/src/schemas.ts`: `PhotoPublicResponseSchema` (зеркало §6.1) + обёртка-конверт; `PhotoResponseSchema` не меняется.
- `packages/api-client/src/endpoints.ts`: `getPublicPhotos(params)` → `/api/v1/photos/public`.
- `frontend/web/app/hooks/useGallery.ts:21`: переход на `getPublicPhotos({ per_page: 12 })`; ключ react-query и маппер `to-gallery-vm` без изменений.

### 6.5 Тесты (`backend/tests/`)

- Новые: сценарии 1–3 из §3 (минимальный состав полей, игнор владельческих фильтров, 401 на обоих старых GET).
- Миграция: анонимный кейс витрины в `test_master_scope_photos.py:377` (`anon_client.get("/api/v1/photos", params={"is_public": "true"})`) переводится на `GET /photos/public`.
- Существующие админ/мастер-тесты — без правок, остаются зелёными (сценарии 4–5).

### 6.6 Устаревший комментарий (`backend/src/api/v1/records.py:69-72`)

Заменить последнюю фразу комментария: «`#493 owns that wiring`» → ссылка на #499 (защита мутаций / CSR-слой переехали в задачу клиентских учёток по решению Gate B #499 от 21.10). Первые две строки комментария остаются (они верны). Текст правки — в плане.

### 6.7 Domain rules (`docs/domain-rules/photos.md`)

Обновить: таблицу API Endpoints (новая строка `GET /photos/public`; пометка «staff-only, anon → 401» на двух GET); раздел Master role («Публичная витрина» — новый механизм вместо общего списка с `?is_public=true`); краткое упоминание публичной вариантной схемы.

## 7. Visual Compliance Checks

- N/A

## 8. Риски и совместимость

- **Разрыв анонимного доступа к старым GET** — единственный анонимный потребитель веб-галереи мигрирует в этом же изменении (перепись вызовов: `useGallery` — единственный в web, прямых fetch мимо api-client нет; single-GET не потребляется никем). Внешних потребителей нет (приложение не в проде).
- **Опечатка в правах** — `photos:read` уже в реестре, сиды не трогаются.
- **Порядок маршрутов** — явное ограничение §6.2 снимает коллизию `{photo_id}` vs `public`.
- Обратимость: изменение чисто добавляет маршрут/схему и guard; откат — обратный коммит без миграций данных.
