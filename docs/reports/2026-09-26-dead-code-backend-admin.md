# Аудит мёртвого кода — backend и админ-фронт

Дата: 2026-09-26. Скоуп: `backend/src` (FastAPI) и `frontend/admin` (Next.js, app router). Всё остальное (`frontend/web`, `packages/api-client`, `packages/domain`, alembic, скрипты, тесты) — вне скоупа, но использовалось как справочник: символ, на который есть ссылка где угодно в репозитории, мёртвым не считается.

## Метод и его ограничения

Механический проход: все объявления Python сняты через AST (1020 объявлений), TS/TSX — регэкспами по экспортам (2798 объявлений в проде); каждое имя искалось по всему репозиторию (1011 файл кода, без lock-файлов и node_modules). Эндпоинты (120 маршрутов на 20 роутерах) сопоставлялись с путями-литералами фронтенда с нормализацией плейсхолдеров (`{id}` ↔ `${id}` ↔ `[id]`). Каждый кандидат из разделов «мёртвый код» и «живо только через тесты» затем проверен вручную точечным поиском по слову (`rg -w`) с чтением контекста.

Ограничения: строковая динамика (`getattr` по имени, конвенции фреймворков) покрыта тем, что поиск идёт по сырому тексту — любое упоминание имени считает символ живым; поэтому метод скорее преуменьшает список мёртвого, чем преувеличивает. Все находки ниже прошли ручную верификацию; раздел «приложение» (неиспользуемые экспорты) — механический и не верифицировался построчно.

## Сводка

| Зона | Мёртвый код (высокая уверенность) | Живо только через тесты | Мелочь (неиспользуемые экспорты, тест-хелперы) |
|---|---|---|---|
| Backend | 1 (`TariffUpdate`) | 2 (модуль `cli.py`, один эндпоинт) | — |
| Админ-фронт | 6 файлов | 12 (5 компонентов, 5 хуков, 2 функции) | 2 типа, 1 константа, 8 тест-хелперов, 79 экспортов (приложение) |

---

## Backend

### Мёртвый код

1. **`TariffUpdate`** — `backend/src/schemas/service.py`, класс-пустышка (`class TariffUpdate(TariffBase): pass`). Ни одной ссылки во всём репозитории: не импортируется ни сервисами, ни роутами, ни тестами, ни сидом, ни миграциями (поиск по сырому тексту, включая строки). Обновление тарифов идёт через родительскую схему услуги, минуя эту. Уверенность: высокая. Рекомендация: удалить; если хочется сохранить симметрию пар `Create/Update` на будущее — осознанно оставить, но сейчас это единственный «висящий» класс семейства.

### Живо только через тесты

2. **`backend/src/cli.py` целиком** — консольный инструмент создания пользователя (`main`, `build_parser`, `prompt_password`). Точки входа нет: в `pyproject` нет секции `[project.scripts]`, ни `README`, ни `docs/`, ни скрипты репозитория его не вызывают; единственный потребитель — тесты (`test_cli.py`, `usecases/test_user_create.py`). Уверенность в «нет прод-использования»: высокая. Рекомендация: решение за владельцем продукта — (а) удалить вместе с тестами, если пользователи создаются через sqladmin; (б) оставить и задокументировать как ручной инструмент; (в) подключить как console script.

3. **Эндпоинт `DELETE /api/v1/user-settings/{settings_id}`** — `backend/src/api/v1/user_settings.py`. Пользовательские настройки — синглтон на пользователя, UI удаления у админки нет; эндпоинт зовут только тесты. Уверенность: средняя-высокая. Рекомендация: удалить за ненадобностью или оставить ради полноты REST-набора — продуктового потребителя у него нет.

### Проверено и признано живым (отклонённые кандидаты)

- `GET /api/v1/health` — фронтендом не вызывается, но это типовой ops-эндпоинт (docker/compose-файлов в репозитории нет, инфраструктура внешняя). Оставить.
- 97 функций-обработчиков в `api/v1/*`, `auth/router.py`, `events/router.py`, у которых имя встречается только на определении — живы через декораторы FastAPI; все 20 роутеров включены в приложение (`main.py`), «заброшенных» роутер-файлов нет.
- Валидаторы `_resolve_secret_key`, `parse_cors_origins` (`core/config.py`), `_names_reject_explicit_null` (`schemas/my.py`), `_check_date_range` (`schemas/record.py`) — живы через `@model_validator`/`@field_validator`.
- Все модули импортируются: `util/file_type.py` (сервис файлов), `services/decorators.py` (5+ сервисов), `db/migrate.py` (`main.py`, `database.py`, `recreate_dev_db.sh`), `seed` (точка входа в `recreate_dev_db.sh`), `repositories/search.py` (6 сервисов).
- Сотни приватных хелперов с подчёркиванием (`_count_*`/`_items_*`/`_ids_*`/`_h_*` в `domain/deletion.py`, `_seed_*` в `seed/seed.py` и т.д.) — используются внутри своих файлов; механический проход их помечал как кандидатов только потому, что имя не выходит за файл. Это не мёртвый код.

---

## Админ-фронт (`frontend/admin`)

### Мёртвые файлы (высокая уверенность, рекомендация — удалить)

1. **`contexts/MastersContext.tsx`** — контекст постраничного списка мастеров поверх `createPagedListContext`. Экспортирует ровно два имени (`MastersProvider`, `useMastersTable`), и ни одно не используется нигде — ни в проде, ни в тестах. Показательный момент: в `StaffContext.tsx` и `StaffTable.tsx` имя файла встречается **только в комментариях** («MastersContext stays alive as the read-only /masters consumer (schedule…)») — а расписание реально берёт мастеров из `hooks/useMasters.ts` (lookup-хук), что подтверждает и комментарий самого файла. Файл держится «за живой» чужими комментариями. Коммит-сообщение при удалении стоит написать так, чтобы развеять эти комментарии.

2. **`app/components/shared/DateTimePicker.tsx`** — компонент выбора даты-времени, ноль ссылок во всём репозитории (в проде, тестах, e2e, вебе, пакетах).

3. **`app/components/shared/FilterDropdown.tsx`** — компонент фильтра-дропдауна, ноль ссылок.

4. **`app/components/shared/record/blocks/RecordMetrics.tsx`** — блок метрик записи. Вкладка записи собирается из блоков `RecordVisitsTable`, `RecordPaymentsTable`, `RecordComments`, `RecordTimestamps` (+ `RecordSummary` и др.) — `RecordMetrics` из сборки не используется.

5. **`app/(main)/staff/components/staffFields.tsx`** — конфиг полей карточки сотрудника (`STAFF_FIELDS`, `StaffFieldConfig`), ноль ссылок; страница сотрудников формирует поля без него.

6. **`lib/types.ts`** — re-export-прослойка «на время миграции» на `@memo/domain` (комментарий в файле честно называет её backward compatibility). Ни один импорт из `lib/types` в репозитории не остался — миграция давным-давно съехала, прослойку можно снимать.

### Живо только через тесты (решение: удалить вместе с тестами или вернуть в UI)

7. **Пять компонентов прежней сборки карточки записи**: `AddVisitorForm` (`shared/visitors`), `PaymentList`, `PaymentTotals`, `PaymentForm` (`shared/payments`), `RecordVisitRow` (`shared/records`). Прод-вкладка записи (`ClientRecordTab.tsx`) импортирует из этих каталогов только `RecordHeader` и блоки `*Table`/`*Comments`/`*Timestamps`; эти пять в проде не участвуют — их держат юнит-тесты `ClientRecordTab.*.test.tsx`, которые рендерят их напрямую, плюс их собственные тесты. Похоже на предыдущее поколение карточки записи, вытесненное блоками, — тесты при этом продолжают тестировать вытесненное. Уверенность: высокая (проверено и по импортам, и по слову).

8. **Пять хуков правки**: `usePatchClient`, `usePatchStaff`, `usePatchService`, `usePatchMaterial`, `usePatchLocation` (в файлах `hooks/use*Mutations.ts`). Прод-экраны правку делают другими экспортами этих же файлов; `usePatch*` вызывают только юнит-тесты (`use*Mutations.test.ts`) и интеграционные тесты таблиц. Паттерн тот же: тесты держат код, который прод не использует.

9. **Две функции `lib/datetime.ts`**: `dateToLocalISO`, `weekDayIndex` — внутри файла не используются, потребители только в `__tests__/datetime.test.ts`.

Рекомендация по группе 7–9: удалять парой «код + его тесты» одним изменением; если что-то из этого планировалось вернуть в UI — сначала вернуть в UI, потом снимать пометку. Отдельно стоит пересобрать тесты `ClientRecordTab.*`, чтобы они тестировали прод-сборку вкладки, а не вытесненные компоненты.

### Мелочь (низкий приоритет)

10. `ViewModeType`, `ColumnModeType` — экспортированные алиасы типов в `contexts/schedule/ScheduleViewContext.tsx`, ноль ссылок даже в самом файле. Удалить строки.
11. `CELL_HEIGHT_MIN` — константа в `lib/utils.ts`, ноль ссылок. Удалить.
12. **Тест-хелперы без потребителей**: `__currentPathname`, `useParams` (мок next/navigation в `__tests__/helpers/nextNavigationMock.ts`), `createMockServiceResponse`, `createMockMasterResponse` (`__tests__/helpers/mockData.ts`), `openActivityByTitle`, `getOccupied`, `getRecordStatus` (`e2e/fixtures/scenarios.ts`), `linkPhotoTag` (`e2e/fixtures/factories.ts`). Мёртвый код внутри тестовой инфраструктуры — чистить по настроению, продукту не мешает.
13. **79 неиспользуемых экспортов** — по большей части Props-типы компонентов, которые используются внутри своего файла (сигнатура компонента), но помечены `export` без внешних потребителей. Это не мёртвый код, а шум в публичной поверхности модулей; полный список — в приложении. Лечится снятием `export` по мере касания файлов; отдельная чистка оправдана только если хочется строгого режима линтера.

### Проверено и признано живым (отклонённые кандидаты)

- `tailwind.config.ts` — механика поиска его не видит, но Tailwind v3.4 подхватывает конфиг из корня проекта автоматически (подтверждено: `tailwindcss: {}` в `postcss.config.mjs`). Жив.
- `contexts/MastersContext.tsx` дважды менял вердикт в ходе проверки: сначала «жив» (имя встречается в других файлах), потом выяснилось, что это комментарии; в финальном списке мёртвых файлов (см. выше).
- Все страницы/лейауты `app/**` — точки входа Next.js по конвенции, вне проверки.
- Компоненты, типы и хуки, помеченные механикой как «используются только внутри своего файла» с реальным использованием в файле (сигнатуры, JSX, декораторы) — живы.

---

## Приложение

Полный механический список неиспользуемых экспортов (пункт 13) — см. генерируемую таблицу ниже.

## Итог

Продуктово опасного мёртвого кода нет: ничего из найденного не выполняется в проде и не влияет на поведение. Всё найденное — это (а) один лишний класс схемы, (б) модуль и эндпоинт без точек входа, (в) прослойка и пять файлов, вытесненных развитием UI, (г) заметный пласт «тестового балласта» — компоненты и хуки, которые прод уже не использует, а тесты продолжают обслуживать. Последняя группа — главный кандидат на решение: она маскирует реальное покрытие тестами.

### Приложение: неиспользуемые экспорты админ-фронта (механический список, не верифицировался построчно)

Всего: 79 экспортов в 64 файлах. Символ используется (если используется) только внутри своего файла; внешних ссылок нет.

- `app/(main)/clients/components/ClientDeepLinkChip.tsx` — `ClientDeepLinkChipProps`
- `app/(main)/locations/components/LocationModal.tsx` — `LocationModalProps`
- `app/(main)/photos/components/PhotoModal.tsx` — `PhotoModalProps`
- `app/(main)/photos/components/photoColumns.tsx` — `PhotoColumnLookup`
- `app/(main)/positions/components/PositionModal.tsx` — `PositionModalProps`
- `app/(main)/services/components/MaterialModal.tsx` — `MaterialModalProps`
- `app/(main)/services/components/serviceFields.tsx` — `SelectFieldOption`
- `app/(main)/staff/components/ArchiveStaffDialog.tsx` — `ArchiveStaffDialogProps`
- `app/(main)/staff/components/StaffModal.tsx` — `StaffModalProps`
- `app/(main)/tags/components/TagModal.tsx` — `TagModalProps`
- `app/components/DeleteDialog.tsx` — `DeleteDialogEntityType`, `DeleteDialogProps`
- `app/components/error/ErrorBoundary.tsx` — `ErrorBoundaryProps`
- `app/components/error/ErrorState.tsx` — `ErrorStateProps`, `ErrorStateVariant`
- `app/components/error/FullPageError.tsx` — `FullPageErrorProps`
- `app/components/modal/MyDataModal.tsx` — `MyDataModalProps`
- `app/components/modal/PasswordModal.tsx` — `PasswordModalProps`
- `app/components/modal/myDataFields.ts` — `MyDataFieldType`
- `app/components/shared/ArchiveBadge.tsx` — `ArchiveBadgeProps`
- `app/components/shared/Combobox.tsx` — `ComboboxProps`
- `app/components/shared/DateTimePicker.tsx` — `DateTimePickerProps`
- `app/components/shared/MultiSelect.tsx` — `MultiSelectProps`
- `app/components/shared/PhoneInput.tsx` — `PhoneInputProps`, `getNationalDigits`
- `app/components/shared/RemoteSearchSelect.tsx` — `RemoteSearchSelectProps`
- `app/components/shared/StatusBadge.tsx` — `StatusBadgeProps`
- `app/components/shared/StatusFiltersPicker.tsx` — `StatusFiltersPickerProps`
- `app/components/shared/StatusPicker.tsx` — `StatusPickerProps`
- `app/components/shared/TimePicker.tsx` — `TimePickerProps`
- `app/components/shared/config/VISIT_STATUS_CONFIG.ts` — `VisitStatusMeta`
- `app/components/shared/icons/StatusIcons.tsx` — `IconForStatus`
- `app/components/shared/modal/Modal.tsx` — `ModalProps`
- `app/components/shared/payments/PaymentForm.tsx` — `PaymentFormProps`, `PaymentFormValues`
- `app/components/shared/payments/PaymentList.tsx` — `PaymentListProps`
- `app/components/shared/payments/PaymentTotals.tsx` — `PaymentTotalsProps`
- `app/components/shared/record/InlineEditCell.tsx` — `InlineEditCellProps`
- `app/components/shared/record/blocks/ClientStatistics.tsx` — `ClientStatisticsProps`, `ClientStatisticsStats`
- `app/components/shared/record/blocks/RecordComments.tsx` — `RecordCommentsProps`
- `app/components/shared/record/blocks/RecordPaymentsTable.tsx` — `PaymentRow`, `RecordPaymentsTableProps`
- `app/components/shared/record/blocks/RecordSummary.tsx` — `RecordSummaryProps`
- `app/components/shared/record/blocks/RecordTimestamps.tsx` — `RecordTimestampsProps`
- `app/components/shared/record/blocks/RecordVisitsTable.tsx` — `RecordVisitsTableProps`, `VisitRow`
- `app/components/shared/record/useInlineEditRow.ts` — `UseInlineEditRowOptions`, `UseInlineEditRowResult`
- `app/components/shared/records/RecordHeader.tsx` — `RecordHeaderProps`
- `app/components/shared/records/RecordVisitRow.tsx` — `RecordVisitRowProps`
- `app/components/shared/records/types.ts` — `ClientInfo`, `RecordWithoutStatus`
- `app/components/shared/visitors/AddVisitorForm.tsx` — `AddVisitorFormProps`, `AddVisitorPayload`
- `app/components/shared/visitors/VisitorRow.tsx` — `VisitorRowProps`
- `app/lib/api/parseApiError.ts` — `ParsedApiError`
- `contexts/PendingActionsContext.tsx` — `PendingActionKind`
- `contexts/PhotosContext.tsx` — `PhotoFilters`, `PhotoSortField`
- `contexts/RecordsContext.tsx` — `RecordFilters`
- `contexts/ServicesContext.tsx` — `ServiceListFilters`, `defaultServiceFilters`
- `contexts/UIContext.tsx` — `ToastAction`
- `contexts/createPagedListContext.tsx` — `PagedListConfig`, `WithFiltersConfig`
- `contexts/schedule/ScheduleDataContext.tsx` — `DeleteActivityOutcome`, `PendingActivityConfirm`
- `hooks/useMyProfile.ts` — `ME_KEY`
- `hooks/useRecordMutations.ts` — `RecordPatchData`
- `hooks/useRecordsPeriod.ts` — `RecordsPeriod`
- `lib/cache/activityCacheSync.ts` — `ActivitySnapshot`
- `lib/cache/recordCacheSync.ts` — `PaymentUpsertPosition`, `UpsertPosition`
- `lib/cache/rowSnapshotSync.ts` — `RowSnapshotSync`
- `lib/client-id-param.ts` — `CLIENT_ID_PARAM`
- `lib/datetime.ts` — `ParsedLocalISO`
- `lib/tariff-resolver.ts` — `SelectedAge`
- `lib/utils.ts` — `ActivityLike`

## Обновление 27.09 — решения и применение

Решения владельца: `TariffUpdate` оставить (endpoint на тарифы ещё не заведён, схема пригодится); cli.py и `DELETE /api/v1/user-settings/{id}` — без решения, не тронуты. Всё перечисленное для админ-фронта удалено в режиме fast-track (ветка `chore/admin-dead-code`): 6 мёртвых файлов, 5 компонентов прежней сборки, 5 хуков `usePatch*`, функции `dateToLocalISO`/`weekDayIndex`, алиасы типов, константа `CELL_HEIGHT_MIN`, 8 тест-хелперов — плюс их тесты (5 тест-файлов целиком, блоки `usePatch*` в пяти файлах мутаций, два блока в datetime-тестах). Комментарии в `StaffContext`/`StaffTable` переведены с MastersContext на `hooks/useMasters`.

Верификация: tsc и eslint чистые; vitest 2183 зелёных, 308 падений — идентичный набор 18 файлов на чистом main (локальная проблема окружения: jsdom `localStorage.clear is not a function`, таймзонный тест) — правки тест-нейтральны. Побочный эффект чистки: round-trip-покрытие `parseLocalISO` через удалённый describe с `dateToLocalISO` сузилось (у `parseLocalISO` остались собственные тесты).
