# План #328 — ServiceModal: поле тегов услуги

Спека: `docs/specs/2026-09-20-servicemodal-tags-328-design.md` (rev2, gate B OK 2026-09-20, панель 5/6 PASS).
Behavioral Delta — в спеке §4, здесь не дублируется.

## Goal

Починить молчаливую потерю тегов услуги при сохранении редактирования и достроить управление тегами услуги: поле «Теги» в форме услуги (чипы + поиск по названию) по образцу формы фото. Фронт-only: бэкенд, контракт API и api-client не меняются.

## Architecture

```
serviceFields.tsx — локальный тип поля 'tags' + запись в SERVICE_FIELDS
        ↓
ServiceModal — предзаполнение из service.tags; рендер-ветка tags
        ↓  (чипы + общий RemoteSearchSelect, поиск getTags)
ServiceModal.handleSubmit — {id,title}[] → string[] (рядом с materials)
        ↓
ServicesTable.handleEditSubmit — без правок: строка tag_ids получает честный массив
        ↓
PUT /api/v1/services/{id} — контракт не меняется (полное обновление)
```

Слои не пересекаются: общий контрол и api-клиент используются как есть; новый код только в локальных файлах формы услуги (конвенция «Local field types, no shared modal imports»).

## Tech Stack

Next.js (admin), React 19, TanStack Query (инвалидация существующая), Playwright (e2e), Vitest + Testing Library (компонентные тесты).

---

## Task 1. Конфигурация поля тегов в serviceFields

Классификация: **trivial**. Сценарии: S1–S4 (база для всех).
Required Docs: спека §6.1, §6.2 (предзаполнение/рендер — конфигурация их обслуживает).

- В `frontend/admin/app/(main)/services/components/serviceFields.tsx`: локальный интерфейс `TagsFieldConfig { type: 'tags'; key: 'tag_ids'; label: string; placeholder?: string }` (по образцу `photoFields.tsx:30–37`, `:81–84`), добавить в union типов.
- Запись в `SERVICE_FIELDS` после поля материалов: `{ type: 'tags', key: 'tag_ids', label: 'Теги', placeholder: 'Введите название тега...' }`.
- Проверка: `npm run typecheck` в `frontend/admin` зелёный.

## Task 2. Предзаполнение, рендер и отправка в ServiceModal

Классификация: **standard**. Сценарии: S1, S2, S3, S4.
Required Docs: спека §6.2, §2.6 (источник предзаполнения — ответ API несёт `tags`), §8 (нота о 500 на несуществующий id — вне скоупа).

В `frontend/admin/app/(main)/services/components/ServiceModal.tsx`:

- **Предзаполнение** (ветка в `useState`-инициализации, рядом со спец-случаем `materials`, ~`:396–412`): `type === 'tags'` → `initial['tag_ids'] = (service?.tags as {id; title}[]) ?? []` (создание — пустой массив). Зеркало `PhotoModal.tsx:233–234`.
- **Рендер-ветка `tags`** в локальном `FieldRenderer` (~`:41`): чипы выбранных тегов с кнопкой-крестиком + `RemoteSearchSelect` из `@/app/components/shared/RemoteSearchSelect`: `onSelectItem` добавляет `{id, title}` без дублей (проверка по `selectedTagIds`), `onSearch = getTags({q, per_page: 10})`, `minChars: 2`, фиктивные `value={null}` / `onChange={() => {}}` — как в образце (`PhotoModal.tsx:74–120`). Поправка доступности против образца (спека §6.2): видимый лейбл связан с полем поиска (`htmlFor`/`id` через `useId`), кнопкам-крестикам — `aria-label={'Удалить тег ' + tag.title}`.
- **Изменения через общий `handleChange`** — флаг «грязной» формы и подтверждение закрытия работают без отдельной проводки (спека §6.2).
- **Отправка** в `handleSubmit` (~`:483–497`), рядом с `materials`: `tag_ids: ((formData['tag_ids'] as {id: string}[]) ?? []).map(t => t.id)`.
- `getTags` импортировать из `@memo/api-client` (как в PhotoModal).
- Не трогать: логику `max_age` (#203), перекрёстную валидацию тарифов, архивный флаг.

## Task 3. Компонентные тесты формы и таблицы

Классификация: **small**. Сценарии: S1, S2, S3 (+dirty-close как граничный случай).
Required Docs: спека §5 (список компонентных проверок), §6.2.

- `frontend/admin/__tests__/ServiceModal.test.tsx`:
  - предзаполнение: модалка редактирования с `service.tags = [{id, title}]` рендерит чип с названием;
  - payload: `handleSubmit` с выбранными тегами передаёт `tag_ids: string[]` (id, не объекты);
  - дубли: повторный `onSelectItem` существующего тега не добавляет второй чип;
  - «грязное» закрытие: добавление/снятие чипа → подтверждение при закрытии;
  - рендер: поле тегов не пустое место (рассинхрон конфигурации и рендер-ветки ловится — спека, осуществимость #3).
- `frontend/admin/__tests__/ServicesTable.test.tsx`: payload редактирования несёт `tag_ids` из формы (не `[]` при непустых тегах).
- Прогон: `npx vitest run` по трём файлам (`ServiceModal`, `ServicesTable`, `useServicesMutations` — третий как DoD-проверка pass-through: строки с `tag_ids: []` остаются зелёными без правок) зелёный.

## Task 4. E2E services-tags.spec.ts (S1–S4)

Классификация: **standard**. Сценарии: S1, S2, S3, S4.
Required Docs: спека §5 (S1–S4), §6.4 (восстановление полным payload — общий приём).

Новый файл `frontend/admin/e2e/services-tags.spec.ts` (паттерн сидов и хелперов — из `services-null-max-age.spec.ts`):

- **S1 (исходный баг):** услуга с тегом до открытия формы — сид-связь `s4`→`tag3` (`seed.py:480`; по спеке «создана до формы» — сидовая связь это та же запись `service_tags`); открыть редактирование, изменить только длительность, сохранить; чип тега на месте в таблице, GET отдаёт живую связь.
- **S2 (смена набора):** снять чип A, добавить B через поиск (ввод ≥2 символов), сохранить; в таблице B, A исчез, GET подтверждает.
- **S3 (создание с тегом):** создать услугу, добавить тег в форме; связь создана, чип виден.
- **S4 (снятие всех):** услуга с двумя тегами → снять оба, сохранить → чипов нет, связей нет, без ошибок.
- Восстановление состояния в `finally` — только полным payload с `tag_ids` из GET-снапшота (частичный PUT стёр бы теги; спека §6.4).
- Прогон: новый spec зелёный; регресс соседних services-спеков не внесён.

## Task 5. Чистка обхода в services-null-max-age.spec.ts (S5)

Классификация: **small**. Сценарии: S5.
Required Docs: спека §2.6 (битый комментарий «`tags` приходит пустым»), §6.4.

- Убрать sqlite-чтение тегов из `captureService` (функция на `:65–71`; единственное sqlite-чтение в файле): `tagIds` маппится из `row.tags` GET-ответа.
- `restoreService`/`toUpdatePayload` (`:89–102`) — без изменений семантики: полный payload, `tag_ids` из снапшота.
- Удалить битый комментарий «`tags` приходит пустым» и упоминания «форма всегда шлёт `[]`» (больше не правда).
- Прогон: `services-null-max-age.spec.ts` зелёный, тег сида (`s4`→`tag3`) жив после прогона.

## Порядок и зависимости

T1 → T2 → T3 (тесты на готовой форме) → T4 (e2e на готовой форме) → T5 (чистка после того, как S1 реально зелёный). T4 и T5 можно менять местами после T3.

## DoD спеки (§9) закрывается: S1–S5 зелёные, компонентные тесты зелёные, sqlite-обход и битый комментарий удалены.
