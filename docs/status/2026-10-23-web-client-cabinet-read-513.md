# GH #513 — Клиентский кабинет: чтение /my (записи/фото/платежи) + три экрана

- **Date**: 2026-10-23
- **Branch**: `513-cabinet-read`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `ecbbe07f` (main) — 15 коммитов (`c6fae56b..691ff5bf`), 83 файла, +6374/−159
- **Issue**: #513 — продолжение клиентского кабинета #499 (срез чтения): после входа клиент видит в кабинете три раздела — «Мои записи», «Мои фото», «Мои платежи» — на трёх новых эндпоинтах `GET /api/v1/my/records|photos|payments`
- **Спека**: `docs/specs/2026-10-22-web-client-cabinet-read-design.md`
- **План**: `docs/plans/2026-10-22-web-client-cabinet-read-plan.md` — 10/10 задач, все done; порядок 1→2→3→4→5→6→7→8→9→10
- **Характер**: вертикальный срез backend + `packages/api-client` + `frontend/web` (+ сид-дельта и первый playwright-проект веба); гостевая галерея, админ-приложение и публичные контракты не меняются

## Что выполнено

1. **`GET /api/v1/my/records` (T1, `c6fae56b`, standard)** — записи кабинета
   клиента: per-endpoint схемы `MyRecordItem` + `MyVisitItem` (`id`,
   `activity_date`/`activity_start`/`activity_end` из начала+длительности
   занятия, `service_title`, `comment`, `visits[]` — `id`,
   `visitor_name: string | null`, `status`, `price`); цена-снапшот — визитовый
   `custom_price` при наличии, иначе сохранённый `price`, к тарифу не
   обращаемся (инвариант #357); фильтр владельца `user.client_id` под
   `require_client_session`; сортировка по началу занятия убыв. + `id` возр.,
   визиты по `id` возр.; вход — кирпич `PaginationParams`; роутер в сборке
   API. Фиксы: `1f87b41c` — `/my/records` в allowlist мастер-скоуп
   контракта (`test_master_scope_contract`), `3b5282eb` — имя визит-схемы
   `MyVisitItem` (из плана), `3f062aca` — докстринг модуля без устаревшей
   фразы.
2. **`GET /api/v1/my/photos` (T2, `2badd7c2`, small)** — все свои фото,
   включая непубличные, с `is_public`; владелец из клиентской сессии.
3. **`GET /api/v1/my/payments` (T3, `ee70168d`, small)** — история платежей
   с контекстом занятия (сумма, способ, дата, услуга).
4. **api-client (T4, `3f8c1d39`, small)** — per-endpoint типы и функции
   `listMyRecords` / `listMyPhotos` / `listMyPayments`; статус-юнионы
   переиспользуются из контракта.
5. **Сид-дельта (T5, `83ba745b`, small)** — непубличные фото для c1
   (`cabinet-draft.jpg`) и c2 (`maria-canvas.jpg`) — предпосылки С3 (фото
   кабинета) и С2 (изоляция от второго клиента); канон-тесты сида обновлены.
6. **E2E-инфраструктура web (T6, `486ca51d`, large)** — первый
   playwright-проект в `frontend/web`: собственный стек с портами из
   динамического окна e2e-канона, OTP-сессия-фикстура с восстановлением кода
   из БД, `storageState`, `globalSetup`, общий e2e-арсенал
   (`db-query`/`sqlite-exec`/`backend-url`/`db-path`/`stack-port`).
7. **Web — навигация кабинета + «Мои записи» (T7, `b240201c`, standard)** —
   `cabinet-nav` (три ссылки, активный раздел подсвечен) + экран
   `/cabinet/records` (`my-record-card`, `my-visit-status` — русские
   подписи статусов); С1, С5.
8. **Web — «Мои фото» (T8, `30560b0f`, standard)** — экран
   `/cabinet/records`-сиблинг `/cabinet/photos`: `my-photo-card` с бейджем
   «Опубликовано»/«Не опубликовано», статический render-path + 3 JPEG в
   `public/images/`; С3. Рефактор `53a6e091` — общие cabinet test-фикстуры
   (дедуп фабрик vitest-слоя).
9. **Web — «Мои платежи» (T9, `f3c42096`, standard)** — экран
   `/cabinet/payments`: `my-payment-row` (сумма, способ, дата, услуга) +
   `ListPagination`; С4.
10. **E2E — изоляция и замыкание (T10, `8cfc9da1` + `691ff5bf`,
    standard)** — `cabinet-isolation.spec.ts` (С2: сущности второго клиента
    отсутствуют на всех трёх экранах); харнес-шов — opt-in
    `VISUAL_STORAGE_STATE` в `scripts/visual-compliance-check.sh` для
    аутентифицированных визуальных проверок с валидацией формы storageState
    (битый shape → exit 2); смоук-сьют скрипта **8/8**.

## Верификация (финальные гейты)

| Проверка | Результат |
| --- | --- |
| Backend — полный pytest | **3677p/0f (44 skipped)** на `ee70168d`; после — таргет-сьют канона сида **43/0** |
| Web vitest | **486/486** |
| Web e2e (playwright) | **9/9** одиночным прогоном (С1–С5 + смоуки) |
| Визуальный гейт (`visual-compliance-check.sh`, §Visual Compliance Checks спеки — 5 якорей) | **exit 0 (5/5)** — с opt-in `VISUAL_STORAGE_STATE` |
| Admin | нетронут — базлайновый полный прогон **3100/0** |

## DoD-статус

- DoD всех 10 задач плана выполнен; сценарии С1–С5 спеки зелёные (web e2e).
- Behavioral Delta спеки доставлена целиком: три раздела кабинета живые;
  гостевая галерея, админ-приложение и публичные контракты не изменены.

## Ревью

- Все задачи прошли ревью (compliance + quality по классификации:
  1 standard · 2/3/4/5 small · 6 large · 7/8/9/10 standard) — зелёные.

## Отклонения от плана

Не зафиксированы: спека и план на ветке с базы (`ecbbe07f`), IMPL их не
менял; репью-фиксы (`1f87b41c`, `3b5282eb`, `3f062aca`, `53a6e091`,
`691ff5bf`) — в границах задач.

## Behavioral Delta

До: после входа (#523) клиент видел в кабинете только телефон и выход; свои
записи, фото и платежи недоступны нигде (чтение требовало staff-прав, фото —
только публичные в общей галерее). После: в кабинете три раздела — «Мои
записи» (дата/время, услуга, посетители со статусами и ценами), «Мои фото»
(включая непубличные, с признаком публикации), «Мои платежи» (сумма, способ,
дата, занятие). Гостевая галерея, админка и публичные контракты — без
изменений.

## PR-заметки

- `Closes #513` — только в описании PR (канон репо), в коммиты не пишется.
- Спека и план — на ветке с базы, IMPL их не менял.

## Тронутые файлы (`git diff --name-only ecbbe07f..691ff5bf`)

```
backend/scripts/lint_budget.py
backend/src/api/v1/my_reads.py
backend/src/main.py
backend/src/schemas/my.py
backend/src/seed/seed.py
backend/src/services/my_reads.py
backend/tests/test_list_id_uniform_guards.py
backend/tests/test_master_scope_contract.py
backend/tests/test_my_payments_read_api.py
backend/tests/test_my_photos_read_api.py
backend/tests/test_my_records_read_api.py
backend/tests/test_seed.py
frontend/web/.env.test
frontend/web/.gitignore
frontend/web/app/__tests__/cabinet-payments.test.tsx
frontend/web/app/__tests__/cabinet-photos.test.tsx
frontend/web/app/__tests__/cabinet-records.test.tsx
frontend/web/app/__tests__/cabinet.test.tsx
frontend/web/app/__tests__/fixtures/cabinet.tsx
frontend/web/app/__tests__/pages.test.tsx
frontend/web/app/cabinet/page.tsx
frontend/web/app/cabinet/payments/page.tsx
frontend/web/app/cabinet/photos/page.tsx
frontend/web/app/cabinet/records/page.tsx
frontend/web/app/hooks/__tests__/useMyPayments.test.tsx
frontend/web/app/hooks/__tests__/useMyPhotos.test.tsx
frontend/web/app/hooks/__tests__/useMyRecords.test.tsx
frontend/web/app/hooks/useCabinetAuth.ts
frontend/web/app/hooks/useMyPayments.ts
frontend/web/app/hooks/useMyPhotos.ts
frontend/web/app/hooks/useMyRecords.ts
frontend/web/app/lib/mappers/__tests__/to-my-payment-vm.test.ts
frontend/web/app/lib/mappers/__tests__/to-my-photo-vm.test.ts
frontend/web/app/lib/mappers/__tests__/to-my-record-vm.test.ts
frontend/web/app/lib/mappers/to-gallery-vm.ts
frontend/web/app/lib/mappers/to-my-payment-vm.ts
frontend/web/app/lib/mappers/to-my-photo-vm.ts
frontend/web/app/lib/mappers/to-my-record-vm.ts
frontend/web/app/lib/model/domain/payment-method.ts
frontend/web/app/lib/model/domain/visit-status.ts
frontend/web/app/lib/model/view/my-payments.ts
frontend/web/app/lib/model/view/my-photos.ts
frontend/web/app/lib/model/view/my-records.ts
frontend/web/app/ui/CabinetLogin.tsx
frontend/web/app/ui/CabinetNav.tsx
frontend/web/app/ui/CabinetSessionCard.tsx
frontend/web/app/ui/ListPagination.tsx
frontend/web/app/ui/MyPaymentRow.tsx
frontend/web/app/ui/MyPhotoCard.tsx
frontend/web/app/ui/MyRecordCard.tsx
frontend/web/app/ui/__tests__/CabinetNav.test.tsx
frontend/web/app/ui/__tests__/ListPagination.test.tsx
frontend/web/app/ui/__tests__/MyPaymentRow.test.tsx
frontend/web/app/ui/__tests__/MyPhotoCard.test.tsx
frontend/web/app/ui/__tests__/MyRecordCard.test.tsx
frontend/web/e2e/cabinet-isolation.spec.ts
frontend/web/e2e/cabinet-payments.spec.ts
frontend/web/e2e/cabinet-photos.spec.ts
frontend/web/e2e/cabinet-records.spec.ts
frontend/web/e2e/cabinet-smoke.spec.ts
frontend/web/e2e/fixtures/client-auth-state.ts
frontend/web/e2e/fixtures/db-query.ts
frontend/web/e2e/fixtures/otp-code.ts
frontend/web/e2e/fixtures/sqlite-exec.ts
frontend/web/e2e/globalSetup.ts
frontend/web/e2e/lib/backend-url.ts
frontend/web/e2e/lib/db-path.ts
frontend/web/e2e/lib/stack-port.ts
frontend/web/next.config.mjs
frontend/web/package.json
frontend/web/playwright.config.ts
frontend/web/public/images/cabinet-draft.jpg
frontend/web/public/images/client-work-1.jpg
frontend/web/public/images/client-work-2.jpg
frontend/web/scripts/e2e-stack.sh
frontend/web/scripts/test-e2e.sh
frontend/web/tsconfig.json
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
scripts/visual-compliance-check.sh
scripts/visual-compliance-check.smoke.test.sh
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-23-web-client-cabinet-read-513.md` — только мета-доки;
код/спеки/планы/domain-rules не тронуты.

## Scope guards

Гостевая галерея, админ-приложение и публичные контракты не менялись;
написание кабинета (мутации) не строилось; спека/план на ветке с базы,
docser их не касался; `Closes #513` — только в описании PR (канон репо).

## References

- **GitHub Issue**: #513
- **Design Spec**: `docs/specs/2026-10-22-web-client-cabinet-read-design.md`
- **Plan**: `docs/plans/2026-10-22-web-client-cabinet-read-plan.md` (10/10)
- **Предыдущий срез кабинета**: #499 — `docs/status/2026-10-21-web-client-auth-booking-499.md`
- **PR**: _(to be added after PR creation)_
