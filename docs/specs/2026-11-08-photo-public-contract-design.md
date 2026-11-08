# Спека: #493 — чистка служебных полей из публичного фото-контракта

Дата: 2026-11-08 · Статус: черновик для Gate B (rev 3: маршрут → `/api/v1/public/photos` по ADR-015 + артефакт ADR + волна-follow-up) · Источник: GH #493 (объём сужен гейтами B #479 20.10 и #499 21.10)

## 1. Проблема (для читателя, не видевшего issue)

Публичные (анонимные) GET-эндпоинты фото отдают анонимному вызывающему полную административную схему `PhotoResponse`, включая служебные/владельческие поля:

- `client_id`, `client_name` — привязка фото к карточке клиента (персональные данные);
- `service_id`, `activity_id`, `location_id` — владельческие слоты (внутренние идентификаторы).

Анонимный сбор этих идентификаторов — исходный пункт 7 security-ревью #479. Остальная часть исходного #493 (цена из тарифа, запрет `client_id`/`visitor_id` анонимам, лимиты, `verify_fetch_metadata`) потеряла предмет: публичное создание записи закрыто в #479 (`POST /records` под `records:write`, аноним → 401), а те же цели в клиентской ветке достигнуты строгой схемой #499. `GET /photos/web` удалён #479 (тест фиксирует 404).

Попутно в коде остался устаревший комментарий (см. §6.6).

## 2. Решение (Gate A — выбран один подход)

**Разделение по маршрутам (route split):** публичная витрина получает собственный маршрут с минимальной публичной схемой; существующие GET-эндпоинты закрываются от анонима штатным read-guard'ом. Админский контракт не меняется вообще.

Публичный маршрут селит в **новый неймспейс `/api/v1/public/*`** — первый житель конвенции аудиторий ADR-015 (решение Gate B от 2026-11-08, артефакт — §6.8): `GET /api/v1/public/photos`, выделенный роутер `public.py`. Плюс задача выводит сам ADR (фиксация конвенции URL) и черновик issue волны-follow-up (§5, §9).

Отброшенные подходы (по правилам фильтра Gate A):

- *Удалить поля из общего `PhotoResponse`* — нарушает факт: админ рендерит `client_name` и `activity_id` из общего списка (`photoColumns.tsx:71,103`), api-client и тесты завязаны на поля. Ломает админку.
- *Один URL, форма ответа зависит от аутентификации* — нарушает зафиксированное в коде решение «форма фото — на аудиторию» (`MyPhotoItem` в `schemas/my.py:191-204`, docstring: «deliberately NOT PhotoResponse») и принцип типизированного api-client как единого источника правды: схема, меняющаяся по auth, честно не типизируется.

Переиспользуется (reuse wins): билдер списка `list_photos_view` (принудительный `is_public=True`), паттерн `_READ_GUARD = [Depends(require_permission("X:read"))]` (services/tags/masters/records), конверт `PaginatedResponse`, прецедент аудит-специфичной схемы `MyPhotoItem`.

## 3. User Scenarios (каждая → проверяющий тест)

E2E-якоря: изменения не имеют браузерного дельта-эффекта (галерея рендерится как сегодня), поэтому сценарии закреплены за API-тестами (pytest TestClient) в `backend/tests/`.

1. **Гость открывает веб-галерею** → `GET /api/v1/public/photos` → 200; только публичные фото; каждый item содержит ровно `id`, `filename`, `tags` — и НЕ содержит `client_id`, `client_name`, `service_id`, `activity_id`, `location_id`. → новый API-тест (класс `TestPhotosPublicRoute`).
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
| `GET /api/v1/public/photos` (аноним) | — маршрута нет (префикс `/public` не используется) | **новый**: 200, `PaginatedResponse[PhotoPublicResponse]` (теги — названия), `is_public=True` принудительно, параметры `page`/`per_page`/`id`, сортировка зафиксирована; первый маршрут неймспейса ADR-015 |
| Веб-галерея (`useGallery`) | `getPhotos({is_public:true, per_page:12})` → `/photos` | `getPublicPhotos({per_page:12})` → `/public/photos` (для гостя визуально ничего не меняется) |
| api-client | только полный `PhotoResponseSchema` | + `PhotoPublicResponseSchema`, `PhotoPublicListResponseSchema`, `getPublicPhotos`; полный контракт не тронут |
| URL-конвенция | аудитории смешаны на bare-путях, конвенция нигде не зафиксирована | **ADR-015** (docs/decisions/015): таблица префиксов `/public/*`, `/my`, `/my/{role}`; первый житель — `/public/photos`; перекрёстные ссылки из auth.md и ARCHITECTURE.md |
| Комментарий `records.py:69-72` | «#493 owns that wiring» (устарел) | ссылка на #499 (см. §6.6) |

## 5. Вне объёма (решено на гейтах #479/#499 — не переоткрывать)

Цена из тарифа; запрет `client_id`/`visitor_id` анонимам; обязательность/формат телефона; `verify_fetch_metadata` на POST /records (виринг → #499); лимиты/анти-спам (→ #499/клиентские учётки); подтверждение владения телефоном (отдельная будущая задача). Изменений админского контракта, CUD-эндпоинтов и хранилища — нет.

**Волна-follow-up по ADR-015 (решение Gate B 2026-11-08 — НЕ реализуется в #493):** миграция остальной публичной поверхности и `/my`-реструктуризация под конвенцию. Состав волны (детали и чек-лист — черновик issue в §9):

- **Словари** (masters/services/locations/activities/tags): убрать bare GET из `PUBLIC_ROUTES`, навесить read-guard, создать минимальные `/public/*`-варианты. Класс проблемы: сегодня аноним на bare-словарях получает ПОЛНЫЕ админские контракты (masters — персональные данные сотрудников) — волна закрывает класс целиком.
- **Миграция веб-формы записи** (frontend/web `useSchedule.ts`: masters/services/locations/activities → новые `/public/*` варианты).
- **`/my`-реструктуризация** (ADR-015, clause 3): универсальный whoami `/my` (комбинированный guard на обе cookie), ветки `/my/client|master|admin`, кабинет клиента под `/my/client/*` (сегодняшние плоские `/my/records`, `/my/photos`, `/my/payments`), общий стафф-профиль в `/my/master` + `/my/admin` (один роутер под двумя префиксами), `/user-settings` → `/my/settings`, депрекация `/auth/me` после миграции админ-SPA.
- Bare-словари остаются публичными ДО волны — осознанное отклонение, зафиксированное в ADR-015 (clause 4: staged migration); #493 двигает только фото.

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

### 6.2 Публичный маршрут (`backend/src/api/v1/public.py` — новый роутер)

- **Новый выделенный роутер `public.py`**, монтируется с префиксом `/api/v1/public` (`main.py`, список монтирований :254-286) — первый житель неймспейса ADR-015; словари волны (§5) подселяются туда же. Выделенный роутер, а не маршрут в `photos.py`: у неймспейса своя аудитория (аноним), свой guard-режим и точка роста.
- `GET /api/v1/public/photos` → `PaginatedResponse[PhotoPublicResponse]`; аноним разрешён (без scope-зависимости).
- Параметры: стандартный кирпич `PaginationParams` — `page`, `per_page`, `id` (Guard 1 #371 / domain rule 8: каждый пагинированный GET публикует `?id=`; пин `EXPECTED_PAGINATED_LISTS` 19 → 20, `test_list_id_uniform_guards.py:52`). `?id=` безопасен: AND-сочетается с принудительным `is_public=True`, обойти фильтр не может. Фильтры владельцев/`q`/`tag_id`/`sort_by`/`is_public` не подключаются; незнакомые параметры игнорируются (FastAPI default — явное решение, в конвенции репо «неизвестный фильтр → молчаливый результат, не 4xx»).
- Сортировка зафиксирована: `created_at desc` + tiebreak `id asc` (дефолт общего списка), не настраивается — порядок галереи не дрейфует.
- Реализация: переиспользование композита списка (`list_photos_view`, `services/photo.py:386-474`) с форсированным `is_public=True`. Уточнение: билдер сегодня жёстко маппит Row → `PhotoResponse` (включая scalar-subquery `client_name`); переиспользование — через параметр целевой схемы/маппинга на общем композите (или route-level `PhotoPublicResponse.model_validate`), точный шов — в плане. Прогон `client_name`-subquery на публичном маршруте безвреден (поле в ответ не попадает), но предпочтительно отключить для публичного вызова.
- Коллизии path-param нет: маршрут живёт в собственном префиксе, `{photo_id}` из `photos.py` его не перекрывает (специальное ограничение порядка объявления из rev 2 снято).

### 6.3 Закрытие старых GET (`backend/src/api/v1/photos.py`)

- На `list_photos` и `get_photo` добавляется `_READ_GUARD = [Depends(require_permission("photos:read"))]` (паттерн `services.py:52`); `get_optional_scope` сохраняется — скоуп #263 для мастера работает как сегодня (guard срабатывает раньше и только отсекает анонима: 401).
- Право `photos:read` в реестре существует и выдано мастеру (`permissions.py:51`), админу — `*` (`permissions.py:45`): регрессии ролей нет.
- **Анонимный allowlist** (`backend/src/auth/public.py:49-50`) — точка принудительного исполнения публичной поверхности (default-deny walk `test_every_api_v1_route_is_guarded_or_allowlisted`, `test_auth_contract.py:139`): записи `("GET", "/api/v1/photos")` и `("GET", "/api/v1/photos/{id}")` удаляются (эндпоинты стали guarded — иначе `test_public_routes_allowlist_has_no_stale_entries`, `:153`), добавляется `("GET", "/api/v1/public/photos")`; docstring модуля (`public.py:12-15`, «галерея едет в общем списке») переписывается под новый механизм + ссылка на ADR-015 (префикс — конвенция, allowlist — принуждение).
- **Scope-контракт:** новый роутер `public.py` не несёт scope-зависимости (как auth-роутер), поэтому исключение `UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS["photos"]` из rev 2 НЕ нужно — маршрут больше не живёт в scope-wired роутере `photos`. Проверяется, что контракт-тест скоупа (`test_master_scope_contract.py`) корректно классифицирует новый роутер (не scope-wired → не требует записей); точный шов — в плане. Явное решение сохраняется: залогиненный мастер на `/public/photos` видит ВСЕ публичные фото (нескоупленно), в отличие от скоупленного `/photos`; утечки приватного нет — маршрут отдаёт только `is_public=true`.

### 6.4 api-client + веб-галерея

- `packages/api-client/src/schemas.ts`: `PhotoPublicResponseSchema` (зеркало §6.1: теги — названия строками) + обёртка-конверт; `PhotoResponseSchema` не меняется.
- `packages/api-client/src/endpoints.ts`: `getPublicPhotos(params)` → `/api/v1/public/photos`; попутно стирается устаревающий комментарий «use `getPhotos({ is_public: true })` for public galleries» (`endpoints.ts:365-366`).
- `frontend/web/app/hooks/useGallery.ts:21`: переход на `getPublicPhotos({ per_page: 12 })`; ключ react-query без изменений.
- Маппер `toGalleryPhotoView` (`frontend/web/app/lib/mappers/to-gallery-vm.ts:23`) сегодня типизирован `raw: PhotoResponse` — входной тип сужается до публичной схемы; тело меняется точечно: теги приходят названиями (строками), склейка caption — по строкам.
- Витстест `useGallery.test.tsx` (мок `getPhotos`, ассерт вызова `:9-15,79-80`) переводится на `getPublicPhotos`.

### 6.5 Тесты (`backend/tests/`)

- Новые: сценарии 1–3 из §3 (минимальный состав полей, игнор владельческих фильтров, 401 на обоих старых GET).
- Миграции (пины старой публичной поверхности):
  - `test_master_scope_photos.py:377` — анонимный кейс витрины (`anon_client.get("/api/v1/photos", params={"is_public": "true"})`) → на `GET /api/v1/public/photos`.
  - `test_auth_guards.py:86-94` — `_PUBLIC_GETS` пинит анонимный `GET /photos` → 200 («public surface intact»); кейс переезжает на `/api/v1/public/photos` (+ docstring `:15`).
  - `test_auth_permissions.py:221-246` — `test_equals_spec_allowlist_exactly` пинит точный состав `PUBLIC_ROUTES`; обновляется под новый набор (−2 старых фото-записи, + `/api/v1/public/photos`).
  - `test_list_id_uniform_guards.py:52` — пин `EXPECTED_PAGINATED_LISTS` 19 → 20.
  - `test_master_scope_contract.py` — проверка классификации нового роутера `public.py` (не scope-wired; исключение НЕ вводится — §6.3).
- Существующие админ/мастер API-тесты (`test_api_photos.py` — CRUD/фильтры/скоуп) — без правок, остаются зелёными (сценарии 4–5).

### 6.6 Устаревший комментарий (`backend/src/api/v1/records.py:69-72`)

Заменить последнюю фразу комментария: «`#493 owns that wiring`» → ссылка на #499 (защита мутаций / CSR-слой переехали в задачу клиентских учёток по решению Gate B #499 от 21.10). Первые две строки комментария остаются (они верны). Текст правки — в плане.

### 6.7 Domain rules (`docs/domain-rules/photos.md`)

Обновить: таблицу API Endpoints (новая строка `GET /api/v1/public/photos`; пометка «staff-only, anon → 401» на двух GET); раздел Master role («Публичная витрина» — новый механизм вместо общего списка с `?is_public=true`); краткое упоминание публичной вариантной схемы; стелющие фразы — строка 40 («the web gallery sends `is_public=true` (#479)») и строка 63 таблицы («the public gallery rides it with `is_public=true`»). Плюс `docs/domain-rules/auth.md` Public Access (строка 27 — тот же механизм; строка-ссылка на ADR-015 в этом разделе уже добавлена DESIGN-фазой, IMPL её не трогает). Новая доменная заметка: публичные фото-файлы не должны нести PII в имени (filename — админский свободный текст; «Иванов.jpg» на публичном маршруте утечёт даже после чистки id) — правило для процесса загрузки, без новой валидации в этом объёме.

### 6.8 Артефакт ADR-015 (`docs/decisions/015-api-url-audience-namespaces.md`)

Новый ADR — второй артефакт задачи (решение Gate B 2026-11-08), пишется DESIGN-фазой вместе со спекой, пушится вместе с ней после Gate B. Содержание (фиксация, не новая проектировка):

- **Таблица префиксов**: `/api/v1/{entity}` — CRM персонала (админка, не двигается — zero admin migration); `/api/v1/public/{entity}` — анонимная витрина; `/api/v1/my` — универсальный whoami для любой сессии (НОВЫЙ комбинированный guard на обе cookie — волна); `/api/v1/my/{role}` (`client`/`master`/`admin` — ровно енум `UserRole`, `backend/src/models/enums.py:6-12`) — ролевая самоповерхность, guard соответствующей сессии (+роль).
- **Двусторонняя оговорка публичности**: при неясной аудитории дефолтный неймспейс — `/public/{entity}`, НО факт анонимности любого маршрута — всегда осознанный шаг через запись в `PUBLIC_ROUTES` (default-deny walk остаётся принуждением; префикс — конвенция, allowlist — enforcement).
- **Поправка `/my`** (clause 3): универсальный `/my` — стандартная схема `{id, role, name, phone}`; кабинет клиента под `/my/client/*` (плоские `/my/records|photos|payments` переезжают под ветку); общий стафф-профиль (GET/PUT + portrait) монтируется под ОБЕ ветки `/my/master` и `/my/admin` — один роутер, один контракт, без форка; богатая полезная нагрузка `/auth/me` (permissions, master-snapshot) — в ролевых ветках (снапшот — только в `/my/master`); `/user-settings` → `/my/settings`; `/auth/me` консолидируется в `/my`, депрекируется в волне, удаляется после миграции админ-SPA.
- **Staged migration** (clause 4): сейчас — только #493 (`/public/photos`, закрытие bare-фото-GET); волна — словари, миграция формы записи, `/my`-реструктуризация, `/user-settings`, `/auth/me`; никогда — переезд CRM `{entity}`-путей.
- **Перекрёстные ссылки** (чтобы ADR находили): индекс `docs/decisions/README.md` (заодно добавлена пропущенная строка ADR-014), `docs/domain-rules/auth.md` (раздел Public Access), `docs/ARCHITECTURE.md` (новый подраздел API URL Conventions в Backend-секции). Все три уже внесены DESIGN-фазой.

## 7. Visual Compliance Checks

- N/A

## 8. Риски и совместимость

- **Разрыв анонимного доступа к старым GET** — единственный анонимный потребитель веб-галереи мигрирует в этом же изменении (перепись вызовов: `useGallery` — единственный в web, прямых fetch мимо api-client нет; single-GET не потребляется никем). Внешних потребителей нет (приложение не в проде).
- **Лимиты на новом анонимном маршруте** — вне объёма (лимиты/анти-спам ушли в #499 по решению гейта); риск принимается явно: маршрут отдаёт только публичные данные с пином `per_page`, остаток OWASP API4:2023 фиксируется здесь как осознанное отклонение до задачи #499.
- **Опечатка в правах** — `photos:read` уже в реестре, сиды не трогаются.
- **Порядок маршрутов** — коллизии нет: `/public/photos` живёт в собственном префиксе, `{photo_id}` из `photos.py` его не перекрывает (ограничение порядка объявления из rev 2 снято).
- **Bare-словари остаются публичными до волны** — осознанное отклонение, зафиксированное в ADR-015 (clause 4: staged migration); #493 закрывает только фото-класс, словари (masters = персональные данные сотрудников) — волна §5.
- **Allowlist как точка исполнения** — публичная поверхность репо объявляется в `PUBLIC_ROUTES` (default-deny walk); все изменения публичной поверхности в этой спеке идут через правку allowlist + его пин-тесты (§6.3, §6.5), а не только через guard'ы.
- Обратимость: изменение чисто добавляет маршрут/схему и guard; откат — обратный коммит без миграций данных.

## 9. Приложение: черновик issue волны-follow-up (создаётся на DONE фазы, не сейчас)

Заголовок: **Волна ADR-015: публичные словари `/public/*`, `/my`-реструктуризация, `/user-settings`, депрекация `/auth/me`**

Тело (шаблон):

> Контекст: ADR-015 (`docs/decisions/015-api-url-audience-namespaces.md`, Gate B #493 2026-11-08) зафиксировал конвенцию URL-аудиторий; #493 внедрил первого жителя (`GET /api/v1/public/photos`). Эта задача — остальная миграция (ADR-015, clause 4).
>
> **1. Словари** (masters/services/locations/activities/tags):
> - [ ] минимальные `/public/{entity}`-варианты (схемы по потребителю веб-формы; masters — без персональных данных сотрудников сверх витрины)
> - [ ] bare GET → read-guard (`masters:read`/…), удаление записей из `PUBLIC_ROUTES` (+ пин-тесты allowlist)
> - [ ] `GET /{entity}/{id}` bare — судьба по потребителям (аналог решения #493 по `/photos/{id}`)
>
> **2. Веб-форма записи** (frontend/web `useSchedule.ts`): masters/services/locations/activities → новые `/public/*` варианты; api-client: `/public/*`-методы.
>
> **3. `/my`-реструктуризация** (ADR-015, clause 3):
> - [ ] комбинированный guard (`memo_session` ИЛИ `memo_client_session`, роль строго из резолва)
> - [ ] `GET /my` — универсальный whoami `{id, role, name, phone}`
> - [ ] кабинет клиента: `GET /my/client` + `GET|POST /my/client/records`, `GET /my/client/photos`, `GET /my/client/payments` (плоские пути → под ветку; обратной совместимости нет — не в проде)
> - [ ] стафф-профиль: один роутер под `/my/master` и `/my/admin` (GET/PUT, portrait); permissions — в обеих ветках, master-snapshot — только в `/my/master`
> - [ ] `/user-settings` → `/my/settings` (own-only семантика без изменений)
> - [ ] `/auth/me` — депрекация, удаление после миграции админ-SPA
>
> Acceptance: default-deny walk зелёный; пин-тесты allowlist/пагинации обновлены; веб (галерея + форма записи) и клиентский кабинет работают на новых путях; ADR-015 clause 4 «волна» закрыта.
