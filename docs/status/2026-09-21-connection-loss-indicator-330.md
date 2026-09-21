# GH #330 — Потеря связи с сервером: явный индикатор + таймауты запросов

- **Date**: 2026-09-21
- **Branch**: `330-connection-loss-indicator`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `6877d175` (main) — 7 commits (`ecbecf99..ed56d6bd`), 16 files, +1117 / −15
- **Issue**: #330 — Потеря связи с сервером: явный индикатор + таймауты запросов
- **Spec**: `docs/specs/2026-09-19-connection-loss-indicator-330-design.md` (rev2, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-connection-loss-indicator-330-plan.md` (7 tasks, on main, unchanged by IMPL)

## Goal

Админка больше не молчит при устойчивой потере связи: после 5 секунд непрерывного
отказа SSE-канала (источник правды — #239) показывается один персистентный тост
«Нет соединения с сервером. Обновления приостановлены.», который сам скрывается при
восстановлении. Зависшие запросы обрываются на клиенте через `AbortSignal.timeout`,
а пока канал лежит — транспортные тосты «Ошибка сети» дедуплицируются.

## Summary of Changes (per task)

- **T1 — `parseApiError` + классификаторы:** новые ветки таймаута/отмены
  (`AbortError`/`TimeoutError`) и `isNetworkError`/`isAbortClass`; отдельный текст
  «Превышено время ожидания запроса» (`ecbecf99`).
- **T2 — таймауты api-client:** `AbortSignal.timeout` в общем api-client — 30 с для
  обычных запросов, 120 с для FormData-загрузок; ошибки timeout/abort не ретраятся
  (наследуется и веб-витриной — вариант A, одобрен пользователем) (`6c9cceb7`).
- **T3 — персистентный тост:** параметр `persistent` у `showToast` + ветка в
  `ToastContainer` — без крестика, без авто-скрытия и вне лимита «видимо 5»
  (не вытесняется очередью) (`c8890478`).
- **T4 — `connectionHealth` + детект в SSE-провайдере:** модуль
  `app/lib/connectionHealth.ts` (дебаунс 5 с: дрожь < 5 с молчит) + машина состояний
  в `ServerEventsProvider` — один тост при устойчивом отказе, авто-скрытие при
  восстановлении; тихий реконнект не изменён (`b19e607e`).
- **T5 — дедуп транспортных тостов + retry-предикат:** гейт в `providers.tsx`
  подавляет транспортные тосты («Ошибка сети») только пока канал лежит; тосты
  `ApiError` 4xx/5xx и per-action тосты мутаций не затронуты; предикат ретраев
  исключает timeout/abort (`6be0324d`).
- **T6 — e2e server-push:** расширены `server-push-offline.spec.ts` (S1/S2/S3/S6)
  и `server-push-invalidation.spec.ts` (S5 — негативный сценарий инвалидации);
  хелперы в `fixtures/server-push.ts` (`4e25624b`).
- **T7 — фиксы + финальная верификация:** 1 итерация правок — холодный старт abort
  в S5 + гигиена `try/finally`/`unroute` (`ed56d6bd`), затем полный DoD-прогон
  (см. Test Results).

## Test Results

- **admin vitest (полный прогон):** **2299 passed / 0 failed** (143 файла).
- **api-client vitest:** **392 passed / 0 failed** (включая новые тесты таймаутов).
- **Type check:** `tsc --noEmit` clean (admin + api-client build via tsup clean).
- **ESLint (admin):** 0 errors / 36 warnings (бюджет `--max-warnings 38` — не превышен).
- **E2E targeted (server-push ×2):** 9/9 (2.6 мин).
- **Полный e2e (`test-all.sh`):** shard-schedule **123 passed** (21.9 мин) +
  shard-rest **321 passed** (36.0 мин); pytest **2324 passed / 15 skipped** —
  ноль новых красных.
- **Ручной S4-пробинг:** заблокированный запрос оборван на ~33.5 с (30 с таймаут +
  навигация), тост «Превышено время ожидания запроса» наблюдён, `blocked=1`
  (ретраев нет).
- **Визуальный гейт:** поверхность тоста — поведенческая, CSS-базлайны не менялись.

## Acceptance Criteria (spec §8 scenarios)

| Сценарий | Статус |
|---|---|
| S1 — устойчивый отказ SSE ≥ 5 с → один персистентный тост «Нет соединения с сервером. Обновления приостановлены.» | ✅ (e2e `server-push-offline.spec.ts`) |
| S2 — дрожь < 5 с молчит (дебаунс не срабатывает) | ✅ (e2e) |
| S3 — восстановление → тост скрывается автоматически | ✅ (e2e) |
| S4 — зависший запрос обрывается на 30 с (120 с FormData), тост «Превышено время ожидания запроса», без ретраев | ✅ (api-client юниты + ручной пробинг) |
| S5 — негативный сценарий инвалидации: пока канал лежит, транспортные тосты не спамят | ✅ (e2e `server-push-invalidation.spec.ts`) |
| S6 — персистентный тост не закрывается крестиком и не вытесняется лимитом «5» | ✅ (юниты UIContext/ToastContainer + e2e) |

## Key Files Changed

- `frontend/admin/app/lib/connectionHealth.ts` (новый модуль — дебаунс/состояние канала)
- `frontend/admin/app/ServerEventsProvider.tsx` (детект потери связи + персистентный тост)
- `frontend/admin/app/lib/api/parseApiError.ts` (ветки timeout/abort + классификаторы)
- `frontend/admin/contexts/UIContext.tsx` (`persistent`-тост)
- `frontend/admin/app/components/toast/ToastContainer.tsx` (без крестика/вытеснения)
- `frontend/admin/app/providers.tsx` (гейт дедупа + retry-предикат)
- `packages/api-client/src/client.ts` (таймауты 30 с / 120 с)
- Тесты: 5 расширенных unit-файла admin + 2 api-client + `e2e/fixtures/server-push.ts`
  + 2 e2e-спека.
- Бэкенд, миграции, `packages/domain` — не тронуты; серверных изменений нет.

## Docs Impact

- Спека + план на main, веткой не менялись.
- `CHANGELOG.md` — новый `[Unreleased] — 2026-09-21` раздел (этот docs-коммит).
- `PLAN.md` — completion-blockquote.
- `docs/design-system.md` — персистентный тост уже описан спек-коммитом `133e920a` (on main).

## References

- **GitHub Issue**: #330
- **Design Spec**: `docs/specs/2026-09-19-connection-loss-indicator-330-design.md` (rev2, on main)
- **Plan**: `docs/plans/2026-09-20-connection-loss-indicator-330-plan.md` (on main)
- **PR**: _(to be added after PR creation)_
