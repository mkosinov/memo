# GH #397 — Страж ухода со страницы во время окна отмены (beforeunload на конвейере отложенных удалений)

- **Date**: 2026-09-28
- **Branch**: `397-beforeunload-guard`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `0277b7c0` — 5 commits (`b69a54e6..f7a89c32`), 9 files, +1114/−27
- **Issue**: #397 — страж ухода со страницы во время окна отмены
- **Spec**: `docs/specs/2026-09-27-beforeunload-guard-397-design.md` (rev2 — правки по панели; покрытие «отправок в полёте» — да, решение пользователя на Gate B)
- **Plan**: `docs/plans/2026-09-27-beforeunload-guard-397-plan.md` (5 задач, все DONE)

## Goal

Конвейер отложенных удалений (`PendingActionsProvider`, общий на всё приложение) исполняет
удаление через 5 секунд после подтверждения — а если вкладку закрыть или перезагрузить страницу
в окне кольца, таймер умирает вместе со страницей и DELETE никогда не уходит: подтверждённое
удаление отменяется молча, без согласия пользователя. Цель — подтверждённое удаление либо
исполняется, либо отменяется с явного согласия: пока в конвейере есть незавершённые действия,
браузерный `beforeunload`-диалог спрашивает подтверждение ухода; уход, навязанный системой
(401 → /login), диалог не поднимает.

## Summary of Changes (per task)

- **T1 — модуль принудительной навигации + проводка 401 (small):** `lib/forcedNavigation.ts` —
  крошечный модуль-флаг (`markForcedNavigation` / `isForcedNavigation`, «установил → прочитал →
  сбросил»), слой авторизации в `AuthContext` ставит флаг перед полным переходом на
  `/login?returnTo=…` в 401-перехватчике (`b69a54e6`).
- **T2 — счётчик незавершённых действий + подключение стража (standard):**
  `PendingActionsContext` ведёт реактивное состояние-пару `{ ожидающие, отправки }` —
  функциональные обновления, одно на переход (дедупликация повторной постановки того же id —
  нетто-ноль, иначе счётчик уплывает навсегда); истечение окна — один объединённый переход
  `ожидающие − 1, отправки + 1` (семантика #285 rev8 — запись из карты до коммита — сохранена);
  декремент `отправок` в ОДНОЙ точке на любой исход коммита (успех / 404-тихий успех / ошибка с
  обработчиком потребителя / ошибка с откатом и тостом); в теле провайдера
  `useUnsavedChangesGuard(hasPending)` — страж активен, пока суммарный счётчик > 0 (`1d490675`).
- **T3 — vitest-покрытие конвейера + проводка стража (standard):** группы С1–С8 в
  `PendingActionsContext.test.tsx` (шпионы `addEventListener`/`removeEventListener` + синтетическая
  отправка отменяемого `beforeunload` с проверкой `defaultPrevented`; снятие стража на каждом
  исходе, дедуп-нетто-ноль, С4а поздний «Отменить», С5 отправка в полёте, С6 два действия,
  С7 SPA-навигация без стража, сосуществование со вторым стражем Topbar); С8 — хук
  `useUnsavedChangesGuard` перед `preventDefault` проверяет `isForcedNavigation()` (сам механизм
  хука не менялся) + файл `beforeunloadForcedNavigation.test.tsx` (`3f31cc07`).
- **T4 — e2e сценарий С3 (small, best-effort):** `e2e/pending-delete-unload-guard.spec.ts` —
  нативный диалог Chromium из Playwright (`page.on('dialog')` до действия,
  `page.close({ runBeforeUnload: true })` / `page.reload()`), 4/4 зелёные в шард-режиме
  (`fb7ead43`).
- **T5 — CHANGELOG (trivial):** запись под `[Unreleased] — 2026-09-28` → `### Added`
  (`f7a89c32`).

## Test Results

- **vitest (full admin):** **2606 passed / 0 failed** (163 файла).
- **backend pytest (full):** 2939 passed / 15 skipped — фича фронтендовая, серверная часть не
  тронута (базовый регресс-прогон).
- **e2e:** новый спек 4/4 зелёный в шард-режиме; полный локальный `test-all` зелёный, кроме
  ОДНОГО постороннего инфра-флейка (`schedule-z-layering` S3, `socket hang up` на setup-API —
  нагрузочный, к фиче отношения не имеет).

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Спека §3 Behavioral Delta доставлена: пока pending+inflight > 0 — страж вооружён, диалог штатный | ✅ |
| Снятие стража на каждом исходе коммита (одна точка декремента) | ✅ (vitest С1–С6) |
| Дедуп повторной постановки — нетто-ноль, страж не залипает | ✅ (vitest) |
| 401-переход → /login без диалога (`markForcedNavigation` + проверка в хуке) | ✅ (vitest С8) |
| Потребители конвейера, сервер, контракты API — нулевые правки | ✅ (0 файлов вне конвейера/авторизации/тестов) |
| CHANGELOG-запись добавлена | ✅ (`f7a89c32`, в составе T5 IMPL) |

## Key Files Changed

- `frontend/admin/lib/forcedNavigation.ts` (new) — флаг принудительной навигации (T1)
- `frontend/admin/contexts/AuthContext.tsx` — `markForcedNavigation()` перед `location.assign('/login…')` в 401-перехватчике (T1)
- `frontend/admin/contexts/PendingActionsContext.tsx` — счётчик `{ожидающие, отправки}` + `useUnsavedChangesGuard(hasPending)` (T2)
- `frontend/admin/hooks/useUnsavedChangesGuard.ts` — `isForcedNavigation()`-выход перед `preventDefault` (T3)
- Tests: `__tests__/forcedNavigation.test.ts` (new, T1), `__tests__/PendingActionsContext.test.tsx` (+540 — группы С1–С8, T2/T3), `__tests__/beforeunloadForcedNavigation.test.tsx` (new — С8 на хуке, T3), `e2e/pending-delete-unload-guard.spec.ts` (new — С3, T4)
- `CHANGELOG.md` — запись под `[Unreleased] — 2026-09-28` (T5)

## Docs Impact

- `PLAN.md` — completion blockquote в шапке (этот docs-коммит).
- `CHANGELOG.md` — уже закоммичен в составе IMPL (T5 `f7a89c32`), docs-коммит не трогает.
- Спека/план — на main до IMPL, IMPL не менял.

## Behavioral Delta

Ровно §3 спеки: закрытие вкладки/перезагрузка в окне отмены или во время отправки DELETE —
штатный браузерный диалог («Покинуть» = отмена с согласия, «Остаться» = окно дотикает и удаление
выполнится; страж спросит повторно); несколько незавершённых удалений закрывает одно
подтверждение; 401 → /login — тихая отмена без диалога (уход навязан системой); вне окон отмены
и отправок страж снят — страницу не трогает; SPA-навигация по админке диалог не поднимает
(конвейер переживает смену страницы намеренно). Окно отмены вне ухода (тост, кольцо,
«Отменить») — без изменений.

## References

- **GitHub Issue**: #397
- **Design Spec**: `docs/specs/2026-09-27-beforeunload-guard-397-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-27-beforeunload-guard-397-plan.md`
- **Related**: #285 (deferred record deletion — семантика окна rev8), #243 (unified deferred delete contract — обработка ошибок коммита), #141 (`useUnsavedChangesGuard` — исходный страж грязных форм), #345 (подключение 5 архивируемых сущностей к конвейеру — страж наследуется автоматически)
- **PR**: _(to be added after PR creation)_
