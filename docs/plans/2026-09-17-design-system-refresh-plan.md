# План: #287 «Обновление docs/design-system.md (переписать с нуля, та же структура)»

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/design-system.md` (577 строк, не выверялся с 2026-05-17) снова
описывает фактический UI и пригоден как Required Doc для UI-задач design-фазы:
полная перезапись при сохранении скелета секций, каждое значение выведено из
живого кода `frontend/admin`, forbidden-синонимы вычищены, ФИО сотрудников не
включаются. Docs-only: diff PR = один файл.

**Architecture:** Один файл-артефакт `docs/design-system.md`. Источник правды —
живой код (globals.css, tailwind.config.ts, VISIT_STATUS_CONFIG.ts, StatusIcons.tsx,
Menubar.tsx, layout-файлы, ActivityCard.tsx, ToastContainer.tsx, инвентарь
shared/). Старый текст — только черновик для перепроверки (правило §2 спеки).
Три задачи идут строго последовательно на одном файле (T1 → T2 → T3),
параллелить нельзя. Верификация механическая: grep-критерии + регэксп-скрипт
file:line (в репо не добавляется, вывод — в описание PR).

**Tech Stack:** markdown; верификация — grep/find/sed (one-off-команды, без
новых файлов в репо).

**Спека:** `docs/specs/2026-09-16-design-system-refresh-design.md` (rev4).

**Хард-гейта нет.** Docs-only, пересечений с соседними дорожками нет (#242
schedule, #285/#286 undo-пайплайн трогают код и легаси-файлы `BookingFilters.tsx`
— дока цитирует реальные имена файлов, не переименовывает их; это скоуп #103).
Если к старту IMPL смержился #103 (rename BookingFilters → RecordsFilters) —
цитировать актуальные имена файлов по состоянию main.

---

## Behavioral Delta

Docs-only: пользовательский UI не меняется вообще. Дельта — что документ
утверждает ПОСЛЕ перезаписи (маппинг на сценарии спеки §5):

- **Сценарий S1 (навигация):** секция Sidebar описывает фактический
  `Menubar.tsx` — logo PNG `/logo-white.png`, MiniCalendar, NAV_ITEMS 3 пункта
  (`/schedule`, `/records`, `/clients`), сворачиваемые «Мастера» (точки цветов,
  не ссылка) и «Справочники» (Сотрудники/Услуги/Локации/Теги/Должности),
  отдельная «Фото», UserMenu с theme-слайдером, collapse, version. Строк
  `Bookings (/bookings)`, `Artists`, `Chat (/chat)`, `<ArtistLegend />` нет.
- **Сценарий S2 (цвета мастера):** секция `### Master Colors` описывает
  tailwind-токен `master.*` (olga…irina, хексы) и data-поле `staff.master.color`
  (ввод в StaffModal.tsx, потребители ActivityCard/DayColumn/FilterDropdown);
  константы ARTIST_COLORS в доке нет, ФИО сотрудников нет — только ключи токенов.
- **Сценарий S3 (статусы):** таблица цветов/классов статусов построчно совпадает
  с `shared/config/VISIT_STATUS_CONFIG.ts`; таблица Status Display Components
  перечисляет StatusBadge / StatusPicker / StatusFiltersPicker по живым путям;
  строк про CustomSelect и standalone StatusPicker в ActivityDetailsModal нет.
- **Сценарий S4 (CSS-переменные):** блок Theme Variables зеркалит globals.css;
  дубль `--bg` (globals.css:9/:35) помечен «defined twice»; переменные без
  потребителей вне globals.css помечены «consumers: none»; z-токены
  (globals.css:127-145) — одна строка-указатель; переменных, отсутствующих в
  коде, нет.
- **Сценарий S5 (компоненты):** Components содержит подсекции
  DataTable/Modal/FullPageError (+ DeleteDialog, Toast по пути
  `components/toast/`) и список-по-строке на ВСЕ shared/*.tsx верхнего уровня
  и компоненты подкаталогов payments/record/records/visitors с реальными путями;
  Page Layout Shell отражает фактические провайдеры app/layout.tsx и
  (main)/layout.tsx; Toolbar помечен как рендерящийся условно внутри
  schedule-page (не глобальный); ActivityCard описывает tier-логику
  isTiny/isCompact/isStandard (пороги по длительности <60/<90, want2Line
  134/90), старые 90px/56px и showExtra/showOnlyPill отсутствуют.
- **Frontmatter:** `updated: 2026-09-16`, `source:` = `frontend/admin (live
  code)`, `sections:` = фактическому оглавлению (пункта `icons` нет), в интро —
  maintenance-строка «при изменении UI обновлять секции и updated:».
- **Без изменений:** файлы кода не тронуты; другие docs-файлы не тронуты;
  переименование BookingFilters.tsx — скоуп #103, дока только цитирует имена.

## Структура файлов

- `docs/design-system.md` — единственный изменяемый файл (полная перезапись).
- Новых файлов НЕ создавать (в т.ч. верификационный скрипт — one-off команда).

---

## Task 1: Перезапись основания — frontmatter, Colors, Typography, Shadows, Spacing, Radius, Scrollbar, Transitions, Animations

### Classification: standard

### Required Docs

- Спека: `docs/specs/2026-09-16-design-system-refresh-design.md` (§2, §3.1-3.4)
- `frontend/admin/app/globals.css` (CSS-переменные, z-токены 127-145)
- `frontend/admin/tailwind.config.ts` (токены цветов/shadow/borderRadius)
- `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts`
- `frontend/admin/app/components/shared/icons/StatusIcons.tsx`
- `docs/domain-rules/_overview.md:52-65` (naming-таблица)

### Steps

- [ ] Прочитать живые источники: globals.css (полностью), tailwind.config.ts
  (блоки colors/boxShadow/borderRadius), VISIT_STATUS_CONFIG.ts, StatusIcons.tsx.
- [ ] Переписать frontmatter: `type/scope` как было, `sections:` = фактическое
  оглавление (БЕЗ несуществующего `icons`), `updated: 2026-09-16`,
  `source: frontend/admin (live code)`; интро — одна историческая строка про
  скетч максимум + maintenance-строка.
- [ ] Переписать Colors: Theme Variables из globals.css (с правилом дубля
  `--bg`, метками «defined twice» / «consumers: none», строкой-указателем на
  z-токены); Tailwind tokens из tailwind.config.ts (токен `master`, легаси
  `status` с пометкой legacy БЕЗ ⚠️); `### Master Colors` — токен + data-поле
  `staff.master.color` с file:line (StaffModal.tsx:68), без константы и ФИО;
  Status Colors — построчно из VISIT_STATUS_CONFIG.ts; Status Icons — экспорты
  по StatusIcons.tsx; Status Display Components — живые пути shared/
  (StatusBadge, StatusPicker, StatusFiltersPicker), без CustomSelect.
- [ ] Для КАЖДОЙ переменной Theme Variables определить статус с греп-доказательством:
  дубль? (второе определение в globals.css); есть ли потребитель вне globals.css
  — `grep -rn '<varname>' frontend/admin --include='*.ts*' --include='*.css' -l |
  grep -v globals.css`; нет — метка «consumers: none». Итоговый список меток —
  в PR-описание.
- [ ] Self-check прозы по naming-таблице (спека §4): пройтись по черновику
  T1-T2 и убедиться, что forbidden-синонимы (Artist, Bookings для записей,
  Employee/Worker, Attendance, Studio/Room, Course/Type, Customer, Guest,
  Attendee, Class/Workshop) не встречаются в прозе/заголовках — легитимны
  только внутри цитируемых имён файлов (исключение спеки §6.2).
- [ ] Переписать Typography / Shadows / Spacing / Radius / Scrollbar /
  Transitions / Animations по коду; несуществующие строки удалить;
  «Difference from sketch»-пометки не переносить.

### DoD

- Все значения секций T1 выводимы из кода: каждый хекс/размер/класс имеет
  источник file:line в документе.
- `grep -ci artist docs/design-system.md` = 0; блоков ⚠️ «Difference from
  sketch» нет; ФИО сотрудников (Sereda/Bolshakova/Tyulpina/Gorokh) = 0.
- Frontmatter: `updated: 2026-09-16`, `sections:` соответствует оглавлению.

---

## Task 2: Перезапись Components и Patterns

### Classification: standard

### Required Docs

- Спека: `docs/specs/2026-09-16-design-system-refresh-design.md` (§3.5-3.6)
- `frontend/admin/app/components/layout/Menubar.tsx` (NAV_ITEMS 135-139,
  DIRECTORY_ITEMS 141-152, секции 554-649, UserMenu 661, collapse 665-679,
  version 683-687, logo 509-513)
- `frontend/admin/app/(main)/layout.tsx`, `frontend/admin/app/layout.tsx`,
  `frontend/admin/app/providers.tsx`
- `frontend/admin/app/(main)/schedule/page.tsx` (условный Toolbar :23)
- `frontend/admin/app/components/schedule/ActivityCard.tsx` (tier-логика 36-48)
- `frontend/admin/app/components/toast/ToastContainer.tsx`
- `frontend/admin/app/components/shared/` (полный ls + subdir-листинг)
- `docs/domain-rules/_overview.md:52-65`

### Steps

- [ ] Переписать Sidebar-секцию как Menubar (структура и file:line по списку
  Required Docs; MiniCalendar включить по фактическому пути файла; мёртвый код
  ChatIcon/ICON_MAP в доке не упоминается — вне скоупа, замечание спеки §7).
  Ownership-примечание: таблицу Status Display Components владеет T1 (секция
  Status); T2 в инвентаре shared/ даёт только однострочные позиции, дублировать
  таблицу не нужно.
- [ ] Переписать Toolbar (не глобальный, рендер условный в schedule/page.tsx),
  Right Panel (различать «где определён» — components/layout/ и «где
  рендерится»), ActivityCard по tier-логике, Toast по components/toast/,
  StampFab, Select / Filter Input, Page Layout Shell по фактическим
  провайдерам.
- [ ] Добавить подсекции DataTable / Modal / FullPageError (2-4 строки +
  file:line) и список-по-строке всех shared-компонентов: верхний уровень
  shared/*.tsx (17 файлов) + подкаталоги payments/ record/ records/ visitors/
  + config/ icons/ — имена и пути сверить с живым ls (не по памяти).
- [ ] Переписать 6 паттернов по коду (Active Nav Item — под Menubar; новые
  паттерны не изобретать).

### DoD

- Секции DataTable / Modal / FullPageError присутствуют; список покрывает
  ВСЕ shared/*.tsx верхнего уровня и компоненты подкаталогов.
- Каждый file:line в T2 существует (вход в механическую проверку T3).
- Toolbar помечен как условно-рендеримый; ActivityCard без старых порогов.

---

## Task 3: Механическая верификация + PR

### Classification: small

### Required Docs

- Спека: `docs/specs/2026-09-16-design-system-refresh-design.md` (§6 DoD)

### Steps

- [ ] Grep-критерии спеки §6.2 (все `grep -ci`, ожидание 0): artist, employee,
  guest, `/bookings`, `/chat`, CustomSelect, ArtistLegend, .worktrees;
  `sketches/` ≤ 1. Вывод — в PR-описание.
- [ ] Скрипт-одноходовка file:line (в репо НЕ добавлять). Проверяет: файл
  существует И cited-строка не за пределами файла. Диапазоны `:N-M` обрезаются
  до стартовой строки. Док цитирует пути в трёх формах: полный
  `frontend/admin/...`, относительно `app/` (`(main)/...`), и короткие имена
  (`ActivityCard.tsx`) — резолв: прямые префиксы, затем find по имени:
  ```bash
  grep -oE '[A-Za-z0-9_./()-]+\.(tsx|ts|css):[0-9]+(-[0-9]+)?' docs/design-system.md \
    | sort -u | while read -r ref; do
        p="${ref%%:*}"
        while [ "${p:0:1}" = "(" ]; do p="${p:1}"; done   # strip citation parens
        n="${ref##*:}"; n="${n%%-*}"
        f="frontend/admin/$p"; test -f "$f" || f="$p"; test -f "$f" \
          || f="$(find frontend/admin -name "$p" 2>/dev/null | head -1)"
        if ! test -f "$f"; then echo "MISSING FILE: $ref"; continue; fi
        total=$(wc -l < "$f")
        [ "$n" -ge 1 ] && [ "$n" -le "$total" ] || echo "LINE OUT OF RANGE: $ref (total $total)"
      done
  ```
  Ожидание: вывод пуст. Вывод (команда + результат) — в PR-описание.
- [ ] PII-проверка: grep по фамилиям мастеров из seed-данных
  (`grep -ci 'sereda\|bolshakova\|tyulpina\|gorokh' docs/design-system.md` = 0;
  фамилии выводить из seed, не хардкодить новые).
- [ ] Проверка docs-only: `git diff --stat` = ровно `docs/design-system.md`.
- [ ] CHANGELOG не пишется (в репо нет CHANGELOG.md — решение спеки §6-ревью).
- [ ] PR: заголовок «docs: refresh design-system.md (#287)», в описании —
  вывод всех проверок и строка «Closes #287» (закрытие — только здесь, в PR).

### DoD

- Все механические проверки спеки §6.1-6.7 зелёные, вывод в PR-описании.
- diff PR не содержит файлов вне docs/design-system.md (§6.6).
- Сценарии S1-S5 спеки §5 покрыты проверками (E2E к доку неприменим —
  docs-only адаптация канона, заякорено в спеке).
