# План #480: экспорт TS-юнионов перечислений контракта из api-client

- **Спека:** `docs/specs/2026-10-20-api-client-enum-unions-design.md` (рев. 2, Gate B OK, main `20696760`)
- **Issue:** #480, метка `app:admin`. Web вне охвата (PR #479 открыт).

## Goal

Выполнить спеку #480: шесть именованных enum-схем и юнионов в `@memo/api-client`; переподключение запросных схем и трёх query-мест; ужесточение ответных полей по критерию §3.3 спеки (с fail-closed авторизацией); замена локальных копий в админке; вычистка мёртвого кода; защитные тесты (паритет словарей с pydantic, полнота UI-списков).

## Architecture

Ручное зеркало контракта в `packages/api-client/src/schemas.ts` получает единственный слой переиспользования — именованные словари перечислений; per-endpoint наборы типов не сворачиваются (решение пользователя по #404). Ответы валидируются строго по критерию §3.3; исключения (канал клиента, снимок роли аудита, ключи `totals`) остаются строками. Админка потребляет юнионы и runtime-массивы `XSchema.options`; списки с UI-порядком остаются явными, их полнота закреплена тестами. `@memo/domain` сохраняет `VisitStatus` + `computeRecordStatus` и view-модели; совместимость словарей двух пакетов закреплена тестами. Поведенческая дельта — в спеке §4 (для пользователя ничего не меняется).

## Tech Stack

TypeScript (strict), zod `^3.23.0` (`ZodEnum.options` — кортеж в порядке объявления; при миграции на Zod 4 перепроверить), vitest (api-client, admin), pytest (паритет-тест), Playwright E2E (существующие спеки, регрессия).

## Task 1: Именованные enum-схемы + переподключение запросной стороны api-client

### Classification: standard

1. `packages/api-client/src/schemas.ts` — новая секция «Contract enums» до первого использования: `VisitStatusSchema`, `PaymentMethodSchema`, `ChannelSchema` (порядок `telegram, whatsapp, max` — клиентский, НЕ порядок `enums.py`), `UserRoleSchema`, `TariffAudienceSchema`, `ArchiveStatusSchema`; для каждой `export type X = z.infer<typeof XSchema>`.
2. Переподключить запросные поля по таблице спеки §3.2; обёртки `optional/nullable/default` сохранить; итоговые TS-типы не меняются.
3. Удалить мёртвое поле `status` из `RecordCreateSchema` (бэкенд отвергает его с 422, `extra="forbid"`; спека §3.2; `RecordPatch` в спеке — имя бэкенд-класса, на клиенте PATCH-схемы записей нет).
4. `packages/api-client/src/endpoints.ts` — ровно три query-места: `getRecords` (`status?: string`, :553) и `getRecordsView` (:590) → `VisitStatus`; архивный фильтр списков (:126) → `ArchiveStatus`.
5. Тесты: `.options` каждой схемы — состав и порядок; парсинг запросных схем не изменился; `RecordCreateSchema` отклоняет `status`; query-параметры типизированы.

### Required Docs

- Спека §3.1–3.2 (таблицы, порядок, отказ от `RecordStatus`)
- `docs/domain-rules/records.md` (правило единого словаря: статус записи = значения статуса визита)

### DoD

- Unit-тесты api-client зелёные; `tsc` api-client чистый.

## Task 2: Ужесточение ответных схем + fail-closed авторизация

### Classification: standard

1. По таблице §3.3 спеки перевести семь полей на именованные схемы: `VisitResponseSchema.status` и `RecordResponseSchema.status` → `VisitStatusSchema`; `PaymentResponseSchema.method` → `PaymentMethodSchema.nullable()`; роли `StaffAccountSchema` / `AuthUserSchema` / `UserResponseSchema` / `MyProfileSchema` → `UserRoleSchema`. Наследники (`RecordViewResponseSchema`, `ClientWithStatsSchema`) подхватывают автоматически. Исключения НЕ трогать: `ClientResponseSchema.channel`, `AuditLogResponseSchema.user_role`, ключи `totals`.
2. Fail-closed авторизации (спека §3.3 «Контракт отказа»): ошибка парсинга auth-ответа (вход, `/auth/me`, обновление сессии) — сброс сессии с видимой ошибкой; прежний снимок роли/разрешений при этом не сохраняется; сетевые ошибки — прежнее поведение. Точка: `frontend/admin/contexts/AuthContext.tsx`. Механизм различения: в `catch` проверяется `error instanceof ZodError` — ошибка парсинга → сброс сессии; прочие ошибки (сеть, `ApiError`) — прежнее поведение (сохранение снимка, решение закреплено комментарием в `AuthContext.tsx:104-109` — комментарий обновить под новое разделение).
3. Тесты: негативные кейсы ужесточённых полей (неизвестное значение → ошибка парсинга всего ответа, наружу `ZodError`, не `ApiError`); контр-кейсы исключений (произвольная строка канала и роли аудита проходят); unit fail-closed (сброс сессии, обновление без устаревшего снимка).

### Required Docs

- Спека §3.3 (таблица, критерий, контракт отказа)
- `docs/domain-rules/auth.md`

### DoD

- E2E тест для сценария 7 проходит — существующая регрессия входа/профиля (RED-GREEN-REFACTOR); fail-closed покрыт unit-тестом, нового E2E не пишется.
- Unit api-client + admin зелёные.

## Task 3: Замены локальных копий в админке

### Classification: standard

По таблице §3.4 спеки, построчно:

1. `frontend/admin/app/lib/status-utils.ts`: `VALID_STATUSES` → `new Set<string>(VisitStatusSchema.options)`; guard `safeStatus` сохраняет имя и контракт (фолбэк `'waiting'`); каст заменить type predicate.
2. `VISIT_STATUS_CONFIG.ts` (`VISIT_STATUS_ORDER`) и `useRecordsUrlState.ts` (`RECORDS_STATUS_VALUES`) — остаются явными (UI-порядок ≠ порядку объявления), исчерпывающе типизируются; полнота — тестами Task 5.
3. `StaffModal.tsx` — `UserRole` импортом, ~8 локальных переписываний убрать; опции селекта из `UserRoleSchema.options`.
4. `RecordPaymentsTable.tsx` (опции из `PaymentMethodSchema.options`), `useRecordMutations.ts` (каст `as 'cash'|'card'|'transfer'` удалить, null-обработку не добавлять — метод был nullable и раньше), `ClientInfoTab.tsx` (`ChannelSchema.options`, тип `Channel`), `NewRecordTab.tsx` (типизация `Channel`), `serviceFields.tsx` (`TariffAudienceSchema.options`), `tariff-resolver.ts` и `age-groups.ts` (`TariffAudience`), `StatusIcons.tsx` (параметр `VisitStatus`).
5. Новые импорты — только из `@memo/api-client`; существующие импорты `VisitStatus` из `@memo/domain` (16 файлов) не трогать.

### Required Docs

- Спека §3.4 (таблица замен; принцип: производные списки — только при совпадении порядка)

### DoD

- E2E тесты для сценариев 1–6 проходят (регрессия).
- Admin unit: состав и порядок опций списков неизменны.

## Task 4: Вычистка мёртвого кода

### Classification: small

1. `packages/domain/src/index.ts`: удалить `RecordStatusSchema`/`RecordStatus` с держателями `RecordSchema`/`Record`, `PaymentMethodSchema`/`PaymentMethod` с держателями `PaymentSchema`/`Payment`, алиас `Studio`; удалить их тесты из `index.test.ts`. Потребителей нет (проверено по спеке §3.5 и грепом).
2. `packages/api-client/package.json`: удалить неиспользуемую зависимость `"@memo/domain": "workspace:*"`.
3. Кросс-пакетные тесты совместимости (admin unit): множества `VisitStatus` из `@memo/domain` и `audience` из `TariffSchema` равны `VisitStatusSchema.options` / `TariffAudienceSchema.options`.

### Required Docs

- Спека §3.5 (список удалений; что остаётся в domain)

### DoD

- Греп: упоминаний удалённых имён в `frontend/**` нет; сборка и тесты domain/admin зелёные.

## Task 5: Защитные тесты — паритет словарей и полнота списков

### Classification: small

1. Новый backend-тест (`backend/tests/`): читает `packages/api-client/src/schemas.ts`, сверяет множества литералов шести именованных схем с pydantic-enum'ами (`VisitStatus`, `PaymentMethod`, `Channel`, `UserRole`, `TariffAudience`, `ArchiveStatus`). Множества, не порядок.
2. Admin unit: `new Set(VISIT_STATUS_ORDER)` и `new Set(RECORDS_STATUS_VALUES)` равны `VisitStatusSchema.options`.

### Required Docs

- Спека §6, §3.1 (паритет множествами; порядок — решение клиента)

### DoD

- Оба теста зелёные; дрейф-демо: временно изменить один литерал — тесты красные (проверить один раз при разработке).

## Task 6: Полная регрессия и CI

### Classification: standard

1. Локально: целевые сюиты api-client и admin (канон локальных прогонов — целевые сюиты, арбитр — CI); E2E сценариев 1–7.
2. CI: все проверки зелёные на мерж-коммите, включая type-check web (спека §3.6) и tsc api-client; размер собранного бандла админки не регрессирует.

### Required Docs

- Спека §5 (сценарии), §6 (тестирование)

### DoD

- E2E тесты для сценариев 1–7 проходят; CI зелёный.
