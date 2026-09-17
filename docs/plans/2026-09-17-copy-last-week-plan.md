# План: «Копировать прошлую неделю» (расписание) — #242

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка «Копировать прошлую неделю» в тулбаре расписания реально копирует занятия прошлой недели в просматриваемую через один атомарный бэкенд-вызов, с пикером локаций, честными тостами и merge-защитой от дублей.

**Architecture:** Выделенный эндпоинт `POST /api/v1/activities/copy-week` — один сервисный метод под `@transactional` (фильтры → ремап → дедуп → прямые ORM-вставки + `activity_tags`), ответ с разбивкой пропусков. Фронт: попап-пикер локаций рядом с кнопкой Toolbar, plain-мутация в `ScheduleDataContext`, инвалидация семейства `['activities']`.

**Tech Stack:** FastAPI + SQLAlchemy (async), Pydantic v2; React + TanStack Query + vitest; pytest; Playwright.

**Спека:** `docs/specs/2026-09-17-copy-last-week-design.md` (rev2). **Доменные правила:** `docs/domain-rules/activities.md` (секция Week copy).

---

## Behavioral Delta

Как ведёт себя фича для юзера, по критериям спеки:

- **Кнопка реально копирует неделю (S1)** → клик открывает попап со списком локаций прошлой недели (число занятий у каждой, все включены); «Скопировать» переносит все занятия прошлой недели в просматриваемую на те же дни/время; мастер/услуга/локация/длительность/ёмкость/комментарий/теги — как в оригинале; тост «Скопировано N занятий»; попап закрывается.
- **Повторное нажатие без дублей (S2)** → второй клик копирует ноль: «Всё уже есть».
- **Merge в частично занятую неделю (S3)** → копируются только недостающие занятия; счётчики в попапе заранее уменьшены на уже существующие.
- **Индивидуальные не копируются (S4)** → занятия с `is_private=true` не переносятся; попап заранее показывает «K индивидуальных занятий не копируются».
- **Архивная локация пропускается (S5)** → её занятия не переносятся, сама локация в попапе не видна.
- **Ремап архивного мастера (S6)** → занятие архивного мастера переносится под первого активного мастера с пересекающейся speciality (порядок как в борде мастеров); без замены — пропуск, о котором честно говорит тост после копии.
- **Выбор локаций (S7)** → снятая галка — занятия этой локации не переносятся; на сервер уходит ровно отмеченный список.
- **Пустая прошлая неделя (S8)** → пустое состояние попапа, копирование недоступно.
- **Честный объём** → за один заход копируется до 100 занятий; при большей неделе попап предупреждает заранее, а попытка «всё сразу» получает понятную ошибку с советом копировать в несколько заходов по локациям.
- **Ошибки сети/сервера** → тост с сообщением, сетка не меняется; фейковый тост-заглушка «Прошлая неделя скопирована» исчезает.

**Параллельные IMPL:** #257 и #267 трогают соседние области (`ScheduleDataContext.tsx`, сетка) — жёсткой очерёдности нет, конфликты решаются на мерже (спека §12). Задачи ниже затрагивают только функцию копирования в общих файлах.

---

## Task 1: Copy-week backend contracts (schemas + error codes)

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §4 — контракт эндпоинта (request/response/ошибки)
- `docs/domain-rules/activities.md` — контекст сущности Activity

### Files
- Modify: `backend/src/schemas/activity.py`
- Modify: `backend/src/errors.py`

### Task Description
Добавить Pydantic-схемы и коды ошибок:

```python
class ActivityCopyWeekRequest(BaseModel):
    week_start: date                    # понедельник целевой недели
    locations: list[str] = Field(..., min_length=1)  # явный список id локаций, строго обязательное

class CopyWeekResult(BaseModel):
    copied: int
    skipped_duplicates: int
    skipped_filtered: int
    skipped_no_master: int
```

В `ErrorCode` — три новых значения + записи в `ERROR_MESSAGES` (без них KeyError в рантайме):
- `COPY_WEEK_START_NOT_MONDAY`: «Неделя должна начинаться с понедельника»
- `COPY_WEEK_INVALID_LOCATION`: «В списке локаций есть неизвестные локации»
- `COPY_WEEK_SOURCE_TOO_LARGE`: «В выбранной области более 100 занятий — скопируйте в несколько заходов, сузив выбор локаций»

### Steps
- [ ] Добавить схемы в `backend/src/schemas/activity.py` (импорт `date`, `Field`)
- [ ] Добавить три ErrorCode + три записи в `ERROR_MESSAGES` в `backend/src/errors.py`
- [ ] RED: тест в `backend/tests/test_api_activities.py` — валидация схем (пустой `locations` → 422 VALIDATION_ERROR; неизвестный ErrorCode в ERROR_MESSAGES не падает)
- [ ] GREEN: прогнать `uv run --extra dev pytest backend/tests/test_api_activities.py -k copy_week`
- [ ] Commit

### DoD
- pytest schema-тесты зелёные; схемы и коды ошибок соответствуют спеке §4.

---

## Task 2: copy_week service method (атомарный конвейер)

### Classification: large

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §5 (правила копирования) — вся логика здесь
- `docs/domain-rules/activities.md` — секция Week copy + инвариант #258/#259 (пересечения легальны, не валидируем)
- `backend/src/services/decorators.py` — семантика `@transactional` (коммит внутри декоратора!)
- `backend/src/services/activity.py:213-258` — образец многострочной атомарной операции (delete) и паттерн метки `tags`

### Files
- Modify: `backend/src/services/activity.py` (новый метод `copy_week`)
- Create: `backend/tests/test_copy_week.py` (unit-тесты конвейера)

### Task Description
Метод `ActivityService.copy_week(*, week_start: date, locations: list[str]) -> CopyWeekResult`, ВЕСЬ конвейер — один метод под ОДНИМ `@transactional`:

1. Валидация: `week_start.weekday() != 0` → 422 `COPY_WEEK_START_NOT_MONDAY`; список `locations` проверяется на существование в `locations` → отсутствующие → 422 `COPY_WEEK_INVALID_LOCATION`.
2. Окна через `day_range()` (`src/domain/dates.py`): source = `[week_start−7 .. week_start−1]`, target = `[week_start .. week_start+6]`.
3. Прочитать source-строки одним внутренним запросом (join `masters`+`staff`+`locations`; без пейдж-конверта) и target-ключи: `set((master_id, service_id, start, duration))` всех занятий target-недели.
4. Фильтры кандидатов: `is_private=true` → вне; локация заархивирована (`locations.is_active=false`) → вне; локация не в списке `locations` → вне. Занятия архивных услуг копируются (осознанно, спека §5.1).
5. Ремап: строка с архивным мастером (`masters.is_active=false` или строка отсутствует) → замена = первый активный мастер с непустым пересечением CSV-specialty (split «,», strip, регистронезависимо) в каноническом порядке борда `sort_order ASC, first_name ASC, id ASC`; замены нет → `skipped_no_master`.
6. Дедуп: ключ `(master_id, service_id, start + timedelta(days=7), duration)` против target-набора И против уже вставленных в этом прогоне (in-run set, пополняется после каждой вставки) → `skipped_duplicates`.
7. Кап: итоговый набор к вставке > 100 → 422 `COPY_WEEK_SOURCE_TOO_LARGE` (проверка ПОСЛЕ дедупа).
8. Вставка: прямые `Activity(...)`-инстансы (`table(**data)`-стиль, как repo) + `flush`; поля — всё как в оригинале кроме id/таймстампов (§5.4); **`is_private` у копий всегда `false`** (приватные отфильтрованы на входе); **`ActivityService.create` в цикле НЕ вызывается** (каждый его вызов сам `@transactional` и коммитит построчно — только прямые ORM-вставки); НЕ вызывать `check_master_active` (инвариант ремапа, спека §5.3).
9. Связи `tags`: явные вставки join-строк `activity_tags` для скопированных занятий (после flush, в той же транзакции) + `mark_changed("tags")`.
10. Ответ: `CopyWeekResult` со счётчиками; SSE-метку семейства `activities` делает авто-метка декоратора — построчные `mark_changed` не нужны.

Ключевой тест-инвариант: сбой на середине (например, IntegrityError на подмешанной строке) → полный rollback, в базе ноль копий.

### Steps
- [ ] RED: `backend/tests/test_copy_week.py` — кейсы: чистая неделя (все скопированы, поля и сдвиг +7д); повтор (все → skipped_duplicates); merge; приватные/архивная локация/фильтр локаций; ремап (пересечение CSV, порядок борда, нет замены); дедуп внутри прогона (два кандидата → один ключ); теги копируются; сбой вставки → rollback; кап 101 → 422
- [ ] Прогнать RED: `uv run --extra dev pytest backend/tests/test_copy_week.py` (падает — метода нет)
- [ ] Implement: метод `copy_week` по шагам 1-10 (один `@transactional`)
- [ ] GREEN: `uv run --extra dev pytest backend/tests/test_copy_week.py`
- [ ] Commit

### DoD
- Все unit-кейсы зелёные; в методе нет зацикленного `ActivityService.create` (каждая строка — прямой ORM-инстанс в одной транзакции).

---

## Task 3: Copy-week route + API tests

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §4 — гварды и коды ошибок
- `docs/domain-rules/activities.md` — Week copy

### Files
- Modify: `backend/src/api/v1/activities.py`
- Modify: `backend/tests/test_api_activities.py`

### Task Description
Роут по образцу существующих: `POST /copy-week` с `dependencies=_WRITE_GUARD` (activities:write + verify_fetch-metadata, `activities.py:36-39`), `response_model=CopyWeekResult`. Роут объявить рядом с create; конфликта с `/{id}`-роутами нет (POST-параметризованных маршрутов в файле нет). Тело — `ActivityCopyWeekRequest`.

### Steps
- [ ] Добавить роут `copy_week` в `backend/src/api/v1/activities.py`
- [ ] RED: API-тесты в `test_api_activities.py`: 401/403 (нет прав), CSRF-отклонение, 422 не-понедельник, 422 пустой `locations`, 422 неизвестный id локации, 422 кап, merge-сценарий end-to-end (частично занятая target → {copied, skipped} соответствуют), повторный вызов → copied=0
- [ ] GREEN: `uv run --extra dev pytest backend/tests/test_api_activities.py -k copy_week`
- [ ] Commit

### DoD
- Все API-кейсы зелёные; контракт совпадает со спекой §4.

---

## Task 4: api-client + context mutation (заглушка → реальная мутация)

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §7 — интеграция фронта
- `docs/domain-rules/activities.md` — Frontend-канон (canon #142, инвалидация семейства)

### Files
- Modify: `packages/api-client/src/endpoints.ts` (+ `copyWeek`)
- Modify: `frontend/admin/contexts/schedule/ScheduleDataContext.tsx` (заглушка :281-283 → мутация; интерфейс :77)
- Modify: `frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx` (:576 — тест «does not throw» переписать)
- Modify: `frontend/admin/__tests__/helpers/mockContexts.ts` и `splitScheduleOverrides.ts` (моки `copyLastWeek` под новую сигнатуру)

### Task Description
- api-client: `copyWeek({week_start, locations}) → CopyWeekResult` (follow the existing `getActivities`/`createActivity` pattern in `endpoints.ts`).
- Контекст: plain-мутация по образцу `createMutation` (`ScheduleDataContext.tsx:152-159`) — `mutationFn: copyWeek`, `onSuccess: invalidateEntities(queryClient, ['activities'])` (семейство-префикс из `lib/invalidate.ts:82`; точечный ключ недели `qk.activityRange` — другой ключ). Оптимистики нет — копия атомарна.
- Новый экспозиционный контракт: `copyLastWeek(weekStart: string, locations: string[]): Promise<CopyWeekResult>` — подпись меняется, обновить моки и тесты.

### Steps
- [ ] `copyWeek` в `packages/api-client/src/endpoints.ts` (по существующему паттерну)
- [ ] Мутация в `ScheduleDataContext` + правка интерфейса :77
- [ ] Grep по `copyLastWeek` и `copy-week` по всему фронту — обновить ВСЕХ потребителей подписи (моки `mockContexts.ts:54`, `splitScheduleOverrides.ts:36`, любые другие тесты/спеки, где встречается)
- [ ] Переписать тест :576: мутация дергает api-client и инвалидит `['activities']` (RED → GREEN, vitest)
- [ ] Commit

### DoD
- vitest зелёный; заглушки `copyLastWeek` в коде больше нет; grep по `copyLastWeek` не находит непереведённых потребителей.

---

## Task 5: CopyLastWeekPopover (пикер локаций)

### Classification: standard

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §6 — полный UX попапа (счётчики, подсказки, состояния)
- `docs/design-system.md` — попапы/флоатинг-UI, тосты, состояния кнопок

### Files
- Create: `frontend/admin/app/components/schedule/CopyLastWeekPopover.tsx`
- Create: `frontend/admin/__tests__/schedule/CopyLastWeekPopover.test.tsx`

### Task Description
Компонент попапа (рядом с `WeekView`/`OverlapPopover` в `app/components/schedule/`):

- Открытие → `queryClient.fetchQuery({ queryKey: qk.activityRange(srcStart, srcEnd), queryFn: getActivities({date_from: srcStart, date_to: srcEnd, per_page: 100}), staleTime: 5*60_000 })`; целевую неделю взять из кэша (`getQueryData(qk.activityRange(weekStart, weekEnd))` — она уже загружена сеткой).
- Список локаций = локации source-недели минус архивные (словарь локаций страницы); чекбоксы, все включены по умолчанию; число «к копированию» у каждой = строки локации минус приватные минус чьи ключи есть в целевой неделе.
- Подсказка «K индивидуальных занятий не копируются» при K>0 (K = число приватных строк source). Подсказки про ремап НЕТ (не вычислима на клиенте — спека §6).
- `total > items.length` → заметка «Показаны первые 100 из N занятий; за один заход копируется до 100 — сузьте выбор локаций или скопируйте в несколько заходов».
- Пустой source → пустое состояние; «Скопировать» неактивна.
- «Скопировать» неактивна, если итог «к копированию» = 0 или мутация в полёте; по успеху — закрытие попапа (решение спеки §6).
- Клик «Скопировать» → `copyLastWeek(weekStart, checkedLocationIds)` → по ответу тосты (спека §6): success «Скопировано N занятий» (+ «(пропущено M — уже есть)», + вторая строка «не скопировано ещё K — …» при отфильтрованных), info «Всё уже есть» / «Нечего копировать»; ошибка → error-тост с серверским сообщением.

### Steps
- [ ] RED: `CopyLastWeekPopover.test.tsx` — рендер по моку source-недели: счётчики нетто, подсказка K, заметка 100-из-N, пустое состояние, disable-логика, закрытие по успеху
- [ ] Реализовать компонент (floating UI по design-system.md; данные через `useScheduleData` + `useQueryClient`)
- [ ] GREEN: vitest
- [ ] Commit

### DoD
- vitest зелёный; все состояния спеки §6 покрыты тестами.

---

## Task 6: Toolbar wiring + честные тосты

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §6 — кнопка и тосты
- `docs/design-system.md` — тосты (kind success/info/error)

### Files
- Modify: `frontend/admin/app/components/layout/Toolbar.tsx` (:52-58)
- Verify: `frontend/admin/e2e/schedule-z-layering.spec.ts` (по ревью: буквального фейк-тоста в файле нет — проверить, что никакая e2e-сцена не опирается на старое поведение кнопки, поправить при необходимости)

### Task Description
- Кнопка «Копировать прошлую неделю» открывает `CopyLastWeekPopover` (вместо вызова заглушки); безусловный `showToast('Прошлая неделя скопирована')` УДАЛИТЬ.
- Тосты показывает попап по ответу мутации (kinds: success/info/error) — Toolbar не дублирует.
- Кнопка передаёт `week_start` = понедельник просматриваемой недели (уже доступен в контексте).

### Steps
- [ ] Перевести кнопку на открытие попапа, удалить фейковый тост
- [ ] Проверить `schedule-z-layering.spec.ts` и остальные schedule-спеки на опору в старое поведение кнопки (фейк-тост) — обновить, где есть
- [ ] vitest/e2e-линт зелёный
- [ ] Commit

### DoD
- Молчаливых заглушек и фейковых тостов не осталось (DoD issue).

---

## Task 7: e2e S1–S8 + CHANGELOG

### Classification: large

### Required Docs
- `docs/specs/2026-09-17-copy-last-week-design.md` §9 — сценарии и их точные формулировки
- `docs/domain-rules/activities.md` — Week copy (ассерты ремапа/дедупа)
- `frontend/admin/e2e/fixtures/helpers.ts` — `waitForScheduleReady` и фикстуры сид-сброса

### Files
- Create: `frontend/admin/e2e/copy-last-week.spec.ts`
- Modify: `CHANGELOG.md` (строка фичи)

### Task Description
Playwright-спека с тестами S1–S8 (названия тестов начинаются с «S1: …»–«S8: …», сид — штатный, пер-тест сброс действует). Ключевые ассерты:
- S1: после копии карточки появляются на тех же днях/времени; числа совпадают; тост; попап закрыт.
- S2: второй клик → copied=0, тост «Всё уже есть».
- S3: предсоздать в целевой неделе занятие с НЕсовпадающим ключом → скопированы недостающие.
- S4: приватные из сида (seed.py:93-175 содержит is_private-занятия) не появились; подсказка «K индивидуальных…» в попапе.
- S5: архивировать локацию через штатный API-путь админки (тот же вызов, что делает таблица локаций — уточнить роут в `src/api/v1/locations.py` при написании: PATCH `is_active=false` или выделенный archive-роут) → занятия не скопированы, локации нет в попапе.
- S6: архивировать мастера аналогично (`src/api/v1/masters.py`) → занятие скопировано под первого активного с пересекающейся speciality (в каноническом порядке борда); случай «замены нет» → тост «без замены мастера».
- S7: снять галку локации → её занятия не скопированы.
- S8: пустая прошлая неделя → пустое состояние, кнопка disabled.

### Steps
- [ ] RED: скелет спеки S1-S8 (падает — попапа нет)
- [ ] Реализовать тесты по ассертам выше (GREEN после Tasks 4-6)
- [ ] Прогнать только новую спеку: штатная e2e-команда репо с фильтром по файлу
- [ ] CHANGELOG.md: строка фичи в секцию Unreleased
- [ ] Commit

### DoD
- E2E test for scenario 1 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 2 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 3 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 4 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 5 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 6 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 7 passes (RED-GREEN-REFACTOR)
- E2E test for scenario 8 passes (RED-GREEN-REFACTOR)
- e2e-файл не ломает существующие шард-прогоны (`test-all.sh`).

---

## Порядок и зависимости задач

Task 1 → Task 2 → Task 3 (бэкенд целиком) → Task 4 → Task 5 → Task 6 (фронт) → Task 7 (e2e + CHANGELOG). Внутри фронта Task 5 зависит от Task 4 (мутация), Task 6 от Task 5. Общих файлов с параллельными IMPL (#257/#267) минимум; правки в `ScheduleDataContext.tsx` ограничены мутацией копирования (Task 4).
