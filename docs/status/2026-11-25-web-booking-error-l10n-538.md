# GH #538 — Локализация booking-error по кодам ошибок (polish, web)

- **Date**: 2026-11-25
- **Branch**: `538-web-booking-error-l10n` (base `a19db0f2` = origin/main
  на момент форка; HEAD `626bb306`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `a19db0f2` — 3 задачи, 5 коммитов `8aef9738..626bb306`,
  7 файлов, +364/−14
- **Issue**: #538 — polish(web): блок отказа брони рендерит английский
  текст сервера для кодов, у которых сервер ещё не локализован (404
  `ACTIVITY_NOT_FOUND` — "Activity not found"; тарифная пара
  `TARIFF_REQUIRED`/`TARIFF_NOT_FOUND`). 409 `ACTIVITY_AT_CAPACITY` с
  #551 доезжает до клиента русским «Недостаточно мест» — фиксации
  подлежит только 404 (вариант А, Gate B 2026-11-24).
- **Спека**: `docs/specs/2026-10-25-web-booking-error-l10n-design.md`
  рев.2 — на main (`a19db0f2`); рев.3 создана правкой НА ВЕТКЕ
  (`626bb306`) по решению владельца (G4.5 override 2026-11-25) —
  VC-хинт «Индивидуальный МК» (ключ сида, в интерфейсе не рендерится)
  заменён статически рендерящимся заголовком карточки «Индивидуальный
  мастер-класс»; правка затронула только секцию Visual Compliance
  Checks, поведенческая часть без изменений.
- **План**: `docs/plans/2026-11-24-web-booking-error-l10n-538-plan.md` —
  на main (`a19db0f2`), 3/3 задач, все done, unchanged by IMPL

## Что выполнено

1. **Компонентная булавка утечки 404 (T1 `8aef9738`, trivial)** —
   `frontend/web/app/ui/__tests__/BookingOverlay.test.tsx`: RED на main
   пин — 404 `ACTIVITY_NOT_FOUND` протекал в блок отказа английским
   "Activity not found"; парная зелёная булавка 409 pass-through —
   серверный русский «Недостаточно мест» доходит до блока без
   переделки.
2. **Словарь `CODE_MESSAGES` (T2 `1fb9ad0b`, small)** —
   `frontend/web/app/lib/errors.ts`: словарь 3 кодов
   (`ACTIVITY_NOT_FOUND` → «Занятие не найдено», `TARIFF_REQUIRED` →
   «Выберите тариф для каждого места», `TARIFF_NOT_FOUND` →
   «Тариф не найден») + один промежуточный шаг в
   `structuredServerMessage` перед существующей логикой (код найден в
   словаре → текст словаря, иначе — прежний путь без изменений).
   Записи `ACTIVITY_AT_CAPACITY` нет — серверный русский текст
   проходит существующий pass-through; словарь сознательно НЕ полное
   зеркало admin-`CODE_DEFAULTS`. Юнит-покрытие расширено в
   `frontend/web/app/lib/__tests__/errors.test.ts`.
3. **E2E US-1/US-2 (T3 `eb65a1cf`, small)** — новый
   `frontend/web/e2e/booking-error-l10n.spec.ts`: US-1 — 409
   «Недостаточно мест» через реальный провод (сид-занятие capacity=1
   отдаёт единственное место первому сабмиту — 201; второй сабмит
   переоткрытой формы → 409 `ACTIVITY_AT_CAPACITY`, блок несёт
   серверный русский текст, английского нет); US-2 — занятие жёстко
   удаляется из тестовой БД (`sqlite-exec`, физический конечный
   стейт админского DELETE) между открытием формы и сабмитом → 404
   `ACTIVITY_NOT_FOUND` → словарный текст «Занятие не найдено» вместо
   английского серверного (T1 закрасил утечку RED, T2 починил, это
   e2e-булавка фикса). Фикстура
   `frontend/web/e2e/fixtures/seed-individual-activity.ts` —
   сид-занятие «Индивидуальный МК» (capacity=1, закреплено за
   сид-строкой) перенесено в достижимый слот недели. Оба теста на
   проектном storageState (OTP-логин сид-клиента c1 в globalSetup) —
   сабмит идёт сразу, без шага авторизации (#584 §4.2 перенёс ветку
   брони под `/my/client`; фильтр `waitForResponse` — по этому проводу).
4. **Попутный тест-хил (`6d622bf2`)** — устаревший wait-URL в
   `booking-closed-activity.spec.ts` (последствие #584: ветка брони
   переехала под `/my/client`) — однострочный; сломанный с тех пор
   спек оставался незамеченным, потому что web-e2e не выполняются в CI
   (`web-checks` = lint/type-check/unit).
5. **Правка спеки до рев.3 (`626bb306`)** — решение владельца
   (G4.5 override): машин-чек VC-секции перенесён со строки
   «Индивидуальный МК» (сид-алиас, никогда не рендерится) на заголовок
   статической карточки «Индивидуальный мастер-класс».

## Tests

- web unit (vitest) — **578/578**; `tsc --noEmit` чист.
- web-e2e на self-managed стеке: `booking-error-l10n.spec.ts` **2/2**,
  `booking-callcheck.spec.ts` **2/2**, `booking-closed-activity.spec.ts`
  **1/1** (хил подтверждён).
- Visual compliance gate — **exit 0** (1 машинная проверка passed,
  3 manual review по спеке).
- Приёмка: все DoD плана закрыты; US-3/US-4 — без e2e по спеке
  (состояния недостижимы через UI), US-5 покрыт существующими
  компонентными тестами.

## Известные остатки (follow-up-кандидаты, не в этом PR; issues не заводились)

- web-e2e спеки не выполняются в CI (`web-checks` = lint/type-check/
  unit) — именно поэтому однажды сломанный wait-URL
  `booking-closed-activity` оставался незамеченным. Кандидат на
  отдельный инфра-тикет.
- Несоответствие канона и парсера VC-хинтов в скилле design-phase:
  канон показывает «…»-гийемы как UI-текст-хинты и допускает `url=`
  на строке продолжения, парсер принимает только прямые ASCII-кавычки
  на физической строке чекбокса. Кандидат на харнесс-тикет.

## PR-заметки

- `Closes #538` — только в описании PR (канон репо), в коммиты не
  пишется.
- Спека рев.2 и план — на main (`a19db0f2`); рев.3 спеки идёт в PR
  веткой (`626bb306`); docser-коммит — только мета-доки (PLAN.md,
  CHANGELOG.md, этот файл).
- Доска: карточка #538 остаётся в текущем статусе до создания PR
  (перевод в `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only a19db0f2..626bb306`)

```
docs/specs/2026-10-25-web-booking-error-l10n-design.md
frontend/web/app/lib/__tests__/errors.test.ts
frontend/web/app/lib/errors.ts
frontend/web/app/ui/__tests__/BookingOverlay.test.tsx
frontend/web/e2e/booking-closed-activity.spec.ts
frontend/web/e2e/booking-error-l10n.spec.ts
frontend/web/e2e/fixtures/seed-individual-activity.ts
```

## References

- **GitHub Issue**: #538
- **Design Spec**: `docs/specs/2026-10-25-web-booking-error-l10n-design.md`
  (рев.2 на main; рев.3 — ветка, `626bb306`)
- **Plan**: `docs/plans/2026-11-24-web-booking-error-l10n-538-plan.md` (3/3)
- **Смежные**: #551 (409 «Недостаточно мест» — серверный текст,
  регрессионная булавка без изменений), #584 (ветка брони под
  `/my/client` — причина устаревшего wait-URL), #499 (гейт показа
  api-client ошибок в web)
- **PR**: _(to be added after PR creation)_
