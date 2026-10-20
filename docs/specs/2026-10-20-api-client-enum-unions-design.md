# #480: экспорт TS-юнионов перечислений контракта из api-client — дизайн

- **Issue:** #480 (`refactor(api-client): экспортировать TS-юнионы перечислений (статусы визитов/записей) — убрать локальные переписывания на фронте`)
- **Дата:** 2026-10-20. Гейт A пройден: пользователем выбрана концепция **A — строгие ответы** с двумя вынужденными исключениями (§3.3).
- **Рев. 2** (2026-10-21, по панели 6 ревьюеров): устранён блокер — словарь `RecordStatus` не существует, статус записи несёт значения статуса визита (§3.1); внесены аудит данных БД, контракт отказа с fail-closed авторизацией (§3.3), паритет-тест и тесты полноты списков (§6), закрытый перечень query-перечислений (§3.2).
- **Скаут:** вердикт «partially stale» — поправки к телу issue зафиксированы в комментарии [issues/480#issuecomment-6300449546](https://github.com/mkosinov/memo/issues/480#issuecomment-6300449546). Ключевые поправки: `VisitStatus` уже экспортирован из `@memo/domain` (админка импортирует тип в 16 файлах, копий именно списков значений не осталось); перечислений в контракте шесть, а не два; поля-перечисления в ответных схемах api-client типизированы `z.string()`.

## 1. Контекст и проблема

Перечисления контракта (источник — pydantic: `backend/src/models/enums.py` и `backend/src/domain/visit_status.py`) существуют в `packages/api-client/src/schemas.ts` только как инлайн `z.enum`-литералы внутри запросных схем и наружу как TS-типы не экспортируются. Компоненты админки переписывают множества значений руками: списки опций селектов, switch-ветки иконок, Set-валидаторы, касты. При правке контракта копии расходятся молча — фильтр перестаёт видеть новый статус, опции селекта отстают от сервера.

Дополнительно: ответные схемы типизируют те же поля как `z.string()`, поэтому значения из ответов — просто строки, и каждый потребитель мостит строку к юниону сам (guard в `status-utils`, каст в `useRecordMutations`).

## 2. Цель / Не-цели

**Цель:**

1. Каждое перечисление контракта получает именованную zod-схему и производный TS-юнион, экспортированные из `@memo/api-client`.
2. Запросные схемы ссылаются на именованные схемы — литералы внутри пакета перестают дублироваться; итоговые TS-типы и поведение парсинга запросов не меняются.
3. Ответные схемы ужесточаются со строки до перечисления там, где все пути записи значения валидируются enum-ом на бэкенде (критерий и исключения — §3.3).
4. Локальные копии в админке заменяются импортами и производными от схем.
5. Удаляется мёртвый устаревший код: депрекейтед-типы `@memo/domain`, неиспользуемая зависимость в package.json api-client, устаревшее зеркальное поле `status` в `RecordCreateSchema`.

**Не-цели:**

- НЕ сворачивать per-endpoint наборы типов внутри api-client (решение пользователя по #404): ручное зеркало каждого эндпоинта — легитимный стиль; именованные схемы переиспользуются только как словарь значений перечислений.
- Web не трогаем: PR #479 (перевод web на api-client) открыт, конфликт гарантирован. Дубль `ConfirmationMethod` (копия `Channel`) в web — хвост после #479; `BookingStatus` — намеренно шире контракта (view-model), не трогать.
- `ClientCreateSchema.channel` НЕ ужесточаем, хотя бэкенд валидирует `Channel` при создании (`backend/src/schemas/client.py:20`): ужесточение меняет поведение клиентского парсинга для сценариев бронирования web (#479/#499). Расхождение зафиксировано, правка — в web-траектории.
- `theme`/`language` настроек, `permissions`, ключи `totals` (`dict[str, int]` на бэкенде) — свободные серверные строки/словари, не перечисления этой инвентаризации.
- Бэкенд не меняется.
- `@memo/domain` НЕ сливается с api-client (решение гейта A): модель представления ≠ зеркало контракта; вопрос слияния закрыт до отдельного триггера.

## 3. Решение

### 3.1 Именованные enum-схемы

Новая секция «Contract enums» в начале `packages/api-client/src/schemas.ts`, до первого использования. Для каждого перечисления: `export const XSchema = z.enum([...])` + `export type X = z.infer<typeof XSchema>`. `src/index.ts` уже реэкспортирует `export * from './schemas'` — новые имена выходят наружу автоматически.

| Схема / тип | Значения | Источник на бэкенде |
|---|---|---|
| `VisitStatusSchema` / `VisitStatus` | `waiting \| visited \| missed \| cancelled` | `src/domain/visit_status.py` |
| `PaymentMethodSchema` / `PaymentMethod` | `cash \| card \| transfer` | `src/models/enums.py` |
| `ChannelSchema` / `Channel` | `telegram \| whatsapp \| max` | `src/models/enums.py` |
| `UserRoleSchema` / `UserRole` | `admin \| master` | `src/models/enums.py` |
| `TariffAudienceSchema` / `TariffAudience` | `kid \| adult \| all` | `src/models/enums.py` |
| `ArchiveStatusSchema` / `ArchiveStatus` | `active \| archived \| all` | `src/models/enums.py` (фильтр мягкого удаления) |

**Отдельного словаря `RecordStatus` в контракте нет** (правило домена `docs/domain-rules/records.md`: «Single enum: `VisitStatus`. Record status is a derived field that mirrors the same values»): статус записи вычисляется сервером из визитов (`compute_record_status` возвращает `VisitStatus`) — записи в ответах несут значения статуса визита. Класс `RecordStatus` в `backend/src/models/enums.py` мёртв (используется только реэкспортом моделей) — api-client его не зеркалирует, очистка бэкенда вне охвата. Устаревшее поле `RecordCreateSchema.status` со словарём Wave-5 удаляется (§3.2).

**Порядок объявления — решение клиента:** именованные схемы объявляются в порядке нынешних UI-списков (например, `telegram, whatsapp, max` — НЕ порядок `enums.py`, где `TELEGRAM, MAX, WHATSAPP`). Паритет с бэкендом проверяется множествами значений, не порядком (§6).

Zod закреплён `^3.23.0` — `ZodEnum.options` доступен и типизирован кортежем в порядке объявления. При будущей миграции на Zod 4 тип `.options` теряет отслеживание порядка — потребителей `.options` (§3.4) перепроверить.

Совпадение имён с удаляемыми депрекейтед-типами `@memo/domain` (§3.5) конфликта не создаёт: пакеты независимы. Юнион `VisitStatus` из `@memo/domain` остаётся; совместимость словарей двух пакетов закреплена тестом (§6), перебрасывать 16 импортов админки не нужно.

### 3.2 Переподключение запросных схем (поведение не меняется)

Обёртки (`optional`/`nullable`/`default`) сохраняются; меняется только `z.enum([...])` → именованная схема.

| Схема (schemas.ts) | Поле | Станет |
|---|---|---|
| `VisitCreateSchema` (:416) | `status` | `VisitStatusSchema.optional()` |
| `VisitPatchSchema` (:428) | `status` | `VisitStatusSchema.optional()` |
| `RecordCreateSchema`, вложенные visits (:558) | `status` | `VisitStatusSchema.optional()` |
| `PaymentCreateSchema` (:572) | `method` | `PaymentMethodSchema.optional()` |
| `ClientUpdateSchema` (:506) | `channel` | `ChannelSchema.nullable()` |
| `CreateUserSectionSchema` (:81) | `role` | `UserRoleSchema.nullable().optional()` |
| `StaffUpdateSchema` (:114) | `role` | `UserRoleSchema.nullable().optional()` |
| `TariffCreateSchema` (:606) | `audience` | `TariffAudienceSchema.optional().default('all')` |
| `TariffResponseSchema` (:250) | `audience` | `TariffAudienceSchema` (сейчас инлайн `z.enum` — поведение то же) |

**Удаление устаревшего зеркального поля.** `RecordCreateSchema.status` (:547) — бэкенд не принимает `status` в payload-ах записи: `RecordCreate`/`RecordUpdate`/`RecordPatch` (классы бэкенда; на стороне клиента PATCH-схемы записей нет) поля не имеют, `extra="forbid"` (`backend/src/schemas/record.py:59-101`, коммит 151a6f65 «reject status field in Record payloads»); статус записи вычисляется сервером из визитов. Поле удаляется из `RecordCreateSchema`; `RecordUpdateSchema` (= partial от create) теряет его автоматически. Клиент, отправляющий поле, уже сегодня получает 422 — живых потребителей нет.

**Query-параметры (закрытый перечень).** Фильтр статуса списков записей на бэкенде типизирован `VisitStatus | None` (`record.py:189`); в `endpoints.ts` переподключаются ровно три места: `getRecords` (`status?: string`, :553) и `getRecordsView` (`status?: string`, :590) → `VisitStatus`; архивный фильтр словарных списков (`status?: 'active' | 'all' | 'archived' | null`, :126) → `ArchiveStatus`. Расширение перечня — только через ревизию спеки.

### 3.3 Строгие ответы (концепция A)

**Критерий ужесточения:** поле ответа переводится со строки на перечисление ⇔ (а) все пути записи/вычисления значения на бэкенде валидируются enum-ом, и (б) фактические данные БД не содержат значений вне словаря. Пункт (б) проверен при дизайне — аудит обеих баз (dev `memo.db` и `test_memo.db`): `records.status` и `visits.status` ∈ {waiting, visited}; `payments.method` ∈ {cash, card, transfer}; `users.role` ∈ {admin, master} — мусора нет. Канал клиента и в этих базах чист, но остаётся строкой: легаси-мусор документирован историей бэкенда (#60), гарантий на будущие строки нет.

| Поле ответа (schemas.ts) | Было | Станет | Обоснование |
|---|---|---|---|
| `VisitResponseSchema.status` (:401) | `z.string()` | `VisitStatusSchema` | все пути записи — enum (`VisitIn` default WAITING, `VisitPatch`, вложенные `VisitItem`) |
| `RecordResponseSchema.status` (:439) | `z.string()` | `VisitStatusSchema` | статус записи — производное от визитов, несёт значения статуса визита (§3.1) |
| `PaymentResponseSchema.method` (:528) | `z.string().nullable()` | `PaymentMethodSchema.nullable()` | **исправление зеркала**: бэкенд отвечает enum-ом (`PaymentResponse` наследует `PaymentBase` с `method: PaymentMethod \| None`, `backend/src/schemas/payment.py:40`) — api-client сегодня мягче контракта |
| `StaffAccountSchema.role` (:30) | `z.string()` | `UserRoleSchema` | записи роли — только через enum-валидированные схемы |
| `AuthUserSchema.role` (:733) | `z.string()` | `UserRoleSchema` | то же |
| `UserResponseSchema.role` (:839) | `z.string()` | `UserRoleSchema` | то же |
| `MyProfileSchema.role` (:765) | `z.string()` | `UserRoleSchema` | то же |

`RecordViewResponseSchema` и `ClientWithStatsSchema` наследуют ужесточение автоматически (extend).

**Исключения (остаются `z.string()`, осознанно):**

- `ClientResponseSchema.channel` (:476) — в БД документирован легаси-мусор (бэкенд issue #60: 'instagram', 'vk', 'website'; `backend/src/schemas/client.py:86` — «Uses `str | None` … to tolerate any string already stored»). Ужесточение = гарантированные ошибки парсинга на живых данных.
- `AuditLogResponseSchema.user_role` (:911) — снимок роли на момент действия из журнала: журнал обязан терпеть исторические значения, даже если словарь ролей когда-нибудь сузится.
- `PaymentTotalsResponseSchema.totals` — на бэкенде `dict[str, int]`; остаётся записью со строковыми ключами.

Последствие ужесточения: неизвестное значение в ответе (возможно только при ошибке бэкенда или ручном SQL — все штатные пути записи валидированы) даёт явную ошибку парсинга api-client вместо молчаливой строки, которая сегодня тихо течёт в UI. Это осознанный выбор концепции A.

**Контракт отказа (где падает парсинг).** Валидация ответа — `schema.parse` на весь ответ целиком (`client.ts:132`): неизвестное значение ломает весь ответ, экран получает свою обычную ошибку загрузки; наружу выходит `ZodError`, а не `ApiError` — обработчики, ловящие только `ApiError`, его не перехватят. Путь авторизации — fail closed: ошибка парсинга auth-ответа (вход, `/auth/me`, обновление сессии) сбрасывает сессию с видимой ошибкой; обновление сессии при ошибке парсинга не сохраняет прежний снимок роли и разрешений (сегодня `catch` молча оставляет устаревший снимок — ужесточение делает эту дыру видимой, фиксируется вместе с ним); сетевые ошибки — прежнее поведение. Покрывается unit-тестом.

### 3.4 Замены в админке

Принцип: **списки-домены значений, порядок которых совпадает с порядком объявления enum, → производные от схем** (`XSchema.options` — runtime-массив значений); **списки с порядком интерфейса → остаются явными**, но исчерпывающе типизированы против юниона. Порядок опций интерфейса сохраняется байт-в-байт.

| Файл | Сегодня | Станет |
|---|---|---|
| `frontend/admin/app/lib/status-utils.ts` | `VALID_STATUSES = new Set<string>(['waiting', …])` | `new Set<string>(VisitStatusSchema.options)` — явный `Set<string>` сохраняет приём недоверенной строки; guard `safeStatus` сохраняет имя и контракт (фолбэк `'waiting'`), вместо каста — type predicate |
| `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts` | `VISIT_STATUS_ORDER` литералом | остаётся явным (UI-порядок `waiting,visited,cancelled,missed` ≠ порядку объявления), тип из юниона; полнота закреплена тестом множества против `VisitStatusSchema.options` (§6) |
| `frontend/admin/app/(main)/records/useRecordsUrlState.ts` | `RECORDS_STATUS_VALUES = […] as const` | остаётся явным (UI-порядок цикла фильтра ≠ порядку объявления), исчерпывающе типизируется; полнота закреплена тестом множества (§6) |
| `frontend/admin/app/(main)/staff/components/StaffModal.tsx` | `'admin' \| 'master'` переписан ~8 раз | `import type { UserRole }`; опции селекта — `UserRoleSchema.options` |
| `frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx` | литеральный список `cash/card/transfer` | `PaymentMethodSchema.options` |
| `frontend/admin/hooks/useRecordMutations.ts` | каст `as 'cash'\|'card'\|'transfer'` (:334); локальный `audience` (:160) | каст удаляется (ответ ужесточён); null-обработка метода не добавляется — метод был nullable и раньше, каст лишь скрывал это; `TariffAudience` импортом |
| `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` | `CHANNEL_VALUES = […] as const` + локальный `ChannelValue` | `ChannelSchema.options`; тип `Channel` импортом |
| `frontend/admin/app/components/modal/ActivityDetailsModal/NewRecordTab.tsx` | `useState('telegram')` без типа | типизация `Channel` |
| `frontend/admin/app/(main)/services/components/serviceFields.tsx` | литеральный список kid/adult/all | `TariffAudienceSchema.options` |
| `frontend/admin/lib/tariff-resolver.ts` | локальный `audience?: 'kid'\|'adult'\|'all'` | `TariffAudience` импортом |
| `frontend/admin/lib/age-groups.ts` | сентинел `'adult'` без типа | типизация `TariffAudience` |
| `frontend/admin/app/components/shared/icons/StatusIcons.tsx` | switch по 4 литералам | параметр типизируется `VisitStatus`; исчерпываемость веток проверяет TS |

Все новые импорты — из `@memo/api-client`. Существующие импорты `VisitStatus` из `@memo/domain` (16 файлов) не перебрасываются (§3.5).

### 3.5 Очистка

`packages/domain/src/index.ts` — удалить мёртвые объявления (потребители отсутствуют — проверено поиском по `frontend/**`; из domain админка использует только `computeRecordStatus`, `resolveById` и view-model типы):

- `RecordStatusSchema`, `RecordStatus` (:93-98; словарь Wave-5 — в api-client НЕ создаётся, §3.1) и держащие их `RecordSchema`, `Record` (:100-109);
- `PaymentMethodSchema`, `PaymentMethod` (:126-127) и `PaymentSchema`, `Payment` (:129-138);
- алиас `Studio` (:243-244, deprecated).

`packages/domain/src/index.test.ts` — тесты удалённых объявлений удаляются вместе с ними.

`packages/api-client/package.json` — удалить неиспользуемую зависимость `"@memo/domain": "workspace:*"` (в `src/` не импортируется).

**Что остаётся в `@memo/domain`:** `VisitStatus` + `computeRecordStatus` (живая логика, тип структурно совместим с юнионом api-client), `TariffSchema.audience` (собственное зеркало domain при живом потребителе `Tariff`), прочие view-model типы и функции.

### 3.6 Веб — вне охвата

Web типизируется от api-client в 4 файлах (`useSchedule`, `buildSchedule`, `to-location-vm`, `useLocations`) — ни один не трогает ужесточаемые поля (проверено): компиляция web от ужесточения не ломается. Правки web (`ConfirmationMethod` → `Channel`) — хвост после слияния PR #479.

## 4. Behavioral Delta

**Для пользователя ничего не меняется:** порядок опций селектов, значения фильтров, иконки статусов — как сегодня (производные списки идут в порядке объявления enum, совпадающем с нынешними литералами; списки с UI-порядком остаются явными).

**Для разработчика:**

- До: перечисления не экспортированы; ~15 локальных копий множеств значений в админке; статусы/роли/метод из ответов — строки, мостятся кастами и guard-ами.
- После: 6 именованных схем и юнионов из `@memo/api-client`; локальные копии удалены; ответы типизированы перечислениями (кроме канала клиента и снимка роли аудита — остаются строками по §3.3).

**Аномальный случай (не штатный):** неизвестное значение статуса/роли/метода в ответе — явная ошибка парсинга вместо молчаливой строки.

## 5. User Scenarios

Рефакторинг без изменения поведения; сценарии — регрессионные якоря существующих потоков, каждый закрепляется за E2E-тестом (файлы фиксирует план):

1. **Фильтрация Записей по статусу визита** — пользователь фильтрует таблицу Записей по статусу; фильтр применяется, URL-состояние работает. E2E: таблица записей.
2. **Смена статуса визита в карточке записи** — статус переключается, бейдж и иконка обновляются. E2E: карточка записи.
3. **Оплата со способом cash/card/transfer** — способ выбирается из списка, оплата создаётся и отображается. E2E: платежи в карточке записи.
4. **Создание и редактирование сотрудника с ролью** — роль выбирается в модальном окне и сохраняется. E2E: персонал.
5. **Канал связи клиента** — пользователь меняет канал в карточке клиента; легаси-значения канала продолжают отображаться (поле остаётся строкой). E2E: клиенты.
6. **Аудитория тарифа в услуге** — тарифу ставится kid/adult/all, метка переживает сохранение услуги. E2E: услуги.
7. **Вход и профиль** — вход администратора и загрузка профиля работают; якорь пути авторизации, ужесточаемого §3.3 (fail-closed контракт — unit-уровень). E2E: вход.

## 6. Тестирование

- **api-client (unit, `schemas.test.ts`):** `.options` именованных схем — правильный состав и порядок; запросные схемы — поведение парсинга не изменилось; `RecordCreateSchema` больше не принимает `status`; ужесточённые ответы принимают валидные значения и отклоняют неизвестные (новые негативные кейсы); канал клиента и снимок роли аудита по-прежнему принимают произвольные строки (контр-кейсы на исключения); fail-closed контракт auth-ответа (сброс сессии, обновление без устаревшего снимка роли).
- **Паритет словарей (новый backend-тест):** читает `packages/api-client/src/schemas.ts` и сверяет множества литералов шести именованных схем с pydantic-enum'ами бэкенда (`VisitStatus`, `PaymentMethod`, `Channel`, `UserRole`, `TariffAudience`, `ArchiveStatus`) — страховка от расползания ручного зеркала.
- **admin (unit):** задетые компоненты компилируются; состав и порядок опций списков неизменны; guard `safeStatus` сохранён; полнота UI-списков — `new Set(VISIT_STATUS_ORDER)` и `new Set(RECORDS_STATUS_VALUES)` равны `VisitStatusSchema.options`; кросс-пакетная совместимость — множества `VisitStatus` из `@memo/domain` и `audience` из `TariffSchema` равны соответствующим `.options` api-client.
- **E2E:** сценарии §5 зелёные (регрессия, без новых фич).
- **CI:** все проверки зелёные, включая type-check web (§3.6) и tsc api-client; размер собранного бандла админки не регрессирует (сверка при сборке). Арбитр полных прогонов — CI.

## 7. Риски

- **Легаси-мусор в БД:** аудит обеих баз при дизайне — чисто (§3.3); канал клиента исключён из ужесточения (документированный мусор, issue #60 бэкенда); остаточный риск ужесточённых полей — ручной SQL или ошибка бэкенда, и тогда явная ошибка честнее тихой поломки (выбор A), путь авторизации закрыт fail-closed контрактом.
- **Порядок опций:** производные списки следуют порядку объявления; совпадение с нынешними литералами проверено попарно. Списки, чей UI-порядок отличается (`VISIT_STATUS_ORDER`, `RECORDS_STATUS_VALUES`), остаются явными.
- **Параллельные сессии:** PR #479 (web) и #422 (e2e-сид) в полёте; зоны не пересекаются (api-client + admin против web fetch-стека и e2e-сида), мердж-дисциплина обычная.
- **Удаление `RecordCreateSchema.status`:** клиенты, отправлявшие поле, уже получают 422 от бэкенда — поведение не меняется ни для одного живого потребителя.

## Visual Compliance Checks

- N/A
