# План: chore(admin) — спуск линт-порога 38→0 (#301)

Спека: `docs/specs/2026-09-19-admin-lint-zero-301-design.md` (rev Gate B, запушена `befb890d`).
Behavioral Delta — в спеке §3; здесь не дублируется.

## Goal

Убрать все 37 предупреждений линта `frontend/admin` четырьмя группами в порядке
возрастания риска (unused-vars → any → img → deps), опуская порог
`--max-warnings` до фактического остатка после каждой группы; итог — порог 0,
проверки `frontend-checks` (lint, type-check, z-token guard) зелёные.

## Architecture

Чистка кодовой базы `frontend/admin` без изменения поведения приложения.
Единственные сопутствующие поверхности: `next.config.mjs` (одна запись
`images.remotePatterns` для хоста бэкенда), возможная зависимость `sharp`
(прод-сборка оптимизатора), правка числа в `package.json`, фрагмент про
логотип в `docs/design-system.md`. Контракты компонентов меняются точечно
там, где props мёртвые (5 удалений, спека §4.1); судьба `mode` ×5 и `value` —
follow-up #368, здесь только `_`-переименования.

## Tech Stack

ESLint 8.57.1 (legacy `.eslintrc.json`, `next/core-web-vitals` +
`next/typescript`), TypeScript, Next.js (app router), react-query v5, pnpm,
vitest (юнит), Playwright (e2e затронутых экранов).

## Task 1 — Группа unused-vars: 15 предупреждений → порог 22

Классификация: **small** · Сценарий: S2 · Required Docs: спека §4.1

- Удалить мёртвые локальные сущности: `handleWeekClick` и `MasterLegend`
  в `Menubar` (мёртвая копия; видимый блок «Мастера» не трогать),
  `dateTo` в `ScheduleViewContext`.
- Удалить мёртвые props/аргументы: `onDelete` (`ClientInfoTab`), `activity`
  (`NewRecordTab`, включая строку вызова), `recordStatus` (`RecordVisitsTable`
  + 2 строки вызовов), `updated` (параметр callback в `RecordPaymentsTable`),
  `isPreview` (`VisitorRow`).
- `_`-префикс (контракты не меняются): `mode` ×5 в модалках справочников,
  `value` в `RemoteSearchSelect`, `row` в `InlineEditRow.test.tsx`.
- Опустить `--max-warnings` до фактического остатка (ориентир 22).
- Гейт: `pnpm lint` и `pnpm run type-check` зелёные; vitest зелёный; порог =
  факту.

## Task 2 — Группа no-explicit-any: 5 → порог 17

Классификация: **small** · Сценарии: S2, S3 (карточка клиента) · Required Docs: спека §4.2

- `ClientTab` ×2: убрать касты-реликты (`{visits} as any`, `{comment} as any`)
  — локальный тип `RecordPatchData` уже покрывает оба payload. Если каст
  несущий — честно расширить `RecordPatchData` (он в админке).
- `ClientCardModal`: вместо `newClient as any` — честные нули статистики
  (`records_count: 0, last_record: null, total_paid: 0, missed_records: 0`).
- `InlineEditRow` + тест: `value: any` → `value: F[keyof F]`; при несогласии
  компилятора — реструктуризация записи состояния прежде подавления.
- Ручная проверка: карточка клиента после создания — статистика нулевая,
  блок статистики не пустой.
- Гейт: lint + type-check зелёные, порог = факту (ориентир 17).

## Task 3 — Группа no-img-element: 6 → порог 11

Классификация: **standard** · Сценарий: S4 · Required Docs: спека §4.3; `docs/design-system.md` (раздел Layout, логотип)

- `next.config.mjs`: `images.remotePatterns` для хоста бэкенда (аватары,
  `/api/v1/files/avatar/…`); при необходимости добавить `sharp` в зависимости.
- 4 места на `next/image`: логотип в `Menubar`, аватар в `staffColumns`,
  аватар в `UserMenu`, превью в `MyDataModal`. Аватары круглые, клетка
  фиксированная — проверить раскладку (`fill`/`sizes` по месту).
- 2 места остаются `<img>` с подавлением
  `eslint-disable-next-line @next/next/no-img-element -- причина`:
  миниатюра в `photoColumns`, превью в `PhotoModal` (внешние ссылки,
  произвольные хосты — обоснование в спеке §4.3).
- `docs/design-system.md`: фрагмент про логотип `<img>` → `next/image`.
- Ручная проверка + e2e затронутых экранов (меню, сотрудники, «Мои данные»,
  фото).
- Гейт: lint + type-check зелёные, порог = факту (ориентир 11).

## Task 4 — Группа exhaustive-deps: 11 → порог 0

Классификация: **standard** · Сценарий: S3 · Required Docs: спека §4.4 (решения по всем 11 местам)

- По рецептам спеки: убрать лишний `clientId` (`ClientRecordTab`, `ClientTab`
  — 2); добавить неизменные
  `initial` и `resetActiveGroup` (2); деструктурировать `mutateAsync` вместо
  объектов мутаций в `ScheduleDataContext` (3); мемоизировать `visible` +
  `optionDomId` и добавить в зависимости (`Combobox`); локальная копия
  `toastTimers.current` с использованием в cleanup (`UIContext`);
  `initialOrder` в зависимости + короткое замыкание reconcile
  (`useColumnReorder`); подавление с обоснованием для `gridFrequency`
  (`SettingsTab`) — форма `eslint-disable-next-line react-hooks/exhaustive-deps -- причина`.
- Ручной обход по чек-листу спеки §4.4 (карточка клиента, карточка записи,
  настройки занятия, «Мои данные», расписание ×5 сценариев, комбобокс, тосты);
  результат — в описание PR.
- Гейт: lint 0 warnings (порог 0), type-check, vitest зелёные.

## Task 5 — Финальная верификация и фиксация

Классификация: **trivial** · Сценарии: S1, S5 · Required Docs: спека §2, §5

- Порог в `package.json` = 0; повторный прогон: lint 0, type-check, vitest,
  e2e затронутых экранов зелёные.
- S5: grep `eslint-disable` по файлам правок — каждое новое подавление
  с обоснованием (обе формы).
- S1: тестовый warning → lint красный → удалить.
- В описание PR: счёт по группам (38→22→17→11→0), перечень ручных проверок
  хуков, решение по `sharp` (добавлен или не потребовался), снимок итоговой
  строки линта.

---

## Статус

✅ **Завершён 2026-09-22** — 5/5 задач, ветка `chore/301-admin-lint-zero`
(6 коммитов `ec1f4e68..9b2be3cb`, base `062b42e6`):

| Task | Коммит(ы) | DoD |
|------|-----------|-----|
| Task 1 — unused-vars: 37 → 24 | `ec1f4e68` | ✅ |
| Task 2 — no-explicit-any: 24 → 18 | `1e23af1e` | ✅ |
| Task 3 — no-img-element: 18 → 12 | `4c9bf2a9`, `c763d741` | ✅ |
| Task 4 — exhaustive-deps: 12 → 0 | `e8940d57`, `9b2be3cb` (правка комментария по quality-ревью) | ✅ |
| Task 5 — финальная верификация и фиксация | (без отдельного коммита — верификация финального состояния) | ✅ |

Итог: lint **0 errors / 0 warnings** (порог `--max-warnings 0`), type-check
exit 0, vitest **2405/2405** (известный load-flake изолированно зелёный),
e2e затронутых экранов **12/12 спеков (125 тестов)**, визуальный гейт
**4/4 поверхности**; S5 — 3/3 новых подавления с обоснованием; S1 —
негативный тест порога (проба → RED → удаление → GREEN; буквальный `_`-префикс
из плана exempt'ится `varsIgnorePattern: "^_"` — гейт доказан именем без
подчёркивания). `sharp` не потребовался. Отклонения от ориентиров плана:
фактический старт 37 (порог в package.json был 38), T1 — 13 фиксов (в плане
15: 2 уже отсутствовали), T4 — 12 фиксов (в плане 11).
