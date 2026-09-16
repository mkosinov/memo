# Спека: Выравнивание именований booking/record по домен-правилу (issue #103)

- Версия: rev2 (2026-09-16), гейт G1b — панель 16.09 (5 из 6 вернулись; consistency `skipped` — дважды упал на провайдере); MINOR-файндинги внесены в §3 D3, §4.2, §5, §7, §8.
- Источник: issue #103 + домен-правило юзера, сформулированное 16.09 в диалоге G1a.
- Фактура: аудит двумя скаутами 16.09 (код + документация), все пункты с `file:line`; точечные проверки G1a — `packages/domain/src/index.ts:198-242`, вкладка quickAdd `ActivityDetailsModal.tsx:113-260`, метки «бронь» в UI (grep — отсутствуют), `channel` в схеме записи (`schemas.ts:427,441`).

## 1. Контекст

Issue #103 просил переименовать `BookingFilters` → `RecordsFilters` на странице /records и провести аудит «booking» в /records-контексте. В ходе G1a юзер сформулировал общее домен-правило и попросил вычистить весь проект от неверных именований. Аудит показал: ядро онтологии уже консистентно — таблицы БД `records` (данные-результат) и `visits` (по-гостевые факты, `record_id` FK), API `/api/v1/records` и `/api/v1/visits` соответствуют правилу; таблицы/эндпоинтов `bookings` не существует, переименований на уровне схемы и API-контракта нет. Вред локален: один компонент с цепочкой testid (~20 e2e-селекторов), вкладка модалки, ~10 комментариев и 4 живых документа.

## 2. Домен-правило (дословно юзера, 16.09)

> booking — это процесс бронирования клиентом места на услуге.
> record — это данные — результат бронирования клиентом места на услуге.

Правила применения:

1. Имена поверх сохранённых данных (фильтры, таблицы, вьюхи, testid-селекторы по данным) → `record*`.
2. Имена процесса (форма, флоу, шаги, хендлеры сабмита, «booking flow») → `booking*` — легальны (юзер: «Booking flow это легальное именование если речь о процессе»).
3. Слово «bookings» (мн. ч.) в значении сохранённых строк → «records».
4. `visit` — отдельная сущность: факт прихода конкретного гостя внутри записи, НЕ синоним record; не переименовывается (решение юзера: «Visit не трогаем, там всё правильно уже»).

## 3. Решения (принято юзером 16.09)

- **D1** — домен-правило §2 фиксируется в `docs/domain-rules/_overview.md` (§5).
- **D2** — `BookingFilters` → `RecordsFilters` полностью: файл, компонент, интерфейс, testid, юнит-тест файлом целиком, все импорты и e2e-селекторы (§4.1).
- **D3** — вкладка быстрого добавления в модалке занятия: `NewBookingTab` → `NewRecordTab` (юзер: «Тут точно RecordTab должно быть, а не BookingTab»; префикс `New` сохранён — вкладка добавляет новую запись в режиме quickAdd; id/testid/поля следуют за компонентом, §4.2). Видимого текста с «бронь» в UI нет (проверено grep по `app/components/modal/` и schedule/) — пользовательские строки не меняются. Явный карв-аут из правила §2 п.2: для ЭТОЙ вкладки юзер решил, что она дата-сторона, поэтому её хендлер (`handleNewRecordSubmit`) и HTML-поля следуют за компонентом, хотя по общему правилу хендлеры сабмита легальны как `booking*`.
- **D4** — `BookingVisitor`/`BookingVisitorSchema` ОСТАЮТСЯ: по условию юзера («RecordVisitor — если там имеется ввиду посетитель из записи») условие не выполняется — тип описывает визитора процесса бронирования ДО создания записи (`tempId`, `visitorId: nullable`, `priceCharged`; `packages/domain/src/index.ts:209-219`). Тип дормантный: единственное упоминание вне определения — реэкспорт `frontend/admin/lib/types.ts:23-24,46-47`, который не трогается.
- **D5** — `BookingStep`/`BookingStepSchema` остаются: шаги 1–4 процесса бронирования (юзер: «в контексте процесса записи и это верно»). Заголовок секции `packages/domain/src/index.ts:207` «Booking Context Types» остаётся.
- **D6** — `visit*` не трогается (D6 = §2 п.4).
- **D7** — дата-имена `createRecord`/`RecordCreate`/`CreateRecordInput` остаются (юзер: «оставить»); правятся только комментарии, называющие сохранённые данные «bookings» (§4.3); комментарии процесса остаются (§4.4).
- **D8** — дельта domain-rules (§5) коммитится вместе со спекой; включает исправление устаревшего enum RecordStatus (юзер: «исправляй», «тем же коммитом»).
- **D9** — исторические документы (`docs/specs/`, `docs/plans/`, `CHANGELOG.md`) не переписываются — это история решений.
- **D10** — снапшот `modal-new-booking.png` переименовывается вместе со вкладкой; новый базлайн создаётся штатно и сверяется со старым (ожидается полное совпадение пикселей — меняется только имя файла).
- **D11** — вне скоупа: `frontend/web/**` (публичный процесс бронирования — там booking корректен по правилу), `backend/**`, API-контракты `/api/v1/**`, схемы/эндпоинты `packages/api-client` (кроме правок комментариев §4.3/4.4), `visit*`-кластер.

## 4. Инвентарь правок (код)

### 4.1 Фильтр /records

| Что | Было | Станет | Где |
|---|---|---|---|
| Файл | `app/(main)/records/components/BookingFilters.tsx` | `RecordsFilters.tsx` (git mv) | 219 строк |
| Компонент | `BookingFilters` | `RecordsFilters` | старый файл :37 |
| Интерфейс | `BookingFiltersProps` | `RecordsFiltersProps` | :14, :49 |
| testid-префикс | `booking-filters-status` | `records-filters-status` | :205 (`testIdPrefix`) |
| Runtime-потребитель | import + JSX | обновить | `records/page.tsx:5, :23` |
| Юнит-тест | `__tests__/BookingFilters.test.tsx` | `RecordsFilters.test.tsx` (git mv файла целиком) | импорт :34; использования :45,47,71,75,125,152,157,226,301; коммент :2 |
| e2e-селекторы | `booking-filters-status*` | `records-filters-status*` | `e2e/records.spec.ts` — 14 строк (96,112,142,143,148,170,171,204,205,239,572,573,728,729); `e2e/wave6-status-shared.spec.ts:27,28`; `e2e/visual-regression.spec.ts:65,68` |
| e2e-комменты (ссылки на имя) | «BookingFilters» | «RecordsFilters» | `e2e/records-view.spec.ts:35,193`; `e2e/wave6-status-shared.spec.ts:9,12`; `e2e/fixtures/helpers.ts:348` |
| Комменты в компонентах | «modeled on BookingFilters» | «modeled on RecordsFilters» | `app/(main)/photos/components/PhotosFilters.tsx:12,186` |

### 4.2 Вкладка модалки занятия

| Что | Было | Станет | Где |
|---|---|---|---|
| Файл | `ActivityDetailsModal/NewBookingTab.tsx` | `NewRecordTab.tsx` (git mv) | 274 строки |
| Компонент / props | `NewBookingTab`, `NewBookingTabProps` | `NewRecordTab`, `NewRecordTabProps` | :29, :22, :25 |
| Тип-алиас | `NewBookingSubmitData` (= `CreateRecordInput`) | `NewRecordSubmitData` (алиас остаётся на `CreateRecordInput` — D7) | :20 |
| Экспорт | `NewBookingTab` | `NewRecordTab` | `ActivityDetailsModal/index.ts:5` |
| Импорт + рендер | | обновить | `ActivityDetailsModal.tsx:12, :254` |
| Tab id | `'new-booking'` | `'new-record'` | `ActivityDetailsModal.tsx:131, :221, :252` |
| Хендлер | `handleNewBookingSubmit` + коммент «New booking submit handler» | `handleNewRecordSubmit` | `ActivityDetailsModal.tsx` (~:221-230, :252-257) |
| testid | `new-booking-tab` | `new-record-tab` | `NewBookingTab.tsx:134` |
| HTML id полей | `booking-name` / `booking-seats` / `booking-channel` | `record-name` / `record-seats` / `record-channel` (e2e их не используют — проверено grep по e2e/) | `NewBookingTab.tsx:147,151,164,168,232,236` |
| vitest | import :10; describes «NewBookingTab…» :413, :979, :1034, :1160; section-комменты :411, :977, :1029; все `render(<NewBookingTab …>)` — 17 (:422,427,432,437,442,988,994,999,1005,1010,1022,1054,1117,1138,1179,1196,1208) | `NewRecordTab` | `__tests__/ActivityDetailsModal.test.tsx` |
| e2e-селекторы | `new-booking-tab` | `new-record-tab` | `e2e/activity-details-modal.spec.ts:61, :425`; `e2e/error-messages.spec.ts:91`; `e2e/fixtures/helpers.ts:300` |
| Заголовок e2e-теста | «activity modal — new booking tab» | «activity modal — new record tab» (иначе проваливает grep-критерий §8) | `e2e/visual-regression.spec.ts:118` |
| Коммент в helpers | «Tariffs (used by SettingsTab, NewBookingTab, ClientTab)» | «…NewRecordTab…» | `__tests__/helpers/mockData.ts:172` |
| Снапшот | `modal-new-booking.png` | `modal-new-record.png` + новый базлайн (D10) | `e2e/visual-regression.spec.ts:118, :127` |
| Базлайн-файлы | `e2e/visual-regression.spec.ts-snapshots/modal-new-booking-chromium-linux.png` + `modal-new-booking-shard-rest-linux.png` (оба в git) | `git rm` старых; регенерация новых для обоих проектов (chromium + shard-rest) | `visual-regression.spec.ts-snapshots/` |
| Derived testid вкладки | `tab-new-booking` (шаблон `tab-<id>` в `TabNav.tsx:32`) | следует за tab id автоматически; потребителей нет (проверено) | — |

### 4.3 Комментарии — изменить (сохранённые данные названы «bookings»)

- `__tests__/ActivityDetailsModal.test.tsx:175` — «Serve the activity's booking records» → «…the activity's records».
- `ActivityDetailsModal.tsx:149` — «activity bookings need…» → «activity records need…».
- `e2e/fixtures/server-push.ts:260` — «The booking lands on…» → «The record lands on…» (речь о созданной записи, прилетевшей по SSE).

### 4.4 Комментарии — оставить (процесс, легально по правилу)

- `hooks/useRecordMutations.ts:47,56` — «booking submit payload» (сабмит формы бронирования).
- `__tests__/ActivityDetailsModal.test.tsx:499,517,673` — шаги бронирования.
- `packages/api-client/src/schemas.ts:449` — «booking auto-create» (акт автосоздания).
- `packages/api-client/src/endpoints.test.ts:1006` — extraction pattern на сабмите брони.
- e2e-комменты: `clients.spec.ts:827`, `client-phone-typeahead.spec.ts:341`, `error-messages.spec.ts:90`, `fixtures/helpers.ts:139,266`, `server-push.ts:259`.

## 5. Дельта domain-rules (коммитится вместе со спекой — D1, D8)

1. `docs/domain-rules/records.md:4` — «A Record is a booking for an Activity.» → «A Record is data that comes from the booking flow. It links a Client to an Activity and contains Visits.» (формулировка юзера).
2. `docs/domain-rules/visits.md:4` — «…within a Record (booking).» → «…within a Record.» (скобку «(booking)» убрать).
3. `docs/domain-rules/_overview.md:16` (таблица сущностей) — `| Record | Booking | belongs to Activity, Client; has Visits | **High** |` → `| Record | Данные — результат бронирования | belongs to Activity, Client; has Visits | **High** |`.
4. `docs/domain-rules/_overview.md` (Shared Enums → RecordStatus, ~:20-28) — заменить таблицу устаревшего enum `pending/confirmed/cancelled/no_show` (противоречит `records.md:11,75-96` и `business-logic.md:19-37`) абзацем: статус записи вычисляется из статусов визитов через `computeRecordStatus` (`packages/domain/src/visit_status.ts:17`), не хранится и не редактируется; статусы визитов — `waiting/visited/missed/cancelled`. Границы правки: термин «RecordStatus» как имя производного статуса в `business-logic.md:24,35-38` ОСТАЁТСЯ (корректное употребление); легаси-КОД не трогается — backend `models/enums.py:11` и `packages/domain/src/index.ts:90` (`RecordStatusSchema`) вне скоупа этой задачи: спека #134 (Ready to IMPL) явно держит RecordStatus вне своего скоупа, правки кода статусов — её территория.
5. `docs/domain-rules/_overview.md` (таблица именований, строка «Запись», ~:60) — Notes «Бронирование клиентом» → «Данные — результат бронирования клиентом»; добавить строку процесса: `| Бронирование (процесс) | Booking (flow / форма / шаги) | — | booking = процесс бронирования клиентом; данные-результат = Record |`.
6. `docs/business-logic.md:6` — «## 1. Visit and Booking Statuses» → «## 1. Visit and Record Statuses».
7. `docs/business-logic.md:49` — ОСТАЁТСЯ без правок: «Booking (Booking Flow — Philosophy)» — именование процесса, легально.

## 6. User Scenarios

| # | Сценарий (поведение юзера) | E2E-якорь |
|---|---|---|
| S1 | Админ на /records фильтрует записи по статусу — фильтр работает как раньше | `e2e/records.spec.ts` (testid `records-filters-status`), `e2e/wave6-status-shared.spec.ts:27,28` |
| S2 | Админ открывает модалку занятия (quickAdd) и создаёт запись через вкладку формы записи | `e2e/activity-details-modal.spec.ts:61, :425` (testid `new-record-tab`) |
| S3 | При некорректном сабмите формы записи ошибка показывается у вкладки | `e2e/error-messages.spec.ts:91` |
| S4 | Внешний вид /records и модалки не изменился | `e2e/visual-regression.spec.ts:65,68` (records-фильтры) и `:118,127` (новый базлайн `modal-new-record.png`) |

## 7. Риски и координация

- **Visual baseline (D10)**: первый прогон после переименования снапшота требует штатного пересоздания базлайна; старый и новый файл сверяются (ожидается полное совпадение пикселей).
- **Координация с #257** (Ready to IMPL, конвейер на паузе): план #257 трогает /records (empty state) — вероятен конфликт в `records/page.tsx` и `e2e/records.spec.ts`. Решение юзера (G1b, 16.09): в теле issue #103 объявлено `depends-on: #257` — конвейер не возьмёт #103 раньше мержа #257.
- **#134** (Ready to IMPL): прямых пересечений нет — её спека меняет `RecordStatusFilter` и enum'ы backend, но не `docs/domain-rules/_overview.md`; легаси-код `RecordStatus` остаётся и там, и у нас.
- **Rebase**: директория records/ активно менялась 13–14.09 (`9990481`, `bf6877f`) — работать поверх свежего origin/main.

## 8. Критерий завершённости

1. `grep -rni "booking" frontend/admin packages/domain packages/api-client docs/domain-rules docs/business-logic.md` — остаются ТОЛЬКО:
   - код: процессные вхождения §4.4; типы `BookingVisitor`/`BookingStep` и заголовок секции «Booking Context Types» (D4/D5);
   - живые доки (процессные употребления, легальны — проверено): `activities.md:35`, `auth.md:26`, `clients.md:29`, `clients.md:104`, `records.md:40`, `records.md:74`, `records.md:113`, `records.md:245` (подстрока «overbooking»), `business-logic.md:49`;
   - ни одного вхождения «booking» в значении сохранённых данных. Отдельно: `docs/design-system.md:323` («Bookings (/bookings)» в устаревшем скетч-блоке навигации 2026-05-17) — вынесено решением юзера (G1b, 16.09) в отдельное issue **#287** (обновление design-system.md целиком — устаревших блоков много; `app:admin`, Backlog) — вне grep-скоупа критерия.
2. Затронутые e2e-файлы сценариев S1–S4 зелёные; vitest затронутых файлов зелёный; tsc и lint чисты.
3. Не затронуты: `frontend/web/**`, `backend/**`, пути `/api/v1/**`.
