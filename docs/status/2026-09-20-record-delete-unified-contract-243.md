# GH #243 — Единый контракт удаления, фаза 1 (зона записи): payments + anonymous visits на deferred, честный тост ошибок без ответа сервера

- **Date**: 2026-09-20
- **Branch**: `record-delete-unified-contract-243`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `8b18b548` (main) — 12 commits incl. docs (`83a4f8db..`docs commit`), 17 files, +836 / −257
- **Issue**: #243 — fix(records): удаления визитов и платежей — при ошибке сервера экран расходится с сервером
- **Spec**: `docs/specs/2026-09-19-record-delete-error-rollback-243-design.md` (rev6, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-record-delete-unified-contract-243-plan.md` (8 tasks, on main, unchanged by IMPL)
- **Canon**: `docs/domain-rules/deletion.md` (already on main, unchanged by this branch)

## Goal

Закрыть #243 приведением зоны записи к единому отложенному контракту удаления:
две легаси-точки мгновенного удаления (платёж и анонимный визит на странице
клиентов) переводятся на существующие deferred-варианты с окном отмены 5 секунд,
мгновенные `deletePayment`/`deleteVisit` удаляются как мёртвый код, «Отменить»
возвращает строку на исходную позицию, а ошибка коммита без ответа сервера
получает честный текст тоста «Не удалось подтвердить удаление».

## Summary of Changes (per task)

- **T1 — платёж на странице клиентов → deferred (S1):** `ClientRecordTab.tsx`
  передаёт `deletePaymentDeferred` вместо мгновенного `deletePayment` в
  `onDeletePayment` — общий блок `RecordPaymentsTable` работает с тем же
  контрактом, что и соседняя поверхность (`83a4f8db`).
- **T2 — анонимный визит → deferred (S2):** `handleDeleteAnonymousVisit`
  вызывает `deleteVisitDeferred` вместо `deleteVisit`; локальный catch с тостом
  удалён — ошибками владеет общий пайплайн `PendingActionsContext`; счётчик
  анонимов derives от `record.visits`, откат возвращает значение корректно
  (`a960405e`).
- **T3 — мгновенные функции удалены как мёртвый код (S1/S2):** `deletePayment`
  и `deleteVisit` (и их экспорт) вырезаны из `useRecordMutations.ts`; их
  describe-блоки в `useRecordMutations.test.ts` удалены (включая блок
  «stepper −1 semantics (#257)», утверждавший противоположное миграции),
  helper-тесты переведены на deferred-пути, добавлен wiring-тест: анонимный
  визит и платежи используют deferred-варианты (мок `enqueuePendingAction`);
  grep по мгновенным вызовам — пусто (`60f7c839`).
- **T4 — «Отменить» возвращает строку на исходную позицию (S5):**
  `recordCacheSync` `upsertVisit`/`upsertPayment` запоминают исходный индекс
  строки в снимке, восстановление вставляет её на место вместо дописывания в
  конец — обе поверхности зоны записи, включая модалку расписания, оба ключа
  платежей (`['payments', recordId]` и глобальный `['payments']`) (`ad67d223`).
- **T5 — честный тост для ошибок без ответа сервера (S3):** дефолтный
  обработчик ошибок коммита в `PendingActionsContext` получил ветку по типу:
  не `ApiError` (ответа сервера не было) → «Не удалось подтвердить удаление»;
  `ApiError` → прежнее «Не удалось удалить. Изменение отменено»; 404 — тихий
  успех; возврат `undo()` в обеих ветках (`8e0ba449`).
- **T6 — компонентные тесты под deferred-контракт (S1/S2/S6):**
  `ClientRecordTab.{api,integration,interactions,layout}.test.tsx` — моки и
  утверждения мгновенной семантики (DELETE сразу после клика, без тоста)
  переведены на окно отмены; мёртвые stubs мгновенного `deletePayment` вычищены
  из layout/interactions-тестов (`2260693a`, часть `60f7c839`).
- **T7 — E2E (S1–S3 новые, S5/S6 регрессия):** `admin-manages-payments.spec.ts`
  — удаление платежа → тост отмены, «Отменить» возвращает строку;
  `anonymous-visits.spec.ts` — «−» → тост отмены + возврат;
  `records.spec.ts` — два перехвата DELETE после истечения окна: HTTP-ошибка →
  строка + «Не удалось удалить. Изменение отменено», обрыв (route abort) →
  строка + «Не удалось подтвердить удаление»; существующие deferred-шаги
  (US-M06 и др.) проаудированы на ожидание мгновенного DELETE (`2c017454`,
  cleanup `564bef61`).
- **T8 — финальная верификация:** полный прогон vitest, tsc, eslint, полный
  standalone e2e с триажем (см. Test Results).

## Scope Decision (architect, 2026-09-20)

Честный текст «Не удалось подтвердить удаление» применён **также** к
`staleAwareOnError` (поверхность записей, кастомный `onError`), выходя за
букву Task 5 плана (дефолтный обработчик `PendingActionsContext`). Основание:
спека S3 и Behavioral Delta («все отложенные удаления») — авторитетны. Прод-изменение —
`d06b7933`, доказано юнитом (`staleAwareOnError`) и e2e (records S3, route abort).

## Test Results

- **admin vitest (полный прогон):** **2196 passed / 0 failed** (139 файлов) —
  прирост от wiring-тестов deferred-путей и позиционного восстановления.
- **Type check:** `tsc --noEmit` clean.
- **ESLint:** 0 errors / 37 warnings (бюджет 38 — не превышен, все pre-existing).
- **E2E, полный standalone прогон:** **432 passed / 1 skipped / 20 failed** —
  все 20 и триажированы как env-обусловленные, ни одного продуктового:
  - 18 — visual pixel-diff от дрифта шрифтов/эмодзи-глифов контейнера против
    базлайнов CI Docker-образа (в ветке ноль CSS-изменений; класс известного
    #307-дрифта, CI — авторитетный merge-гейт);
  - 1 — copy-last-week S3: устаревшая seed-строка в общей overnight-БД
    (шардинг-инфра, к ветке отношения не имеет);
  - 1 — activity S5: реально связан с веткой (текст тоста при обрыве соединения)
    и **исправлен** в `3b9f7032` + `56743303`, повторно верифицирован зелёным.
- **Визуальный гейт:** CSS/визуальные базлайны веткой не затронуты — изменения
  поведенческие (контракт удаления, тосты).

## Acceptance Criteria (spec scenarios)

| Сценарий | Статус |
|---|---|
| S1 — удаление платежа (страница клиентов) с окном отмены 5 с | ✅ (`83a4f8db`; e2e + компонентные) |
| S2 — удаление анонимного визита («−») с окном отмены | ✅ (`a960405e`; e2e + компонентные) |
| S3 — честный тост при ошибке коммита без ответа сервера, строка возвращается | ✅ (`8e0ba449` дефолт, `d06b7933` staleAwareOnError; e2e route-abort) |
| S4 — 404 при коммите = тихий успех | ✅ (регрессия `PendingActionsContext.test.tsx`, без изменений) |
| S5 — «Отменить» возвращает строку на исходную позицию | ✅ (`ad67d223`; юниты recordCacheSync + useRecordMutations) |
| S6 — модалка расписания и именованные визиты — без изменений | ✅ (существующие deferred-спеки зелёные) |

## Key Files Changed

- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (T1/T2 wiring)
- `frontend/admin/hooks/useRecordMutations.ts` (мгновенные delete-функции удалены)
- `frontend/admin/lib/cache/recordCacheSync.ts` (позиционное восстановление)
- `frontend/admin/lib/staleAwareOnError.ts` (честный тост, scope decision)
- `frontend/admin/contexts/PendingActionsContext.tsx` (ветка текста ошибки по типу)
- Тесты: 8 файлов `__tests__/`, 4 e2e-спека.
- Бэкенд, миграции, `packages/api-client`, `packages/domain` — не тронуты.

## Docs Impact

- Спека + план на main, веткой не менялись; канон `deletion.md` на main актуален.
- `CHANGELOG.md` — новый `[Unreleased] — 2026-09-20` раздел (этот docs-коммит).
- `PLAN.md` — completion-blockquote + строка в таблице Priorities.

## Known Non-Blocking Observations

- Полный e2e-гейт — CI (PR): 18 локальных visual-диффов — контейнерный
  шрифтовой дрифт, CI-базлайны авторитетны.
- #330 (connection-state) остаётся в каноне `deletion.md` как связанный
  open item — новыми follow-up'ами ветка не обзавелась.
- Фазы 2–3 спеки (справочники и остальное приложение) — за рамками этой ветки.

## References

- **GitHub Issue**: #243
- **Design Spec**: `docs/specs/2026-09-19-record-delete-error-rollback-243-design.md` (rev6, on main)
- **Plan**: `docs/plans/2026-09-19-record-delete-unified-contract-243-plan.md` (on main)
- **Canon**: `docs/domain-rules/deletion.md` (on main)
- **PR**: _(to be added after PR creation)_
