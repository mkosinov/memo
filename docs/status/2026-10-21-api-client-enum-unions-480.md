# GH #480 — Экспорт TS-юнионов перечислений контракта из `@memo/api-client` (удаление локальных копий в админке)

- **Date**: 2026-10-21
- **Branch**: `480-api-client-enum-unions`
- **Status**: Completed (PR pending — открывается после этого docs-коммита; CI-watch/merge на finishing/@manager)
- **Range**: base `eb62de07` — 6 коммитов (`b7dc85fc..a6a4b61e`), 51 файл +1111/−307
- **Issue**: #480 — TS-юнионы перечислений (статусы визитов/записей и др.) экспортируются из `@memo/api-client`, локальные переписывания в админке удалены
- **Спека**: `docs/specs/2026-10-20-api-client-enum-unions-design.md` (рев.2) — на main, unchanged by IMPL
- **План**: `docs/plans/2026-10-21-api-client-enum-unions-plan.md` — на main, unchanged by IMPL
- **Характер**: pure refactor, без UI-дельты (label `app:admin`); контракт (`packages/api-client`, `packages/domain`), админка, защитный backend-тест, `pnpm-lock.yaml`

## Что выполнено

1. **Именованные enum-схемы контракта + перепайка request-стороны (T1, `b7dc85fc`, standard)** —
   перечисления контракта стали именованными экспортируемыми zod-схемами в
   `@memo/api-client`; request-сторона эндпоинтов перепаяна на них.
2. **Строгие enum-ответы §3.3 + fail-closed парсинг авторизации (T2, `79cc514e`, standard)** —
   ответы парсятся строго по enum-схемам; парсинг auth-ответа — fail-closed.
3. **Замена локальных копий в админке §3.4 (T3, `acb33d5c`, standard)** —
   локальные дубликаты перечислений в `frontend/admin` заменены на импорты
   схем api-client.
4. **Чистка мёртвого кода §3.5 (T4, `94334a68`, small)** — мёртвые Wave-5
   экспорты удалены из `@memo/domain`.
5. **Защитные тесты (T5, `248bc23b` + `a6a4b61e`, small)** — backend parity-тест
   pydantic↔TS словарей перечислений (`backend/tests/test_api_client_enum_parity.py`)
   + pin полноты наборов статус-списков админки против
   `VisitStatusSchema.options` (§6).
6. **Полная локальная регрессия (T6, standard)** — прогон тестера, без кода.

## Approved deviation

Мёртвая опция оплаты «Онлайн» удалена из `RecordPaymentsTable.tsx`:
бэкенд всегда отклонял её с 422; строка §3.4 спеки требует
`PaymentMethodSchema.options` = cash/card/transfer; «ничего не меняется»
в §4 спеки опиралось на ошибочную ячейку колонки «Сегодня».
Санкционировано архитектором.

## Верификация

| Проверка | Результат |
| --- | --- |
| api-client vitest | **503/503** + tsc чист |
| admin vitest | **3107/3107** + tsc чист |
| domain | **37/37** + dts build |
| backend parity pytest | **6/6** |
| admin e2e (полный прогон) | **508/510** — 2 падения изолированно зелёные = флейки (одно — известная records-pagination гонка #479) |
| Сценарии 1–7 спеки | все зелёные |
| Визуальный комплаенс-гейт | N/A → exit 0 |

DoD плана выполнен полностью.

## Тронутые файлы (feature-диф `eb62de07..a6a4b61e`, 51 файл +1111/−307)

```
backend/tests/test_api_client_enum_parity.py           (новый)
packages/api-client/package.json
packages/api-client/src/endpoints.ts
packages/api-client/src/endpoints.test.ts
packages/api-client/src/index.ts
packages/api-client/src/schemas.ts
packages/api-client/src/schemas.test.ts
packages/domain/src/index.ts
packages/domain/src/index.test.ts
packages/domain/src/record.test.ts
pnpm-lock.yaml
frontend/admin/contexts/AuthContext.tsx
frontend/admin/contexts/RecordsContext.tsx
frontend/admin/hooks/useRecordMutations.ts
frontend/admin/lib/age-groups.ts
frontend/admin/lib/tariff-resolver.ts
frontend/admin/app/lib/status-utils.ts
frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx
frontend/admin/app/(main)/records/components/RecordsFilters.tsx
frontend/admin/app/(main)/records/useRecordsUrlState.ts
frontend/admin/app/(main)/services/components/serviceFields.tsx
frontend/admin/app/(main)/staff/components/StaffModal.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/NewRecordTab.tsx
frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx
frontend/admin/__tests__/…                              (27 файлов, вкл. новые
  admin-enum-lists.test.ts, cross-package-enum-parity.test.ts)
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-21-api-client-enum-unions-480.md` — только мета-доки;
код/спеки/планы не тронуты.

## Scope guards

Спека/план на main, docser их не касался; `Closes #480` — только в описании PR
(канон репо).

## References

- **GitHub Issue**: #480
- **Design Spec**: `docs/specs/2026-10-20-api-client-enum-unions-design.md` (рев.2)
- **Plan**: `docs/plans/2026-10-21-api-client-enum-unions-plan.md`
- **PR**: _(to be added after PR creation)_
