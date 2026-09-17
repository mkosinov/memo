# План: #143 chore(admin) — честный порог линта + иконки lucide-react

**Goal.** Сделать линт-гейт admin честным (весь проект, порог = фактический
счёт, новые warnings роняют CI) и заменить рукописные SVG-иконки двух
layout-файлов на библиотеку lucide-react (включая удаление карты ICON_MAP).
Спека: `docs/specs/2026-09-17-admin-lint-icons-design.md` (rev2).

**Architecture.** Только конфиг линта (`frontend/admin/package.json`,
`frontend/admin/.eslintrc.json`) и два presentational-компонента
(`app/components/layout/Menubar.tsx`, `app/components/layout/UserMenu.tsx`)
+ перегенерация visual-базлайнов. Бэкенд, домен, API, frontend/web — не
трогаются. Follow-up: #300 (web-линт), #301 (спуск порога до 0,
depends-on #143).

**Tech Stack.** Next.js 14 (admin), ESLint 8 + `.eslintrc.json`
(eslint-config-next 14.2.35), lucide-react 1.21.0 (уже в dependencies),
Playwright (visual-regression, проекты shard-schedule/shard-rest), CI
GitHub Actions (`test.yml` job `frontend-checks`, workflow
`update-snapshots.yml`).

## Behavioral Delta

- **Разработчик/CI:** линт падает (exit ≠ 0) при появлении warning'а в
  любой кодовой папке проекта, кроме исключённых (`.next/`, `e2e/`,
  `__tests__/`); порог — потолок по факту (снимок 37 на 17.09).
- **Пиксели UI:** глифы иконок Menubar (18×18) и UserMenu (14×14) меняются
  на lucide-глифы; размеры, раскладка и поведение навигации/темы/логаута
  не меняются. Visual-базлайны обновляются штатным CI-workflow.
- **Ноль изменений** в API/схемах/домене; пользовательского поведения
  не добавляется; ничего в frontend/web.
- E2E-якоря: S1/S5 → CI-гейт линта (у линта нет E2E-раннера — механические
  RED-GREEN проверки в задачах); S2 → auth-session/auth-roles; S3 →
  cabinet; S4 → visual-регрессия.

## Task 1: Menubar — иконки на lucide, ICON_MAP удалён

### Classification: small

### Required Docs
- `docs/design-system.md` — раздел про Menubar (структура навигации;
  иконки — деталь реализации ниже уровня дока, дока не меняется).
- Гард: `scripts/check_z_tokens.py` (CI) — правки не вводят сырых цветов,
  гард обязан остаться зелёным.

### Содержание (решения D3, D4, D5, D6, D10 спеки)
1. Удалить 11 рукописных SVG-компонентов (`<svg>` на :21–122): Calendar,
   Clipboard, Users, Palette, Chat, Chevron, Book, Package, MapPin, Tag,
   Image — вместе с мёртвыми Chat/Package/MapPin/Tag целиком.
2. Удалить `ICON_MAP` (:177–187) и строковые ключи иконок.
3. Пункты навигации (:136–138) и `PHOTO_ITEM` (:175) несут компонент
   напрямую: `{ label: 'Расписание', Icon: Calendar, href: '/schedule' }`,
   рендер через `<item.Icon />` (место прежнего `ICON_MAP[item.icon]`, :569).
4. Прямые lucide-импорты на прежних местах использования: Palette (:601),
   BookOpen (:639), ImageIcon-алиас (:683) — `import { Image as ImageIcon
   } from 'lucide-react'`.
5. `ChevronIcon` — тонкая локальная обёртка над lucide `ChevronRight`:
   проп `expanded`, класс `rotate-90` при раскрытии (сохранить поведение
   :605/:643); используется на обоих местах.
6. Inline-шевроны: :311 → `ChevronLeft` `size={12}`, :356 → `ChevronRight`
   `size={12}`, :709 → `ChevronLeft` `size={16}` с сохранением
   `rotate-180`-логики сворачивания сайдбара.
7. Габариты живых иконок: `size={18}`, `strokeWidth={2}` (текущие 18×18).

### DoD
- `grep -c '<svg' app/components/layout/Menubar.tsx` == 0;
  `grep ICON_MAP` — ноль вхождений.
- Сценарий S2: E2E-якоря остаются зелёными — `e2e/auth-session.spec.ts:46`
  (menubar visible), `e2e/auth-roles.spec.ts:32–48` (пункты навигации).
  (Существующие сьюты, новые e2e НЕ пишутся — chore не добавляет
  поведения; RED-GREEN-правило применяется к S1 в Task 3.)
- type-check зелёный.

## Task 2: UserMenu — Sun/Moon/LogOut на lucide

### Classification: trivial

### Required Docs
- `docs/design-system.md` — раздел UserMenu (структура; иконки — деталь
  реализации).

### Содержание (решение D7)
1. Локальные `SunIcon`/`MoonIcon`/`LogoutIcon` (:17–49) удалить.
2. Заменить на lucide-экспорты `Sun`, `Moon`, `LogOut` с `size={14}`
   (текущие SVG 14×14; дефолт 24 удвоит иконки) в местах рендера
   :244/:249/:294.

### DoD
- `grep -c '<svg' app/components/layout/UserMenu.tsx` == 0.
- Сценарий S3: `e2e/cabinet.spec.ts` (UserMenu popup: тема + выход)
  остаётся зелёным.
- type-check зелёный.

## Task 3: Линт-гейт — весь проект, порог по факту

### Classification: small

### Required Docs
- (нет доменных/дизайн доков — конфиг-задача)

### Содержание (решение D1; выполнить ПОСЛЕ Task 1–2 — счёт мерится
финальным состоянием кода)
1. В `frontend/admin/package.json` скрипт lint →
   `eslint . --max-warnings N`.
2. В `frontend/admin/.eslintrc.json` добавить
   `ignorePatterns: [".next/", "e2e/", "__tests__/"]`
   (node_modules ESLint игнорирует по умолчанию).
3. Измерить счёт: `npx eslint .` (в frontend/admin, на живых
   зависимостях) → N = фактический счёт warnings; выставить в скрипт.
   Если счёт 0 — `--max-warnings 0`. Ошибок (error-уровень) на
   17.09 ноль — если появились, чинить их в этой задаче до запуска RED-GREEN.
   Если `eslint .` зацепит корневые конфиг-файлы (`next.config.mjs`,
   `playwright.config.ts` и т.п.) warning'ами — решить на месте:
   включить в счёт или добавить в `ignorePatterns` (решение фиксируется
   в PR-описании).
4. RED-GREEN: создать временный файл с заведомым warning (например,
   неиспользуемая переменная в `lib/`) → `pnpm lint` даёт exit ≠ 0 →
   удалить временный файл → exit 0.
5. Убедиться: `git diff` не затрагивает ничего вне перечисленных файлов.

### DoD
- Скрипт и конфиг закоммичены; порог == счёту на момент коммита
  (сценарий S5: `npx eslint .` → счёт == порогу, exit 0).
- RED-GREEN проверка S1 выполнена и описана в PR (введённый warning
  уронил линт).
- CI `frontend-checks` зелёный.

## Task 4: Перегенерация visual-базлайнов (только через CI-образ)

### Classification: small

### Required Docs
- `.github/workflows/update-snapshots.yml` (канонический путь: baselines
  генерируются на runner-образе shard-rest для шрифтового паритета,
  локальные macOS-шрифты дают дрейф — локальный `test:e2e:update` для
  коммита базлайнов НЕ используется).

### Содержание (сценарий S4)
1. На ветке IMPL (после Task 1–3) запустить вручную:
   `gh workflow run update-snapshots.yml --ref <ветка>`.
2. Скачать артефакт `updated-snapshots-shard-rest` (регенерирует все три
   сьюта — visual-regression, wave6-status-snapshots, week-view: все в
   проекте shard-rest, проверено по testMatch конфига).
3. Разложить PNG в `frontend/admin/e2e/**/*-snapshots/`, закоммитить.
4. Инспекция диффов: ожидается сдвиг ТОЛЬКО глифов Menubar/UserMenu
   (сайдбар) в fullPage/viewport-кадрах. Неожиданные сдвиги вне этих
   областей — разбирать, не блайнд-акцептить (раскраска diff'ов,
   честный отчёт в PR).

### DoD
- E2E сценария S4: прогон shard-rest на PR зелёный от пересозданных
  базлайнов (`e2e-tests` job, SHARD_ID=2).
- В PR описан характер диффов (только иконки).

## Task 5: Сводные гейты + CHANGELOG

### Classification: small

### Required Docs
- `CHANGELOG.md` (house style: секция test-infra/tooling).

### Содержание
1. Полные гейты: `pnpm lint`, `pnpm run type-check` (frontend/admin),
   e2e по конвенции test-all (shard-schedule + shard-rest), z-token
   guard (`scripts/check_z_tokens.py`).
2. `CHANGELOG.md`: одна строка (lint-гейт стал рабочим: весь проект +
   порог 37 + lucide-иконки Menubar/UserMenu).
3. Scope-гард: `git diff` PR затрагивает только `frontend/admin/package.json`,
   `frontend/admin/.eslintrc.json`, `Menubar.tsx`, `UserMenu.tsx`,
   базлайны PNG, `CHANGELOG.md` (+ строки PR-описания).

### DoD
- Все гейты зелёные; PR-описание содержит `Closes #143` (закрытие
  issue — только в PR, не в коммитах) и упоминания follow-up #300/#301.
