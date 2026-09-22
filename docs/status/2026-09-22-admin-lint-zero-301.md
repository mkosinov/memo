# GH #301 — Спуск линт-порога frontend/admin 38→0 (ratchet до нуля)

- **Date**: 2026-09-22
- **Branch**: `chore/301-admin-lint-zero`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `062b42e6` (main) — 6 commits (`ec1f4e68..9b2be3cb`), 44 files
- **Issue**: #301 — спуск линт-порога frontend/admin 38→0 (ratchet, 4 группы)
- **Spec**: `docs/specs/2026-09-19-admin-lint-zero-301-design.md` (on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-admin-lint-zero-301-plan.md` (5 tasks, on main; `## Статус` — 5/5, закрыт этим docs-коммитом)

## Goal

Линт-гейт `frontend/admin` становится строгим нулём: `eslint . --max-warnings 0`
(было 38). Все 37 фактических предупреждений чистятся четырьмя группами в порядке
возрастания риска (unused-vars → any → img → exhaustive-deps), порог после каждой
группы опускается до фактического остатка. Поведение приложения не меняется
(кроме картинок — те отрисовываются визуально идентично через `next/image`).

## Summary of Changes (per task)

- **T1 — `no-unused-vars`: 37 → 24** (`ec1f4e68`) — 13 фиксов (в плане 15: 2
  предупреждения уже отсутствовали): мёртвые локальные сущности удалены
  (`handleWeekClick`, `MasterLegend`-копия в `Menubar`, `dateTo` в
  `ScheduleViewContext`), мёртвые props/аргументы удалены (`onDelete`
  `ClientInfoTab`, `activity` `NewRecordTab`, `recordStatus` `RecordVisitsTable`,
  `updated` `RecordPaymentsTable`, `isPreview` `VisitorRow`), контракт-нейтральные
  `_`-переименования (`mode` ×5 в модалках справочников, `value`
  `RemoteSearchSelect`, `row` в тесте `InlineEditRow`).
- **T2 — `no-explicit-any`: 24 → 18** (`1e23af1e`) — 6 фиксов: касты-реликты
  `ClientTab` ×2 сняты (покрыты локальным `RecordPatchData`), `newClient as any`
  в `ClientCardModal` заменён честными нулями статистики, `InlineEditRow`
  `value: any` → `value: F[keyof F]` (+тест).
- **T3 — `@next/next/no-img-element`: 18 → 12** (`4c9bf2a9`, `c763d741`) —
  4 места переведены на `next/image` (логотип `Menubar`, аватар `staffColumns`,
  аватар `UserMenu`, превью `MyDataModal`); `next.config.mjs` — запись
  `images.remotePatterns` для хоста бэкенда (env-derived, `**` на поддоменах
  не нужен — хост один); новый helper `frontend/admin/lib/avatar.ts`
  `toAvatarSrc` (аватары round 28/32/64 через `/_next/image`); 2 места остаются
  `<img>` с обоснованными disable (миниатюра `photoColumns`, превью `PhotoModal` —
  внешние ссылки, произвольные хосты, спека §4.3); e2e `cabinet.spec.ts` (S3)
  адаптирован под S3-хост; `docs/design-system.md` — фрагмент про логотип
  (закоммичено в `4c9bf2a9`, здесь не дублируется). `sharp` не добавлялся
  (dev-оптимизатор отдаёт `/_next/image` 200 с реальным сжатием; rationale —
  комментарий рядом с `remotePatterns`).
- **T4 — `react-hooks/exhaustive-deps`: 12 → 0** (`e8940d57`, `9b2be3cb`) —
  12 фиксов по рецептам спеки §4.4 (лишние `clientId`, добавление неизменных
  `initial`/`resetActiveGroup`, деструктуризация `mutateAsync` вместо объектов
  мутаций в `ScheduleDataContext` ×3, мемоизация `visible`+`optionDomId` в
  `Combobox`, локальная копия `toastTimers.current` в `UIContext`,
  `initialOrder` + reconcile-короткое замыкание в `useColumnReorder`);
  1 обоснованное подавление — `SettingsTab` `gridFrequency` (честное добавление
  зависимости сбрасывало бы незавершённые правки формы); `9b2be3cb` — уточнение
  комментария о `mutateAsync` по quality-ревью (только комментарии, логика не
  менялась).
- **T5 — финальная верификация (trivial)** — без отдельного коммита: порог 0,
  повторный прогон всех гейтов, S5-аудит подавлений, S1-негативный тест порога.

## Test Results

- **ESLint (admin):** `eslint . --max-warnings 0` — **0 errors / 0 warnings**, exit 0
  (снимок: commit `9b2be3cb`, 2026-09-22T12:37:42Z).
- **Type check:** `tsc --noEmit` — exit 0.
- **admin vitest (полный прогон):** **2405 / 2405** (при полной нагрузке хоста —
  5 flaky-фейлов known-load; изолированный повтор обоих файлов 75/75 зелёный;
  known-pass эталон 2405/2405 на `e8940d57`).
- **E2E затронутых экранов:** **12/12 спеков (125 тестов)** — shard-schedule 44/44
  (records, records-view, schedule, dayview-column-reorder), shard-rest 81/81
  (navigation, cabinet, staff-crud, photos-crud, clients, admin-manages-payments,
  schedule-saving-toast, combobox-dictionaries). 1 load-flake `schedule.spec.ts`
  (week navigation) изолированно зелёный (7.7 s) — арбитр CI.
- **Визуальный гейт:** **4/4 поверхности PASS** (17/17 DOM-assertions: логотип
  `/_next/image` 400px, аватары round 32/28/64, `naturalWidth>0`); formal-скрипт —
  vacuous pass (спека без `- [ ]` чек-листа, ожидаемо).

## Acceptance Criteria (spec §2 / §5)

| Критерий | Статус |
|---|---|
| S1 — новый warning ломает линт при пороге 0 | ✅ негативный тест: проба `const unusedVarS1Probe = 1;` → RED (exit 1, «maximum: 0») → удаление → GREEN (exit 0); буквальный `_`-префикс exempt'ится `varsIgnorePattern: "^_"` — гейт доказан именем без подчёркивания |
| S2 — каждая ступень ratchet'а зелёная (lint + type-check на каждом коммите) | ✅ 4 код-коммита, порог = факту после каждого (37→24→18→12→0) |
| S3 — поведение хуков не изменилось | ✅ vitest 2405/2405; ручная проверка 12 точек (карточка клиента, карточка записи, расписание create/update/copy, комбобокс, тосты, переупорядочивание колонок, настройки, «Мои данные», визуал T3) — перечень в описании PR |
| S4 — картинки как прежде | ✅ визуальный гейт 4/4 (логотип/аватары через оптимизатор, фото без изменений) |
| S5 — все новые подавления документированы | ✅ 3/3 новых disable с `-- причиной` (2× `no-img-element`, 1× `exhaustive-deps`); безобоснованных 0 |
| Скоуп (§5) | ✅ в скоупе: исходники с warnings, `package.json` (порог), `next.config.mjs` (remotePatterns), `docs/design-system.md`; вне скоупа не тронуты: `.eslintrc.json`, `frontend/web` (#300), бэкенд, пакеты |

## Key Files Changed

- `frontend/admin/package.json` — `--max-warnings 38` → `0`.
- `frontend/admin/next.config.mjs` — `images.remotePatterns` (env-derived хост бэкенда).
- `frontend/admin/lib/avatar.ts` — новый helper `toAvatarSrc`.
- Источники с фиксами (34 файла правок): `Menubar`, `UserMenu`, `staffColumns`,
  `MyDataModal`, `photoColumns`, `PhotoModal`, `ClientTab`, `NewRecordTab`,
  `ClientCardModal`, `ClientInfoTab`, `ClientRecordTab`, `RecordVisitsTable`,
  `RecordPaymentsTable`, `VisitorRow`, `InlineEditRow`, `Combobox`,
  `RemoteSearchSelect`, `ScheduleDataContext`, `UIContext`, `SettingsTab`,
  `useColumnReorder`, модалки справочников (Location/Position/Material/Service/
  Tag) и др. — полный список: `git diff --name-only 062b42e6..HEAD`.
- Тесты: 10 обновлённых unit-файлов admin + `e2e/cabinet.spec.ts` (S3).
- `docs/design-system.md` — фрагмент про логотип (в код-коммите `4c9bf2a9`).
- Бэкенд, `packages/*`, `.eslintrc.json`, `frontend/web` — не тронуты.

## Docs Impact

- Спека + план на main; план `## Статус` (5/5) закрыт этим docs-коммитом.
- `CHANGELOG.md` — новый раздел `## [Unreleased] — 2026-09-22` (этот docs-коммит).
- `PLAN.md` — completion-blockquote + строка в Implementation Status.
- `docs/design-system.md` — уже обновлён код-коммитом `4c9bf2a9` (дубля нет).

## Deviations from the plan

- Фактический старт **37** предупреждений (порог в `package.json` был 38 —
  «потолок, не равенство» по конвенции #143); плановые ступени 38→22→17→11→0
  считались от 37 → фактический ход 37→24→18→12→0.
- T1: 13 фиксов вместо 15 (2 предупреждения плана уже отсутствовали на базе).
- T4: 12 фиксов вместо 11 (одно предупреждение больше в фактическом прогоне).
- S1: буквальный `_unusedVarS1` exempt'ится конфигом (`varsIgnorePattern: "^_"`) —
  гейт доказан пробой без подчёркивания.

## References

- **GitHub Issue**: #301
- **Design Spec**: `docs/specs/2026-09-19-admin-lint-zero-301-design.md` (on main)
- **Plan**: `docs/plans/2026-09-19-admin-lint-zero-301-plan.md` (on main, `## Статус` 5/5)
- **PR body (draft)**: `/tmp/opencode/301-pr-body.md` (orchestration artifact, not committed)
- **PR**: _(to be added after PR creation)_
