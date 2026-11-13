# GH #598 — Модалка занятия (админ): постоянная высота 85dvh + кнопка «Создать» в футере

- **Date**: 2026-11-13
- **Branch**: `598-activity-modal-fixed-height` (HEAD `59b609c9`, rebased onto origin/main)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `ddd77447` — 3 коммита `f9d21df7..59b609c9`, 11 файлов, +840/−93
- **Issue**: #598 — контейнер модалки занятия держит постоянную высоту 85dvh во всех режимах (высота больше не «прыгает» при переключении вкладок), кнопка «Создать» закреплена в футере модалки (видна без прокрутки, кликабельна), владелец скролла — внутренние панели тела (клиппинг длинных вкладок #262 не возвращается). Frontend-only, суперсед #262, ратифицирован Gate B #595 (2026-11-12).
- **Спека**: `docs/specs/2026-11-12-activity-modal-fixed-height-598-design.md` (рев.2.1, Gate B approved) — на main (`9646f9f0`), unchanged by IMPL
- **План**: `docs/plans/2026-11-12-activity-modal-fixed-height-598-plan.md` — 3/3 задач, все done — на main, unchanged by IMPL
- **Domain rules**: `docs/domain-rules/activities.md` — тестид скролл-тела (`scroll-body`) дополнен в `a8bd316a`

## Что выполнено

1. **Modal `heightClass` + замок dvh (T1, `f9d21df7` small)** — общий
   `Modal` (`shared/modal/Modal.tsx`) получает опциональный проп
   `heightClass`: фикс-высота контейнера, дополняющая базовый max-h
   потолок (не заменяет его). Замок `ModalShell.test.tsx` переписан:
   без пропа контейнер НЕ содержит фикс-класса — запрет расширен с `vh`
   на `vh` **и** `dvh`, якорный паттерн сохранён (иначе матчер ловил бы
   `h-[85vh]` внутри `max-h-[85vh]`); константа вынесена в
   `shared/modal/constants.ts`.
2. **Фикс-высота, скролл-владелец, футер «Создать» (T2, `a8bd316a`
   standard)** — `ActivityDetailsModal` передаёт `h-[85dvh]` во всех
   режимах (edit/create); владелец скролла перенесён с шелла на
   внутренние div-панели (`min-h-0` + `overscroll-contain`), скроллящееся
   тело получило `data-testid="activity-details-modal-scroll-body"` —
   дефект-2 #262 (клиппинг контента overflow-hidden шеллом) не
   воспроизводится. Кнопка «Создать» переехала из inline-низа
   скроллящегося тела `CreateActivityTab` в постоянный футер `Modal`
   через минимальный мост `canSave`/`submit` (по образцу
   `onSavingChange` — без подъёма формы наверх и без `<form>`;
   Enter-сабмит сознательно не заявляется — формы во вкладке нет);
   inline-кнопка удалена, testid `btn-create-activity` сохранён —
   существующие e2e-нажатия не менялись. Матрица гейтов
   canSave/submit-payload (~10 тестов) пере-домена из
   `CreateActivityTab.test.tsx` в `ActivityDetailsModal.test.tsx`
   (рендер панели с футером — покрытие гейтов не теряется и не
   дублируется), контракт моста замокнут в старом доме.
3. **E2E US-1/US-2/US-3 (T3, `59b609c9` standard)** — US-1 в
   `modal-no-jump.spec.ts`: контейнер ≈85% высоты окна в обоих режимах
   + инвариант смены вкладок 5px (#156), дискриминирующие данные —
   запись с 15 посещениями даёт заведомо разную натуральную высоту
   вкладок (без этого тест зелёный и при авторазмере). US-2 в
   `dayview-slot-create.spec.ts`: геометрия футера create-потока —
   bbox кнопки внутри bbox модалки и вне bbox скролл-тела, hit-test
   `elementFromPoint` в центре кнопки, bbox футера в вьюпорте; без
   сабмита (ничего не создаётся). US-3 в `activity-details-modal.spec.ts`
   (сценарий 15): длинная клиентская вкладка (15 визитов) прокручивается
   до последнего ряда и блока комментариев — до-#598 шелл клипал
   контент из достижимости. Фабрика активности получила `capacity:20`
   (иначе create-guard 409 на занятость — домен `records.md`); после
   ребейза на #595 e2e create-потока объединены семантически с
   мультилокационным флоу (чекбоксы локаций #595).

## Отклонения и особенности

- **Визуальный гейт G4.5 — генерик-раннер exit 1 структурный**: оба
  §9-чека целят DOM модалки занятия, который рендерится только после
  клика; раннер не кликает (канон харнесса #602). Fallback
  pair-visual-debugging Playwright-прогон: **12/12 PASS** (высота
  612px = 0.85×720 точно в обоих режимах; инвариант смены вкладок
  Δ=0.0px ≤ 5px; кнопка вне bbox скролл-тела; elementFromPoint →
  кнопка; футер в вьюпорте). Скриншоты: `/tmp/visual-compliance-598/fallback/`.
- **Перегонка визуальных базлайнов** — фикс-высота закономерно меняет
  снапшоты модалки; регенерация — CI-only шаг после пуша
  (`update-snapshots.yml`). Красный visual CI до этого шага ожидаем и
  задокументирован, НЕ дефект ветки.
- **Пересечение с #595** — семантически независимые правки одного
  `CreateActivityTab` (здесь мост canSave/submit + футер, там чекбоксы
  локаций); ветка ребейзнута на origin/main (содержит #595), e2e
  объединены; откат любого PR не ломает другой (спека §10).

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| admin vitest — три затронутых сьюта (`ModalShell`/`ActivityDetailsModal`/`CreateActivityTab`) | **133/133** |
| `tsc --noEmit` | чист |
| e2e US-1/US-2/US-3 | закоммичены, гейт PR CI (шарды) |
| Визуальные базлайны | регенерация CI-only после пуша (`update-snapshots.yml`) |
| Визуальный гейт G4.5 | генерик-раннер exit 1 — структурный (канон #602); fallback Playwright **12/12 PASS** |

## Ревью

- T1 — small (1-stage), T2/T3 — standard (two-stage); ревью пройдены,
  фикс-коммитов нет.

## Behavioral Delta

Высота модалки занятия: авторазмерная ≤85vh с «прыжками» между вкладками
→ постоянная `h-[85dvh]` во всех режимах. Кнопка «Создать»: inline внизу
скроллящегося тела → постоянный нижний футер, видна без прокрутки и
кликабельна. Клиппинг контента на длинных вкладках: возможен → тело
владеет скроллом, контент достижим. Остальные модалки, API, домен,
api-client — без изменений; пустое место на коротких формах принято
осознанно (плата за постоянство высоты, спека §10).

## PR-заметки

- `Closes #598` — только в описании PR (канон репо), в коммиты не пишется.
- Спека (рев.2.1) и план (3/3) — коммиты main (`9646f9f0`), unchanged by
  IMPL; дом-правила `activities.md` — тестид скролл-тела в `a8bd316a`.
- После пуша: перегонка базлайнов бот-раннером `update-snapshots.yml`
  (ожидаемо красный visual CI до этого шага — задокументировано выше).
- Бэкенд, api-client, модель, миграции — ноль изменений (frontend-only).

## Тронутые файлы (`git diff --name-only ddd77447..59b609c9`)

```
docs/domain-rules/activities.md
frontend/admin/__tests__/ActivityDetailsModal.test.tsx
frontend/admin/__tests__/CreateActivityTab.test.tsx
frontend/admin/__tests__/ModalShell.test.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/CreateActivityTab.tsx
frontend/admin/app/components/shared/modal/Modal.tsx
frontend/admin/app/components/shared/modal/constants.ts
frontend/admin/e2e/activity-details-modal.spec.ts
frontend/admin/e2e/dayview-slot-create.spec.ts
frontend/admin/e2e/modal-no-jump.spec.ts
```

## References

- **GitHub Issue**: #598
- **Design Spec**: `docs/specs/2026-11-12-activity-modal-fixed-height-598-design.md` (рев.2.1)
- **Plan**: `docs/plans/2026-11-12-activity-modal-fixed-height-598-plan.md` (3/3)
- **Domain rules**: `docs/domain-rules/activities.md`
- **Смежные**: #262 (суперсед — фикс-высота модалки), #595 (пересечение в `CreateActivityTab`, ребейз-база), #156 (инвариант no-jump 5px), #602 (канон харнесса: генерик-раннер не кликает), #280 (канон create-формы)
- **PR**: _(to be added after PR creation)_
