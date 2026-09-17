# Спека: обновление docs/design-system.md (#287)

```
gate: G1b
issue: #287
status: draft rev4 (панель: 6/6 PASSED_WITH_CONCERNS, файндинги вписаны;
User Scenarios по канону §3 design-phase — docs-only адаптация, механические
проверки вместо E2E; plan-reviewer 1-й прогон NEEDS_REVISION → блокер скрипта
и дополнения вписаны в план rev2, ре-ревью запущен)
approach: переписать с нуля, сохранив структуру секций (решение юзера 2026-09-16)
```

## 0. Контекст и цель

`docs/design-system.md` (577 строк) — living-reference для UI-задач (Required Doc
по design-phase, §«Required Docs»: domain-rules для сущностей, design-system для UI).
Не выверялся с 2026-05-17 (frontmatter `updated:`), последний содержательный коммит
`ac18de3` 2026-06-21. За это время код ушёл: дедуп VisitStatus (#134), реструктуризация
layout (Menubar вместо Sidebar, #262), staff/positions (#266), DataTable-эпоха (#139).

Подтверждённый дрейф (скаут 2026-09-16, file:line):

- Компонент описан как «Sidebar» — в коде `frontend/admin/app/components/layout/Menubar.tsx`
  (рендерится из `(main)/layout.tsx:56`); в доке 5 пунктов навигации, в коде 3
  (`NAV_ITEMS` Menubar.tsx:135-139) + 2 сворачиваемые секции «Мастера»/«Справочники»
  (554-628) + «Фото» (630-649).
- Мёртвые сущности в доке: `Bookings (/bookings)` (маршрут `/records`), `Artists`,
  `Chat (/chat)`, `<ArtistLegend />` (в коде MasterLegend, Menubar.tsx:406/413,
  комментарий :654 «removed, duplicates Masters submenu»), `CustomSelect` (файла нет),
  `StatusPicker` по пути `modal/ActivityDetailsModal/` (в модалке его нет).
- Forbidden-синонимы по всему документу: «artist» в ~12 вхождениях с учётом
  регистра (Artist Colors :93, ARTIST_COLORS :96, ArtistLegend :306/310, Artists
  :325 и т.д.; case-sensitive grep нижним регистром даёт 6) — в коде токен уже
  `master` (tailwind.config.ts:47).
- Источник правды указан ворктри-путём: строка 14 `.worktrees/feat-admin-schedule/frontend/`.
- Секция Components не знает о `DataTable`, `ColumnPicker`, `Combobox`, `MultiSelect`,
  `DateTimePicker`, `FilterDropdown`, `StatusFiltersPicker`, `CalendarPopover`,
  `ArchiveBadge`, `MasterPicker`, `PhoneInput`, `TimePicker` (все в
  `frontend/admin/app/components/shared/`), ни о `Topbar`, `UserMenu`, `MyDataModal`,
  `StampPanel`, `Modal`, `FullPageError`, `DeleteDialog`.
- Page Layout Shell (509-531) врёт о провайдерах и глобальности Toolbar: Toolbar
  НЕ глобальный, рендерится внутри schedule-page (`(main)/schedule/page.tsx:23`),
  провайдерская обвязка в `app/layout.tsx` иная.

Цель: документ снова описывает фактический UI и пригоден как Required Doc для
UI-задач design-фазы.

## 1. Решение: переписать с нуля, сохранив структуру секций (юзер, 2026-09-16)

Полная перезапись файла. Скелет секций сохраняем прежним — он хороший:

Colors (Theme Variables / Tailwind tokens / Master Colors / Status Colors /
Status Icons / Status Components) → Typography → Shadows → Spacing & Sizing →
Border Radius → Scrollbar → Transitions → Animations → Components (Sidebar,
Toolbar, Right Panel, Activity Card, Toast, StampFab, Select / Filter Input,
Page Layout Shell) → Patterns (6 паттернов).

Почему переписывание, а не правки: по скауту врёт примерно половина содержимого
(Sidebar/Components/Page Shell целиком, ~12 «artist», мёртвые ссылки), правки
выродились бы в ту же сплошную сверку каждой строки с кодом, но с риском пронести
старый мусор. Regenerated from live code внутри той же структуры чистее.

## 2. Источник правды и метод верификации

- Единственный источник правды: живой код `frontend/admin/`. Ворктри-путь и
  `sketches/colour-mountains-v4.html` из frontmatter/source убираются; скетч
  допускается одной исторической строкой в интро.
- Каждое значение (цвет, размер, класс, file:line) при перезаписи берётся из кода
  этого коммита, не из старого документа: документ является OUTPUT аудита,
  старый текст может использоваться только как черновик для перепроверки.
- Каждый цитируемый file:line должен существовать на момент PR (grep-критерий в DoD).
- Если секция сверяется и оказывается точной — перепечатывается как есть
  (переписывание ≠ переизобретание; значения уже в большинстве верны).

## 3. Требования по секциям

### 3.1 Frontmatter

- `type: design-system`, `scope: project` сохраняются; `sections:` пересчитать по
  фактическому оглавлению (в старом доке он уже врёт: перечисляет `icons`, а
  H2 `## Icons` в файле нет); `updated: 2026-09-16` (дата завершения работы, юзер);
  `source:` = `frontend/admin (live code)`.
- В интро добавить maintenance-пометку для living-дока: одна строка вида
  «при изменении UI обновлять соответствующие секции и `updated:`» — чтобы
  дрейф следующего раза ловился сразу.

### 3.2 Colors

- Tailwind-токены: перечислить актуальные из `tailwind.config.ts` (30-75), включая
  переименованный `master` (47-54) и ЛЕГАСИ-блок `status: {confirmed, cancelled,
  noShow}` с пометкой legacy (как в старом доке, строка 89).
- `### Artist Colors` → `### Master Colors`: константы `ARTIST_COLORS`/`MASTER_COLORS`
  В КОДЕ НЕ СУЩЕСТВУЕТ (проверено grep 2026-09-16) — цвета мастеров data-driven
  из поля `staff.master.color` (ввод в `StaffModal.tsx:68`, цвет-picker placeholder
  `#5B8C7A`; потребители: ActivityCard, DayColumn, FilterDropdown). Секция
  документирует: tailwind-токен `master.*` (47-54) + data-поле `master.color`
  + file:line, БЕЗ константы и БЕЗ настоящих фамилий сотрудников (в старом доке
  строки 96-103 раскрывали ФИО — PII; в новом перечислять только ключи токенов
  и хексы).
- CSS-переменные `:root` / `[data-theme="dark"]` сверить с фактическим
  `frontend/admin/app/globals.css` — значения, не встречающиеся в коде, удалить.
  Правило конфликта: если переменная определена дважды (реальный кейс `--bg`:
  globals.css:9 `#EDEDEE` и :35 `#FFFFFF` в Grid-блоке того же `:root` — позднее
  определение выигрывает каскад), документировать ЭФФЕКТИВНОЕ значение и
  пометить дубль комментарием «defined twice in globals.css (:9, :35)» — правка
  кода вне скоупа. Переменные без потребителей вне globals.css (`--cell-h`,
  `--grid-line` и т.п.) помечать «defined, consumers: none found» вместо удаления
  молча. Z-токены (`globals.css:127-145`, guard `scripts/check_z_tokens.py`) —
  одна строка-указатель в секции Colors, без развёрнутой подсекции.
- Status Colors: таблица канонических цветов из
  `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts` (пост-#134 —
  конфиг переехал в shared/config; сверить лейблы/хексы/классы по файлу).
  Хексы палитры в доке НЕ править «по памяти» — только из конфига.

### 3.3 Status Icons / Status Components

- Инлайн-SVG конвенция: сверить экспорты с фактическим
  `frontend/admin/app/components/shared/icons/StatusIcons.tsx` (существует;
  список компонент и «why inline» переписать по факту).
- Таблица Status Display Components: `StatusBadge` / `StatusPicker` /
  `StatusFiltersPicker` по живым путям `shared/`; строка про `CustomSelect`
  и про «standalone StatusPicker в ActivityDetailsModal» удаляется, если файлы
  не существуют (скаут: не существуют — перепроверить при импл).

### 3.4 Typography / Shadows / Spacing / Radius / Scrollbar / Transitions / Animations

- Сверить каждую строку с кодом; строки, описывающие несуществующие элементы
  (например, легенда-лейблы, если MasterLegend удалён — Menubar.tsx:654),
  удалить; значения boxShadow/borderRadius сверить с `tailwind.config.ts`
  (card/button, 68-75).
- ⚠️-пометки «Difference from sketch» удалить: скетч больше не релевантен;
  документ = зеркало кода, а не диф против скетча. Политика меток явная:
  удаляются ТОЛЬКО «Difference from sketch»-пометки; легаси-метки
  (LEGACY-токены, «defined twice», «consumers: none») остаются текстом без
  символа ⚠️.

### 3.5 Components

- **Sidebar → Menubar**: переписать по `Menubar.tsx` (структура: logo PNG
  `/logo-white.png` :509-513, MiniCalendar, NAV_ITEMS 3 пункта :135-139,
  «Мастера» collapsible :554-589 (PaletteIcon, точки цветов, НЕ ссылка),
  «Справочники» collapsible :591-628 → DIRECTORY_ITEMS :141-152 (Сотрудники /
  Услуги / Локации / Теги / Должности), Фото :630-649, UserMenu :661 (тема-слайдер
  переехал сюда, #262 §5.1), collapse :665-679, version :683-687).
- **Toolbar**: указать, что он НЕ глобальный — рендерится условно внутри
  schedule-page (`(main)/schedule/page.tsx:23`); стили сверить по файлу.
- **Right Panel**: описать фактическое состояние (Toolbar/StampFab/Topbar ОПРЕДЕЛЯЮТСЯ
  в `components/layout/` — это место определения, а не рендера; рендер Toolbar —
  условно внутри schedule-page, `(main)/schedule/page.tsx:23`; в доке различать
  «где определён» и «где рендерится»); AccordionSection/StampPanel сверить по
  живому коду; аккордеон CopyLastWeek включается только если существует в коде
  на момент импл (стандартное правило аудита, применяется к любому спорному
  элементу).
- **Activity Card**: сверить с фактическим
  `frontend/admin/app/components/schedule/ActivityCard.tsx` (путь другой, не
  старый modal-путь). Правила сворачивания описывать по ДЕЙСТВУЮЩЕЙ tier-логике
  `isTiny/isCompact/isStandard` (пороги по длительности <60/<90 мин,
  `hasFooter=isStandard`, пороги заголовка want2Line 134/90 — ActivityCard.tsx:36-48);
  СТАРЫЕ пороги 90px/56px и showExtra/showOnlyPill из старого дока — не переносить.
  Footer-progress, time pill, private diamond, drag/delete-состояния — по факту
  кода; delete-mode CSS из старого дока (446-452) в коде больше нет — не переносить.
- **Toast**: сверить с фактическим `ToastContainer`
  (`frontend/admin/app/components/toast/ToastContainer.tsx` — НЕ под shared/;
  проверено find 2026-09-16; рендер из `app/providers.tsx`).
- **StampFab / Select / Page Layout Shell**: переписать по факту; Shell должен
  отражать реальные провайдеры `app/layout.tsx` и `(main)/layout.tsx:56`.
- **Новые подсекции (обязательные):** DataTable (`shared/DataTable.tsx` — канон
  таблиц после #139), Modal (`shared/modal/Modal.tsx`), FullPageError
  (`frontend/admin/app/components/error/FullPageError.tsx` — НЕ под shared/,
  проверено find 2026-09-16), DeleteDialog (`frontend/admin/app/components/
  DeleteDialog.tsx` — не под shared/) — каждая: 2-4 строки + file:line.
  MiniCalendar — сверить реальный путь и включить в Sidebar-секцию как есть в
  коде. Остальные отсутствующие shared-компоненты — списком одной строкой на
  компонент (имя, путь, роль), без развёрнутых секций (решение из G1a —
  рекомендация принята юзером «сам выбирай»: списком, мини-секции только
  для ключевых DataTable/Modal/FullPageError). Иконки-детали (`DiamondIcon.tsx`,
  `MonthYearPicker.tsx`, `RemoteSearchSelect.tsx`) и конфиг-файлы
  (`config/VISIT_STATUS_CONFIG.ts`) входят в список наравне с компонентами.
  Подкаталоги shared/ (`payments/`, `record/`, `records/`, `visitors/`) —
  их компоненты тоже входят в список (однострочные позиции: PaymentForm,
  PaymentList, PaymentTotals, RecordTable, InlineEditCell/Row, RecordHeader,
  RecordVisitRow, AddVisitorForm, VisitorRow — сверить фактические имена по
  коду при импл): это каноническая поверхность Record/Visitor.
- Реальные имена файлов цитируются как есть (`BookingFilters.tsx`,
  `NewBookingTab.tsx`); канонические термины в прозе — по naming-таблице.
  Переименование файлов = #103, вне скоупа.

### 3.6 Patterns

- Существующие 6 паттернов сверить с кодом и поправить; НОВЫЕ паттерны не
  изобретать (решение G1a, юзер делегировал).
- Паттерн «Active Nav Item» привести к Menubar-реальности (активная
  логика сверяется по коду :135-139/540+).

## 4. Языковые правила (канон имён)

- Таблица именования `docs/domain-rules/_overview.md:52-65` — источник правды:
  `Master` (не Artist), `Record` (не Booking — Booking = процесс, :57-58), `Visit`,
  `Staff`, `Position`, `Activity`, `Location`, `Service`, `Client`, `Visitor`.
- Проза и заголовки — только канонические термины; пути файлов — как в коде.
- Язык файла: английский — файл УЖЕ на английском (e97f0f5), сохраняем без
  перевода. Замечание: конвенция «все docs/ на английском» не соблюдена в репо
  (domain-rules/*.md русские) — факт репо, не аргумент; выбор английского для
  design-system.md — сохранение status quo файла, не новая конвенция.

## 5. User Scenarios (docs-only адаптация канона)

Сценарии консумеров дока (дизайн-агенты и IMPL-кодеры, читающие документ как
Required Doc). E2E-тесты к доку неприменимы (docs-only) — каждый сценарий
заякорен на механическую проверку из DoD §6, выполняемую в задаче T3 плана:

- **S1. Агент UI-задачи ищет структуру навигации** → находит фактический
  Menubar (3 пункта + сворачиваемые «Мастера»/«Справочники» + «Фото»),
  никаких Bookings/Artists/Chat. Проверка: grep `/bookings`, `/chat`,
  `ArtistLegend` = 0; все ссылки на Menubar.tsx существуют.
- **S2. Агент ищет источник цветов мастера** → находит токен `master.*` +
  data-поле `staff.master.color`; фантомной константы нет, ФИО нет.
  Проверка: grep `artist` = 0; grep ФИО из seed = 0; ссылка на
  StaffModal.tsx существует.
- **S3. Агент ищет цвета статусов** → каноническая таблица точно совпадает с
  `shared/config/VISIT_STATUS_CONFIG.ts`. Проверка: каждый хекс/класс из дока
  встречается в конфиге.
- **S4. Агент проверяет CSS-переменную перед использованием** → блок зеркалит
  globals.css, дубли помечены, переменные без потребителей помечены.
  Проверка: каждая переменная из дока есть в globals.css; `--bg` помечен.
- **S5. Агент ищет shared-компонент (DataTable, Modal, FullPageError, …)** →
  находит позицию списка с реальным путём. Проверка: полное покрытие
  `shared/*.tsx` + подкаталогов; каждый путь существует.

## 6. Definition of Done

1. `docs/design-system.md` переписан; структура секций (заголовки) сохранена;
   frontmatter `updated: 2026-09-16`.
2. Grep-критерии по итоговому файлу (все case-insensitive, `grep -ci`):
   `artist` = 0; `employee` = 0; `guest` = 0; `/bookings` = 0; `/chat` = 0;
   `CustomSelect` = 0; `ArtistLegend` = 0; `.worktrees` = 0; `sketches/` —
   максимум 1 упоминание в интро. ЯВНОЕ ИСКЛЮЧЕНИЕ: термины
   `booking`/`user`/`type` НЕ грепаются — они легитимно появляются внутри
   цитируемых имён файлов (`BookingFilters.tsx`, `NewBookingTab.tsx`,
   `UserMenu`, `tableTypes.ts`), каноничность в прозе обеспечивается §4,
   а не grep'ом.
3. КАЖДАЯ ссылка file:line проверяется механически, не выборочно: скрипт-одноходовка
   по регэкспу `[\w./()-]+\.(tsx|ts|css):[0-9]+(-[0-9]+)?` над итоговым файлом
   (файл существует И cited-строка в пределах файла; диапазоны `:N-M` — по
   стартовой строке); вывод скрипта прикладывается в описание PR.
   Скрипт в репо НЕ добавляется (docs-only diff). Паттерн по образцу
   `scripts/check_z_tokens.py`.
4. Каждый CSS-переменный/токен-блок в доке имеет живой источник (globals.css /
   tailwind.config.ts) — несуществующие переменные удалены; дубли помечены;
   переменные без потребителей помечены «consumers: none».
5. Секции DataTable / Modal / FullPageError присутствуют; список остальных
   shared-компонентов покрывает `frontend/admin/app/components/shared/*.tsx`
   верхнего уровня (сегодня 17 — достаточно «покрыть все»; константа «≥15»
   заменена на правило полного покрытия, чтобы критерий не гнил вместе с кодом).
6. UI/токены/компоненты кода не изменены (docs-only): diff PR не содержит
   файлов вне `docs/design-system.md`.
7. Имена сотрудников (ФИО) не встречаются в итоговом файле (grep по фамилиям
   из seed-данных — 0).

## 7. Вне скоупа

- Любые изменения кода/UI/токенов; переименование файлов (#103).
- Документирование незамердженных решений (#285/#286 deferred deletion,
  #284 тарифы по возрасту) — только состояние кода на момент PR.
- Мёртвый код в Menubar.tsx (`ChatIcon` :62-68, неиспользуемые ключи ICON_MAP
  :156-166) — это потенциальный будущий чор-ишью, в спеке фиксируется как
  замечание вне скоупа.
- Другие docs-файлы (domain-rules, CLAUDE-файлы).
