# GH #328 — ServiceModal: поле тегов услуги (починка молчаливого стирания связей `service_tags`)

- **Date**: 2026-09-21
- **Branch**: `328-servicemodal-tags`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `9100d3ca` (main) — 6 commits (`b3914eb6..cd095090`), 7 files, +656 / −20
- **Issue**: #328 — ServiceModal: поле тегов услуги (починка молчаливого стирания связей `service_tags` при edit-save)
- **Spec**: `docs/specs/2026-09-20-servicemodal-tags-328-design.md` (rev2, panel 5/6 PASS, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-servicemodal-tags-328-plan.md` (5 tasks, on main, unchanged by IMPL)

## Goal

Форма услуги больше не теряет связи с тегами: в `ServiceModal` появилось поле «Теги»
(чипы выбранных тегов + серверный поиск по названию от 2 символов), форма предзаполняется
из `service.tags` и на сабмите передаёт честный `tag_ids: string[]`. Исходный баг
(edit-save отправлял `tag_ids: []`, а канон полного обновления PUT заменяет набор связей —
теги молча исчезали) уходит как следствие: бэкенд, контракт API и api-client не менялись.

## Summary of Changes (per task)

- **T1 — конфигурация поля (trivial):** `serviceFields.tsx` — новый локальный тип
  `TagsFieldConfig` (`{ type: 'tags'; key: 'tag_ids'; label: 'Теги'; placeholder? }`) и запись
  в `SERVICE_FIELDS` («Введите название тега...», после поля материалов — группировка «связи с
  другими сущностями»); конвенция «Local field types, no shared modal imports» соблюдена (`b3914eb6`).
- **T2 — предзаполнение/рендер/отправка + a11y (standard):** `ServiceModal.tsx` — ветка `tags`
  в `FieldRenderer`: чипы выбранных тегов с крестиком (`aria-label="Удалить тег {title}"`),
  `RemoteSearchSelect` (`onSelectItem` без дублей по id, `onSearch: getTags({q, per_page: 10})`,
  `minChars: 2`, фиктивные управляемые пропсы `value={null}` / `onChange` — как в фото-образце);
  предзаполнение `initial['tag_ids'] = service?.tags ?? []` (ключ формы `tag_ids`, read-схема
  отдаёт `tags` — зеркало `PhotoModal`); сабмит маппит `{id,title}[]` → `string[]` рядом с
  существующим маппингом материалов; поправка доступности против фото-образца — видимый лейбл
  связан с полем поиска через `htmlFor`/`id` (`useId`); общий `RemoteSearchSelect` получил
  необязательный `inputId` (backward-compatible: внутренний лейбл теперь `htmlFor={inputId}`,
  рендерится только при непустом `label`, `aria-label={label || undefined}`) (`72f91bfd`).
- **T3 — компонентные тесты (small):** `ServiceModal.test.tsx` (предзаполнение из `service.tags`,
  `tag_ids` в payload `handleSubmit`, повторное добавление существующего тега не дублирует чип,
  снятие/добавление чипа помечает форму «грязной» — закрытие спрашивает подтверждение, ветка
  `tags` реально рендерится) + `ServicesTable.test.tsx` (payload редактирования несёт `tag_ids`
  из формы, а не `[]`); review-фикс — освежён устаревший комментарий tags-мока (`2c45a481`,
  `614bfe15`).
- **T4 — e2e `services-tags.spec.ts` S1–S4 (standard):** S1 `edit-other-field-keeps-tags`
  (сид-связь `s4`→`tag3`; правка только «Длительность» → чип на месте, GET отдаёт живую связь —
  до фикса `after.tags` был бы пуст: строгие GET-ассерты после сохранения и есть regression guard),
  S2 `swap-tag-set` (снять «хит», добавить «сезонное» через typeahead ≥2 символов → GET отдаёт
  ровно `[популярное, сезонное]`), S3 `create-with-tag` (создание с тегом + очистка через
  deferred-delete execute body — голый dry-run DELETE дал бы 409 на живой связи), S4
  `remove-all-tags` (снять оба чипа → в строке и в GET пусто, без ошибок); восстановление в
  `finally` полным PUT-payload с `tag_ids` из GET-снапшота (частичный PUT сам стёр бы теги),
  sqlite-чтений нет (`fdfcb4bf`).
- **T5 — чистка обхода (small):** `services-null-max-age.spec.ts` — удалено sqlite-чтение тегов
  (`captureService` берёт `tag_ids` из `row.tags` GET-ответа) и битый комментарий «`tags` приходит
  пустым» / «форма всегда шлёт `[]`» (разрешён разведкой §2.6 спеки); семантика `restoreService`
  не менялась — полный payload (`cd095090`).

## Deviation (T4, sanctioned)

Согласно плану T4, S2/S4 должны были гоняться на `s5`/`s7`. Полный PUT услуги, чьи тарифы
ссылаются из сид-визитов (`s2`/`s3`/`s5`/`s7` — визиты сидят на тарифах `t2x`/`t3x`/`t5x`/`t7x`),
падает `INTEGRITY_VIOLATION`: канонический update жёстко пересоздаёт тарифы (delete+insert),
и живой FK `visits.tariff_id` блокирует delete. Это **pre-existing** поведение бэкенда вне
скоупа #328; S2/S4 переведены на `s1` (тарифы `t1*`, визитами не заняты), S1 — на `s4` (`t4*`).
Заведён отдельный issue **#357** (полный PUT на услугах с визит-связанными тарифами → 422,
pre-existing). Отклонение зафиксировано комментарием в шапке спека.

## Test Results

- **vitest (полный, admin):** **2342 passed / 0 failed** (после T3).
- **tsc** clean; **eslint** 0 errors (3 pre-existing warnings).
- **e2e:** новый `services-tags.spec.ts` — **4/4**; регресс `services` shard-rest — **10/10**;
  `services-null-max-age.spec.ts` — **2/2** до и после чистки T5 (тег сида жив).
- **Визуальный гейт G4.5:** **4/4 autonomous PASS**.
- Полный e2e-гейт — CI (PR).

## Acceptance Criteria (spec §5 scenarios + §9 DoD)

| Сценарий / DoD | Уровень | Статус |
|---|---|---|
| S1 — редактирование не трогает теги (исходный баг) | e2e `edit-other-field-keeps-tags` | ✅ (`fdfcb4bf`) |
| S2 — изменение набора тегов (снять A, добавить B) | e2e `swap-tag-set` (на `s1`) | ✅ |
| S3 — создание с тегом | e2e `create-with-tag` | ✅ |
| S4 — снятие всех тегов без ошибок | e2e `remove-all-tags` (на `s1`) | ✅ |
| S5 — чистка sqlite-обхода и битого комментария | e2e-правка + прогон 2/2 | ✅ (`cd095090`) |
| §9 — компонентные тесты (предзаполнение, payload, дубли, «грязное» закрытие, рендер ветки) | vitest | ✅ (`2c45a481`, `614bfe15`) |

## Key Files Changed

- `frontend/admin/app/(main)/services/components/serviceFields.tsx` — тип + конфиг поля «Теги» (T1)
- `frontend/admin/app/(main)/services/components/ServiceModal.tsx` — prefill / chips-рендер / `tag_ids` на сабмите, a11y-лейбл (T2)
- `frontend/admin/app/components/shared/RemoteSearchSelect.tsx` — необязательный `inputId`, скрытие пустого внутреннего лейбла (T2)
- `frontend/admin/__tests__/ServiceModal.test.tsx`, `frontend/admin/__tests__/ServicesTable.test.tsx` — компонентные тесты (T3)
- `frontend/admin/e2e/services-tags.spec.ts` — новый спек S1–S4 (T4)
- `frontend/admin/e2e/services-null-max-age.spec.ts` — снят sqlite-обход и битый комментарий (T5)

Бэкенд, api-client, миграции, domain-rules — не тронуты.

## Docs Impact

- Спека rev2 + план (5 задач) — на main, веткой не менялись.
- `docs/status/2026-09-21-servicemodal-tags-328.md` — этот документ.
- `CHANGELOG.md` — запись в `[Unreleased] — 2026-09-21`.
- `PLAN.md` — completion-blockquote в шапке.

## Known Non-Blocking Observations

- Полный e2e-гейт — CI (PR); локально прогнаны новый спек, services-регресс и
  `services-null-max-age`.
- **#357** (pre-existing): полный PUT на услугах с визит-связанными тарифами падает
  `INTEGRITY_VIOLATION` — вне скоупа #328, повлияло на выбор сид-строк в T4.
- Сознательно не строим (спека §7): контракт PUT/бэкенд, перевод услуг на PATCH, bulk-теги из
  таблицы, вынос общего «тегового поля» в shared-слой (дублирование ~40 строк — осознанная цена
  локальной конвенции полей услуг).
- Несуществующий id тега в `tag_ids` бэкенд встречает ошибкой целостности FK (500 вместо 422) —
  существующее поведение, всех писавших в услугу, спекой не вводится (кандидат в будущий
  бэкенд-проход).

## References

- **GitHub Issue**: #328
- **Follow-up issue filed**: #357 (pre-existing, full PUT on services with visit-referenced tariffs)
- **Design Spec**: `docs/specs/2026-09-20-servicemodal-tags-328-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-20-servicemodal-tags-328-plan.md`
- **Related**: #203 (`services-null-max-age` — источник sqlite-обхода, снятого в T5)
- **PR**: _(to be added after PR creation)_
