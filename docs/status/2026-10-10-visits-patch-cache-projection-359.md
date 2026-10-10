# GH #359 — PATCH посещения → кэш записи проекцией полей запроса

- **Date**: 2026-10-10
- **Branch**: `359-visits-patch-cache`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `91ba8fd2` — 4 коммита (`0ecc6541..9a49fa52`), 5 файлов, +906/−14
- **Issue**: #359 — ответ PATCH посещения применяется к кэшу записи проекцией полей
  запроса (только поля тела запроса + `updated_at`), per-field guard «последний
  выпущенный запрос побеждает»; смена статуса дополнительно проектирует своё поле
  с сохранением инвалидации записи (родительский бейдж). Frontend-only — сервер/API
  не тронуты.
- **Спека**: `docs/specs/2026-10-09-visits-patch-cache-projection-359-design.md` rev2
  (на main, unchanged by IMPL)
- **План**: `docs/plans/2026-10-10-visits-patch-cache-projection-359-plan.md` — 4/4 задач

## Что выполнено

1. **Helper проекции в `recordCacheSync` (T1, `0ecc6541`, small)** — проекция ответа
   PATCH посещения на обе формы кэша записи: применяются только поля тела запроса +
   `updated_at`, остальные поля ответа не затирают кэш; юнит-тесты `recordCacheSync.test.ts`
   (+178 строк).
2. **Счётчик правок и защита применения в `useRecordMutations` (T2, `8b03c568`, standard)** —
   per-field guard «last-issued-request-wins»: ответ устаревшего PATCH не перезаписывает
   поля, изменённые более поздним запросом; юнит-тесты `useRecordMutations.test.ts`
   (+226 строк дифа).
3. **E2E-спека `visits-patch-consistency.spec.ts` (T3, `941dfd51`, `9a49fa52`, standard)** —
   конкурентные PATCH посещений с управляемым порядком ответов (US-1..US-3);
   canonical-env-доводка — бюджет `test.slow` + ретрай навигации (`9a49fa52`).
4. **Регрессии превращения/undo e2e (T4, runs only, trivial)** — anonymous-visits 6/7 +
   US5 повтор зелёный (FLAKE: timeout-класс под нагрузкой, зелёный на реране; US-5 также
   зелёный через records.spec S1/S2), records S1/S2 2/2 зелёные.

## Acceptance criteria (спека §User Scenarios)

- US-1..US-3 — покрыты новой e2e-спекой (RED верифицирован против до-фиксного кода
  для US-1/US-3).
- US-4/US-5 — регрессионно верифицированы (US-4 core зелёный; US-5 зелёный через
  повтор + records S1/S2).
- Behavioral Delta — доставлен по спеке.
- Canon-правки (visits.md/records.md, правила #359) уже на main — док-работы не требовалось.

## Верификация

| Проверка | Результат |
| --- | --- |
| Admin vitest (TZ=UTC) | Task 1 — **3021 pass / 0 fail**; Task 2 полный прогон 3019/3026 (7 load-флейков в посторонних table-спеках, зелёные изолированно 155/155); таргет-сьюты на ревью 108/108 |
| Новая e2e `visits-patch-consistency` | **3/3 ×2** под canonical-вызовом (`BACKEND_URL`/`NEXT_PUBLIC_API_URL`=`http://127.0.0.1:8000`); прогоны ревью 3 passed (1.6m)/(1.9m) |
| Регрессии e2e | anonymous-visits 6/7 + US5 реран зелёный (FLAKE-классификация), records S1/S2 2/2 |
| Type-check | `tsc --noEmit` чист |
| Backend | не тронут (фича фронтендовая) |

## Тронутые файлы (`git diff --name-only 91ba8fd2..9a49fa52`)

```
frontend/admin/__tests__/recordCacheSync.test.ts
frontend/admin/__tests__/useRecordMutations.test.ts
frontend/admin/e2e/visits-patch-consistency.spec.ts
frontend/admin/hooks/useRecordMutations.ts
frontend/admin/lib/cache/recordCacheSync.ts
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-10-visits-patch-cache-projection-359.md` — только meta-доки, код/спеки/планы не тронуты.

## Scope guards

Backend, api-client, миграции, прод-контракты — без изменений; спека/план на main,
docser их не касался; untracked `backend/test_memo.db.canon.sql` — артефакт
тестового окружения, не коммитится; `Closes #359` — только в описании PR (канон репо).

## References

- **GitHub Issue**: #359
- **Design Spec**: `docs/specs/2026-10-09-visits-patch-cache-projection-359-design.md` (rev2)
- **Plan**: `docs/plans/2026-10-10-visits-patch-cache-projection-359-plan.md` (4/4)
- **PR**: _(to be added after PR creation)_
