# План #551: вместимость 0–99 (занятия — 0 = «запись закрыта», локации — 0 = «не задана»)

## Goal

Серверная и клиентская границы вместимости: занятия 0–99 (0 — легальное «закрытое» занятие), локации 0–99 (0 = «вместимость не задана»). Валидация только на схемах записи (create/update/patch → 422); чтение легаси-значений не ограничено; CHECK в БД и миграции нет; гвард записи не меняется (0 → мгновенный 409).

## Architecture

- **Границы — только на write-схемы**: `ActivityCreate`/`ActivityUpdate`/`ActivityPatch` и `LocationCreate`/`LocationUpdate`/location-patch переопределяют `capacity` с `Field(ge=0, le=99)`; `ActivityBase`/`LocationBase` не трогаются — `ActivityResponse`/`LocationResponse` наследуют Base, и `response_model` ре-валидирует ответы (граница на Base = 500 на каждом чтении легаси-строки).
- **Фронт**: гейты формы (пустое никогда не отправляет 0; явный 0–99 проходит), автозаполнение из локации только при вместимости ≥ 1 (иначе пустое — блок до явного ввода; канон #595 «missing OR 0 counts as no default» в обоих режимах), Zod write-схемы зеркалят сервер, read-схемы без границ.
- Спека: `docs/specs/2026-11-13-capacity-range-551-design.md` (рев.4) — поведенческая дельта и решения живут там, не здесь.

## Tech Stack

FastAPI + Pydantic v2 (backend, pytest), Next.js admin (frontend/admin, vitest + Playwright), web (frontend/web, Playwright), packages/api-client (Zod, vitest).

## Tasks

### Task 1: Бэкенд — границы вместимости на write-схемах + контрактные матрицы

### Classification: small

### Required Docs

- docs/domain-rules/activities.md (раздел Business Logic → Capacity range validation)
- docs/domain-rules/locations.md (раздел Fields, Invariants)

Работа:

1. `backend/src/schemas/activity.py`: в `ActivityCreate` и `ActivityUpdate` переопределить `capacity: int = Field(ge=0, le=99)`; в `ActivityPatch` заменить `capacity: int | None = None` на `Field(default=None, ge=0, le=99)`. `ActivityBase` не трогать (наследуется `ActivityResponse` — `schemas/activity.py:71`).
2. `backend/src/schemas/location.py`: то же для `LocationCreate`/`LocationUpdate` (ge=0, le=99) и location-patch (optional-форма). `LocationBase` не трогать (`LocationResponse` — `schemas/location.py:124`).
3. `backend/tests/test_api_activities.py`: POST — capacity 0 → 201, 99 → 201, −1 → 422, 100 → 422; PUT — та же матрица; PATCH — без capacity проходит, с 0 → 200, с −1 → 422, с 100 → 422. Шаблон ассерта: `test_api_payments.py:180`.
4. `backend/tests/test_api_locations.py`: POST — 0 → 201 («не задана»), 1 → 201, 99 → 201, 100 → 422, −1 → 422; PUT — та же матрица (0 → 200, 100 → 422); PATCH — аналогично.

DoD: все контрактные матрицы зелёные (pytest) — это контрактный слой сценариев US-4 и US-5; их e2e-отражение — только US-5 (Task 7, RED-GREEN-REFACTOR); US-4 e2e не имеет по спеке (pytest + vitest достаточно).

### Task 2: Бэкенд — явный тест гварда на закрытом занятии (capacity 0 → 409)

### Classification: trivial

### Required Docs

- docs/domain-rules/activities.md (раздел Business Logic → гвард, «0 = запись закрыта»)

Работа:

1. `backend/tests/conftest.py`: фикстура занятия с `capacity=0` рядом с `sample_activity_at_capacity` (`conftest.py:948`, там capacity=1/заполнено — новому тесту нужна своя фикстура).
2. `backend/tests/test_record_visits.py`: тест — попытка записи на занятие с capacity 0 → 409 с `detail["code"] == "ACTIVITY_AT_CAPACITY"` (гвард `check_activity_capacity`, `backend/src/domain/record_visits.py:97`, код гварда не меняется).

DoD: тест зелёный (pytest); фиксирует семантику «0 = запись закрыта» из US-1 (её E2E — Task 7) (RED-GREEN-REFACTOR).

### Task 3: Фронт — форма создания: границы, гейт canSave, автозаполнение «нет вместимости → пустое»

### Classification: small

### Required Docs

- docs/domain-rules/activities.md (разделы Frontend: create-form gates, Auto-fill, multi-location #595)
- docs/design-system.md (поля ввода, сообщения об ошибках)

Работа:

1. `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityForm.tsx:219-229`: input вместимости `min={1}` → `min={0}`, добавить `max={99}`; `data-testid` сохранить (`create-capacity` в создании, `input-capacity` в правке).
2. `CreateActivityTab.tsx:125-131` (`canSave`): одиночная ветка → `capacity !== '' && Number(capacity) >= 0 && Number(capacity) <= 99` (состояние поля `number | ''`; пустое блокирует «Создать»). Мульти-ветка `firstWithoutDefault` не меняется.
3. `CreateActivityTab.tsx:171-178` (`applyLocationSet`): автозаполнение одиночного режима — копировать `defaultCapacity` в поле только при `>= 1`, иначе `''` (канон #595 «missing OR 0 counts as no default» в одиночном режиме; комментарий в коде «нет умолчания → 0 → блокировка до ручного ввода» актуализировать).
4. Vitest (`CreateActivityTab.test.tsx`): 0 активирует «Создать» (одиночный режим); пустое блокирует; 100 и −1 оставляют неактивной; локация с `defaultCapacity` 0 или отсутствующим в одиночном режиме — поле пустое, «Создать» заблокирован; существующие мультисценарии #595 остаются зелёными.

DoD: vitest кейсы зелёные; данные сценариев US-1 (создание с 0), US-3 (пустое), US-4 (границы формы), US-6 (автозаполнение) покрыты на слое формы; их e2e — в Task 7 только для US-1, US-3, US-6 (у US-4 e2e нет по спеке — pytest + vitest) (RED-GREEN-REFACTOR).

### Task 4: Фронт — правка занятия: мгновенный патч на 0–99, пустое ≠ 0

### Classification: small

### Required Docs

- docs/domain-rules/activities.md (инвариант «пустое никогда не отправляет 0», #551 rev.4)

Работа:

1. `SettingsTab.tsx:83-93` (`handleCapacityChange`): хранить сырую строку поля рядом с числовым состоянием (или не перезаписывать числовое состояние на пустой строке) — контракт: пустое поле остаётся пустым на экране, 0 в состояние не пишется. Патч `onUpdate({ capacity })` уходит только при явном значении 0–99; пустое и вне диапазона — патч не уходит (молчание — осознанный паттерн мгновенного патча).
2. Vitest: явный «0» отправляет патч; очистка поля не отправляет патч и не пишет 0 в состояние; «100» и «−1» не отправляют.

DoD: vitest кейсы зелёные; US-2 (правка 0 → 12) и US-3 (пустое при правке) покрыты на слое формы — их E2E — Task 7 (RED-GREEN-REFACTOR).

### Task 5: Фронт — форма локации min 0 / max 99 + Zod write-схемы api-client

### Classification: small

### Required Docs

- docs/domain-rules/locations.md (Fields, EntityModal, Parity Notes)

Работа:

1. `frontend/admin/app/(main)/locations/components/locationFields.tsx:55`: `min: 1, max: 500` → `min: 0, max: 99` (сообщения «Минимум: 0» / «Максимум: 99» подставляются автоматически из `LocationModal.tsx:215-219`).
2. `packages/api-client/src/schemas.ts`: ТОЛЬКО две write-схемы — `LocationCreateSchema.capacity` (`:749`) `.min(1).max(500)` → `.min(0).max(99)` (`LocationUpdateSchema` наследует через `.strict()`, `:766` — автоматически) и `ActivityCreateSchema.capacity` (`:384`) → `.min(0).max(99)` (`ActivityPatchSchema` наследует через `.partial()`, `:396` — автоматически). Строки 221/411/436 — response/public-схемы (`LocationResponseSchema`, `ActivityResponseSchema`, `ActivityPublicResponseSchema`) — НЕ трогать (легаси-чтение без границ).
3. Vitest `schemas.test.ts`: локация — 0 ок, 99 ок, 100 ошибка; занятия — 0 ок, 99 ок, −1 и 100 ошибка; response-схема парсит легаси-значение 150.

DoD: vitest кейсы зелёные; US-5 (границы локации) покрыт на слоях формы и клиента — его E2E — Task 7 (RED-GREEN-REFACTOR).

### Task 6: Фронт — карточка занятия «Запись закрыта · N» при capacity 0

### Classification: trivial

### Required Docs

- docs/domain-rules/activities.md (0 = «запись закрыта», карточка)
- docs/design-system.md (текстовые метки карточки)

Работа:

1. `frontend/admin/app/components/schedule/ActivityCard.tsx` (заполнение `:35`, счётчики `:220,249`): при `capacity === 0` показывать «Запись закрыта · N» (N = `occupied`), процент и долю не считать. Существующие базлайны визуальной регрессии не меняются (фикстуры с capacity 8 — состояние 0 в базлайнах не рендерится).
2. Vitest: capacity 0 → текст «Запись закрыта · N» без процента; capacity > 0 — как раньше.

DoD: vitest зелёный; отображение US-1 готово — его E2E — Task 7 (RED-GREEN-REFACTOR).

### Task 7: E2E — admin + web по сценариям US-1–US-3, US-5–US-7

### Classification: standard

### Required Docs

- docs/specs/2026-11-13-capacity-range-551-design.md (разделы User Scenarios, Тесты)
- docs/domain-rules/activities.md, locations.md

Работа:

1. Admin e2e (новый spec, фикстуры по образцу `frontend/admin/e2e/`):
   - US-1: создание занятия с вместимостью 0 → карточка «Запись закрыта · 0» на сетке;
   - US-2: правка 0 → 12 → карточка «0/12»;
   - US-3: пустое поле блокирует «Создать»;
   - US-5: модалка локации — 0 и 99 сохраняются, 100 показывает «Максимум: 99»;
   - US-6: `multi-location-create.spec.ts` остаётся зелёным без правок (прогон в DoD);
   - US-7 (рев.4): штамп на клетку локации с вместимостью 0 → занятие создано, карточка «Запись закрыта · 0», тост содержит «запись закрыта» и «не задана вместимость».
2. Web e2e (по образцу `frontend/web/e2e/fixtures/admin-activity.ts`, capacity 8 → 0): US-1 — попытка записи клиента на закрытое занятие отклоняется («мест нет»).

DoD: E2E-тесты сценариев 1–3, 5–7 проходят (RED-GREEN-REFACTOR; US-4 e2e не имеет по спеке — pytest + vitest); полный прогон admin + web зелёный.

### Task 8: Фронт — штамп сетки: громкий тост при копировании нуля (US-7, рев.4)

### Classification: trivial

### Required Docs

- docs/domain-rules/activities.md (0 = «запись закрыта»; правило путей создания)
- docs/design-system.md (тексты тостов)

Работа:

1. `frontend/admin/app/components/schedule/WeekView.tsx:87` и `DayView.tsx:137`: копию `capacity: location?.defaultCapacity ?? 0` сохранить как есть (вариант C — значение легально копируется); тост успеха в обоих обработчиках после создания: при вместимости созданного занятия 0 → «Создано: … — запись закрыта (у зала «X» не задана вместимость)» (X — title локации); при ≥ 1 — прежний текст.
2. Vitest (тесты обработчиков штампа): локация с `defaultCapacity` 0 → занятие создаётся, тост содержит «запись закрыта» и «не задана вместимость»; локация с вместимостью ≥ 1 → прежний тост.

DoD: vitest зелёный; US-7 покрыт на слое обработчиков — его E2E — Task 7 (RED-GREEN-REFACTOR).

## Перед выкатом (информационно, не блокер)

Одноразовый подсчёт живой прод-базы на значения вне диапазонов (занятия < 0 / > 99; локации < 0 / > 99) — границы стоят только на запись, легаси ничему не мешает; подсчёт даёт заранее знать легаси-хвост. Спека §Бэкенд, решение 4.
