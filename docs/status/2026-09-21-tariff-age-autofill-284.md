# GH #284 — Автоподстановка тарифа по возрастной группе посетителя

- **Date**: 2026-09-21
- **Branch**: `284-tariff-age-autofill`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `d652f84e` (main) — 9 commits (`7e76061a..8d778e0e`), 44 files, +2003 / −117
- **Issue**: #284 — feat(admin): дефолтный тариф по возрасту посетителя (автоподстановка)
- **Spec**: `docs/specs/2026-09-19-tariff-age-autofill-284-design.md` (on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-tariff-age-autofill-284-plan.md` (7 tasks, on main, unchanged by IMPL)
- **Canon**: `docs/domain-rules/services.md` (already on main, updated by the spec commit `93edacff`, unchanged by this branch)

## Goal

Админ перестаёт вручную править тариф в строке посетителя: при выборе возраста подставляется
первый тариф услуги с совпавшей возрастной группой («детский» для 3–11, «взрослый» для
остальных), ручной выбор остаётся возможным и всегда переподставляется при смене возраста.
Существующее поведение («первый в списке») сохраняется, пока тарифы не помечены.

## Summary of Changes (per task)

- **T1 (standard) — БД: колонка `audience` + миграция с бэкфиллом** (`7e76061a`):
  `backend/src/models/enums.py` — новый `TariffAudience(str, enum.Enum)` (`KID="kid"`,
  `ADULT="adult"`, `ALL="all"`); `backend/src/models/tariff.py` — колонка
  `audience: Mapped[str]` (`String(10)`, NOT NULL, `server_default="all"`); миграция
  `b3d5f7a9c1e8` (revises `a7b8c9d0e1f2`) добавляет колонку и бэкфиллит по **точному**
  названию (`lower(trim(title))`: «детский»→kid, «взрослый»→adult, всё остальное включая
  «единый» и названия с префиксом→all), мягко удалённые строки накрыты (фильтра нет);
  downgrade дропает колонку — бэкфилл необратим, принято. Тест миграции: каноничные
  названия, префикс («Детский билет» → all), мягко удалённая строка.
- **T2 (small) — Backend-схемы** (`8c9daac6`): `backend/src/schemas/service.py` —
  поле `audience` в `Tariff*`-схемах типизировано enum'ом (round-trip create/PUT/PATCH);
  неизвестная строка → 422. Тесты в `test_api_services.py` (+59).
- **T3 (small) — Контракты api-client + domain** (`e5f52f0b`):
  `packages/api-client/src/schemas.ts` (`TariffResponse`/`TariffCreate`) + fixture
  бэкенд-ответов; `packages/domain/src/index.ts` (`TariffSchema` + transformer'ы) — пометка
  не теряется на границе API и в админке.
- **T4 (standard) — Единый источник диапазона + резолвер** (`d365a5d0`): новый
  `frontend/admin/lib/age-groups.ts` — единственный источник диапазона «Дети» (3–11),
  из него собираются и опции `AgeSelect` («Дети»/«Подростки»), и классификатор; сентинел
  «Взрослый» остаётся строкой `'adult'`; новый `lib/tariff-resolver.ts`
  `resolveDefaultTariff(tariffs, age)` — 3–11 → первый `kid`; остальное (12–17, `'adult'`,
  пусто) → первый `adult`; нет совпадения → первый в списке (легаси-fallback, может
  пересекать группы); пустой список → тарифа нет; `all` **никогда** не целевая
  подстановка; «первый» = порядок API; функция чистая (повторный вызов — no-op).
  Unit-тесты всех ветвей (`age-groups.test.ts`, `tariff-resolver.test.ts`, +181).
- **T5 (standard) — Потребители на резолвер** (`51b7dd17` + фиксап `5c7ae86d`):
  `RecordVisitsTable.tsx` (`makeEmptyVisitRow`; обработчик смены возраста — ВСЕГДА повторный
  резолв, затирающий ручной выбор, и перезапись цены), `NewRecordTab.tsx`,
  `ClientRecordTab.tsx` (`addAnonymousVisit`), `AddVisitorForm.tsx`,
  `useRecordMutations.ts` (`defaultTariff` получает результат резолвера; мёртвый
  `firstTariff`-pick удалён) — дублирующих реализаций дефолта больше нет.
- **T6 (small) — ServiceModal: селект «возрастная группа»** (`6e9f3348`):
  `ServiceModal.tsx` + `serviceFields.tsx` — выпадающий «детский/взрослый/единый»
  (строчными) в строке тарифа, программная a11y-метка по названию тарифа, без валидации
  дубликатов групп.
- **T7 (large) — E2E, сиды, зачистка тестов** (`59f8dbeb` + рефактор `8d778e0e`):
  `e2e/tariff-age-autofill.spec.ts` (+533) — восемь сценариев спеки §4 (S1–S8);
  `backend/src/seed/seed.py` — тарифы получают audience в согласии с названиями
  («Взрослый»→adult, «Детский»→kid, нейтральный «Индивидуальный»→all);
  зачистка зацепившихся тестов по всем пакетам (backend/admin/web/api-client/domain),
  ни один тест не удалён «для зелени»; e2e-хелпер создания услуги делегирует
  `createTestService` (рефактор `8d778e0e`).

## Latent Bugs Found by E2E (both spec-required, TDD, compliance-verified)

Оба найдены при прогоне восьми сценариев и исправлены в T7 (`59f8dbeb`):

1. **Сохранённая строка показывала устаревший тариф.** После переподстановки в
   сохранённой строке патч уходил на сервер, но на экране до перерисовки из кэша оставался
   `formState` mount-момента. Фикс — синхронизация отображения (`handleChange('tariff_id'/
   'price')`) в ветке смены возраста сохранённой строки.
2. **Черновик, созданный до прихода тарифов, оставался без тарифа.** Резолвер по пустому
   списку возвращает `null`; когда тарифы приходили позже, новая строка «застревала» без
   тарифа. Фикс — `LateTariffsHealer`: одноразовый догон по null→resolved с резолвом по
   **текущему** возрасту строки (после первого исцеления `tariff_id` заполнен, явный выбор
   «— тариф —» пишет `''` и повторно не исцеляется).

## Test Results

- **Backend pytest (полный прогон):** **2331 passed / 0 failed / 15 skipped**.
- **Frontend vitest:** admin **2317/2317**, `packages/domain` **41/41**,
  `packages/api-client` **395/395**, `frontend/web` **347/347**.
- **E2E:** `tariff-age-autofill.spec.ts` — **8/8** сценариев (S1–S8); полный e2e-набор —
  CI при PR (авторитетный merge-гейт).
- **Type check / lint:** clean.
- **Визуальный гейт:** PASS — 3 скриншота (селект закрыт/открыт, автоподстановка в строке
  визита), `/tmp/opencode/284-visual/`.

## Acceptance Criteria (spec §3 Behavioral Delta / §4 scenarios)

| Критерий | Статус |
|---|---|
| S1 — возраст 6 → первый `kid`, цена детская | ✅ (e2e S1) |
| S2 — возраст 14 → первый `adult`, цена взрослая | ✅ (e2e S2) |
| S3 — неполный возраст (8) ведёт себя как 6 | ✅ (e2e S3) |
| S4 — ручной выбор затирается при смене возраста; возврат на «Взрослый» переподставляет | ✅ (e2e S4) |
| S5 — один «единый»: смены возраста не трогают тариф и цену | ✅ (e2e S5) |
| S6 — ничего не помечено: поведение идентично прежнему (первый в списке) | ✅ (e2e S6) |
| S7 — группы «детский/взрослый/единый» сохраняются и переживают переоткрытие | ✅ (e2e S7) |
| S8 — две детские «холсты»: первый `kid`, ручное переключение, 6→7 возвращает первый | ✅ (e2e S8) |
| Резолвер — единственный владелец правила дефолта у всех потребителей | ✅ |
| `all` никогда не участвует в целевой подстановке | ✅ |
| Пустой список тарифов → строки без тарифа | ✅ |
| Бэкфилл: «детский»→kid, «взрослый»→adult, остальное→all | ✅ (тест миграции + сид) |

## Key Files Changed

- `backend/alembic/versions/b3d5f7a9c1e8_add_audience_to_tariffs.py`, `backend/src/models/enums.py`,
  `backend/src/models/tariff.py`, `backend/src/schemas/service.py`, `backend/src/seed/seed.py`
- `frontend/admin/lib/age-groups.ts`, `frontend/admin/lib/tariff-resolver.ts` (новые)
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` (резолвер + догон тарифов)
- `frontend/admin/app/(main)/services/components/ServiceModal.tsx` + `serviceFields.tsx`
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`,
  `.../ActivityDetailsModal/NewRecordTab.tsx`,
  `.../shared/visitors/AddVisitorForm.tsx`, `frontend/admin/hooks/useRecordMutations.ts`
- `packages/api-client/src/schemas.ts`, `packages/domain/src/index.ts`
- `frontend/admin/e2e/tariff-age-autofill.spec.ts` (новый, 8 сценариев)
- Тесты: 19 файлов `frontend/admin/__tests__/**`, 2 файла `frontend/web/**/__tests__`,
  3 файла `backend/tests/**`, 2 файла контрактных тестов пакетов

## Docs Impact

- Спека + план — на main (`5d3a22d1`), веткой не менялись.
- `docs/domain-rules/services.md` — обновлён ещё spec-коммитом `93edacff` на main; по DoD
  плана правок канона больше не требуется.
- `CHANGELOG.md` — новый раздел `[Unreleased] — 2026-09-21` (этот docs-коммит).
- `PLAN.md` — completion-blockquote (этот docs-коммит).
- `docs/status/2026-09-21-tariff-age-autofill-284.md` — этот файл.

## Known Non-Blocking Observations

- Стабильного `tariff_id` нет: PUT услуги пересоздаёт тарифы (DELETE+CREATE) — существующее
  поведение; резолвер работает по живому списку тарифов в порядке API, контракта «стабильный
  id тарифа» спека не заводит.
- После миграции услуги с названиями вне канона («Детский билет», «единый» без пометки)
  получают `all` — автоподстановка для них выключена, сигнала об этом нет (осознанно).
- Полный e2e-набор — CI при PR: локальные visual-диффы контейнера — известный класс дрифта,
  CI-базлайны авторитетны.

## References

- **GitHub Issue**: #284
- **Design Spec**: `docs/specs/2026-09-19-tariff-age-autofill-284-design.md` (on main)
- **Plan**: `docs/plans/2026-09-19-tariff-age-autofill-284-plan.md` (on main)
- **Canon**: `docs/domain-rules/services.md` (on main, `93edacff`)
- **PR**: _(to be added after PR creation)_
