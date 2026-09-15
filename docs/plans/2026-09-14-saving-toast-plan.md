# План: #261 «Сохраняем…» как тост общего стека

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Плашка «Сохраняем…» в Topbar заменяется тостом в общем стеке: новый общий вид `loading` (спиннер, без таймера, без кнопки закрытия, вне лимита «видимо 5»), хук `useSavingToast` показывает один тост на пачку мутаций расписания и снимает его по завершении (успех и ошибка). Результатные тосты не меняются.

**Architecture:** Три слоя изменений. (1) `UIContext` — `'loading'` в `ToastKind`, в `showToast` ветка «loading → таймер не заводится», `showToast` начинает **возвращать id** (раньше `void`; обратно совместимо — существующие вызовы игнорируют возвращаемое, но хуку нужен id для `hideToast`). (2) `ToastContainer` — рендер вида `loading` (спиннер `aria-hidden`, без кнопки закрытия, явная рамка в `BORDER_BY_KIND`) и вывод `loading`-тостов за лимитом `slice(-5)` (D5a). (3) Хук `useSavingToast` (`useMutationState` по `SCHEDULE_ACTIVITY_MUTATION_KEY`, id в ref, unmount-cleanup) + удаление чипа из Topbar с сохранением `useUnsavedChangesGuard(isSaving)`.

**Tech Stack:** React 18 / Next 14 / Tailwind 3.4, TanStack Query v5, vitest+jsdom (unit), Playwright (e2e, проект shard-schedule).

**Спека:** `docs/specs/2026-09-14-saving-toast-design.md` (rev2).

**Хард-гейт:** IMPL стартует **только после мержа #258/#259** (общие файлы `WeekView.tsx` / `DayView.tsx` / `ScheduleDataContext.tsx`). Проверка — Task 0. Файлы #260 (z-токены в `ToastContainer.tsx:21`, `data-testid="toast-container"`) не блокируют: строки в основном непересекающиеся; перед каждым коммитом — `git pull --rebase origin main`.

---

## Behavioral Delta

Как это поведёт себя для пользователя (маппинг на сценарии спеки):

- **Сценарий S1:** создаю занятие — во время запроса в стеке тостов (справа внизу) появляется «Сохраняем…» со спиннером; после успеха оно исчезает, следом появляется «Создано: …». Сейчас вместо этого в шапке мигает отдельная плашка.
- **Сценарий S2:** меняю занятие (drag или правка в модалке) — тот же тост на время update-мутации, по завершении исчезает.
- **Сценарий S3:** стартую вторую операцию, пока первая в полёте — тост по-прежнему один; гаснет только когда обе завершились.
- **Сценарий S4:** сервер отклоняет операцию — «Сохраняем…» исчезает, появляется красный тост ошибки. Висящего индикатора нет.
- **Сценарий S5:** удаляю занятие — «Сохраняем…», затем (последовательно) тост «удалено» с кнопкой отмены на 5 с.
- **Без изменений:** тексты и тайминги существующих тостов (4500/5000 мс), guard «не уйти со страницы посреди сохранения» (beforeunload), поведение тостов вне расписания, локальная блокировка кнопки в модалке создания из #258/#259 (`onSavingChange` — соседствует с тостом намеренно, слои разные).

## Структура файлов

**Создаётся:** `frontend/admin/hooks/useSavingToast.ts`; `frontend/admin/__tests__/useSavingToast.test.tsx`; `frontend/admin/e2e/schedule-saving-toast.spec.ts`.
**Изменяется:** `frontend/admin/contexts/UIContext.tsx`; `frontend/admin/app/components/toast/ToastContainer.tsx`; `frontend/admin/app/components/layout/Topbar.tsx`; `frontend/admin/__tests__/UIContext.test.tsx`; `frontend/admin/__tests__/ToastContainer.test.tsx`; `frontend/admin/__tests__/Topbar.test.tsx`; `frontend/admin/e2e/fixtures/helpers.ts`; `CHANGELOG.md`.
**Удаляется:** `frontend/admin/__tests__/Topbar.saving-indicator.test.tsx`.

---

## Task 0: Гейт — #258/#259 в main

### Classification: trivial

### Required Docs
- `docs/specs/2026-09-14-saving-toast-design.md` — §9 (связи и очерёдность)

### Steps

- [ ] `gh issue view 258 --json state,stateReason` и `gh issue view 259 --json state,stateReason` — оба `state: CLOSED`, `stateReason: COMPLETED`. Если хоть один открыт — **STOP**, доложить менеджеру/юзеру, не начинать код.
- [ ] `git pull --rebase origin main`; убедиться, что `frontend/admin/contexts/schedule/ScheduleDataContext.tsx` содержит версию с коллбеками `addActivity` из #258/#259 (второй аргумент-объект с `onSuccess`/`onError`/`onSavingChange`).

### DoD
- Оба issue закрыты как выполненные; рабочая ветка на актуальном main.

---

## Task 1: UIContext — вид `loading` без таймера

### Classification: small

### Required Docs
- `docs/specs/2026-09-14-saving-toast-design.md` — §3 D1 (4 точки механики), §4
- `frontend/admin/__tests__/UIContext.test.tsx` — существующие ассерты автоскрытия (`:168` — 4500 мс)

### Steps

- [ ] `UIContext.tsx:5`: `export type ToastKind = 'info' | 'success' | 'error' | 'loading';`
- [ ] `showToast`: возвращаемый тип `void` → `string` — вернуть созданный `id` (`toast-${Date.now()}-${random}`, `:63`). Все существующие вызовы (40+) возвращаемое значение игнорируют — это обратно совместимое расширение сигнатуры; правки вызовов не нужны. **Обязательное условие для Task 4** (хук хранит возвращённый id в ref) — не пропускать этот шаг; после шага прогнать `tsc --noEmit` по админке (типов, зависящих от старой сигнатуры, ожидаемо ноль — при появлении поправить).
- [ ] Блок автоскрытия (`:65-70`): заворачивается в условие — таймер заводится **только если** вид не `loading` (`if (kind !== 'loading') { setTimeout(...) }`). Таймер-мапа и `hideToast` (`:73-80`) без изменений: у `loading` таймера нет, `clearTimeout` по отсутствующему id безопасен (проверить фактическую форму хранения таймеров и сохранить её).
- [ ] Тесты `UIContext.test.tsx` — добавить: (а) `showToast('x', 'loading')` — тост **не** удаляется после `vi.advanceTimersByTime(60_000)`; (б) `hideToast(id)` снимает его; (в) `showToast` возвращает id, совпадающий с удалённым через `hideToast`. Существующий ассерт 4500 мс (`:168`) не меняется — он фиксирует неизменность дефолтов остальных видов.

### DoD
- `vitest` зелёный; вид `loading` живёт без таймера, снимается только `hideToast(id)`; `showToast` возвращает id (покрыт тестом (в)); дефолтные тайминги info/success/error не изменились; `tsc --noEmit` чист.

---

## Task 2: ToastContainer — рендер `loading` + вне лимита 5 (D5a)

### Classification: small

### Required Docs
- `docs/specs/2026-09-14-saving-toast-design.md` — §3 D1 (точки 3–4), D5, D5a; §4 (a11y)
- `docs/design-system.md` — токены/стили тостов
- `frontend/admin/app/components/layout/Topbar.tsx:338-363` — SVG-спиннер чипа, который переиспользуется (до удаления в Task 4)

### Steps

- [ ] `BORDER_BY_KIND` (`:13-17`): добавить явную запись `loading` с тем же значением, что у `info` (нейтральная рамка; без записи вид упадёт в дефолт — специка требует явности).
- [ ] Кнопка закрытия (`:43-49`): не рендерится при `toast.kind === 'loading'`.
- [ ] Рендер `loading`: перед сообщением — SVG-спиннер, скопированный из чипа `Topbar.tsx` (класс `animate-spin`), обёрнут с `aria-hidden="true"`.
- [ ] D5a — лимит: `const visible = toasts.slice(-5)` (`:11`) заменить на: обычные тосты — последние 5 в исходном порядке, `loading`-тосты всегда видимы и остаются на своём **хронологическом** месте (как обычные — «новые снизу»; формулировка issue: «складывается в стопку как остальные»):
  ```ts
  const loading = toasts.filter((t) => t.kind === 'loading');
  const visible = [...toasts.filter((t) => t.kind !== 'loading').slice(-5), ...loading];
  ```
- [ ] Тесты `ToastContainer.test.tsx` — добавить: (а) при 7 накопленных обычных тостах + 1 `loading` видны `loading` и последние 5 обычных; (б) у `toast-loading` нет кнопки `[aria-label="Закрыть"]`; (в) спиннер присутствует и `aria-hidden="true"`; (г) testid `toast-loading` из шаблона `:28`. Тест-хелпер файла (`renderWithToasts`) принимает сейчас только один вид — расширить его для приёма списка `{ message, kind }`.

### DoD
- `vitest` зелёный; `loading`-тост рисуется со спиннером, без кнопки закрытия, не вытесняется лимитом; обычный стек (max 5, новые снизу) не изменился.

---

## Task 3: e2e RED — schedule-saving-toast.spec.ts + хелпер задержки

### Classification: standard

### Required Docs
- `docs/specs/2026-09-14-saving-toast-design.md` — §6 (S1–S5), §7 (тест-план)
- `docs/tests_workflow.md` — локальный прогон e2e (стек на 3004/8001, workers=1)
- `frontend/admin/e2e/fixtures/test.ts` — авто `seedReset` и storageState
- `frontend/admin/e2e/fixtures/helpers.ts:297` — существующий паттерн ожидания тоста по `[role="status"]` / `[data-testid^="toast-"]`
- Спека/план #258/#259 — флоу создания через модалку (клик по пустому слоту → ActivityDetailsModal в create-режиме)

### Task Description

Спецификация пяти сценариев пишется **до** хука (Task 5): без хука тост «Сохраняем…» не появляется никогда, поэтому S1–S5 обязаны упасть (RED) на не-GET ожиданиях тоста. Имя `schedule-saving-toast.spec.ts` попадает в проект shard-schedule (`testMatch: /schedule[^/]*/`, `playwright.config.ts:118`) — регистрация не нужна. Ключевой приём: хелпер задержки мутационных запросов делает окно «Сохраняем…» детерминированным.

### Steps

- [ ] `frontend/admin/e2e/fixtures/helpers.ts` — добавить хелпер (GET-запросы пропускаются через `route.continue()` — паттерн `materials-delete.spec.ts:92`, `error-messages.spec.ts:128`):
  ```ts
  export async function delayActivityMutations(page: Page, ms = 1500) {
    await page.route('**/api/v1/activities*', async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      await new Promise((r) => setTimeout(r, ms));
      return route.continue();
    });
  }
  ```
  GET-запросы загрузки сетки не задерживаются; задерживаются только POST/PATCH/DELETE.
- [ ] Создать `frontend/admin/e2e/schedule-saving-toast.spec.ts` с пятью тестами (все с `delayActivityMutations`):
  - **S1:** открыть `/schedule`, создать занятие через клик по пустому слоту и сохранение в модалке; после сабмита `expect(page.getByTestId('toast-loading')).toBeVisible()`; после ответа — `toast-loading` скрыт, виден тост с текстом «Создано: …».
  - **S2:** открыть существующее занятие в модалке (edit), изменить и сохранить; во время ответа виден `toast-loading`, после — скрыт.
  - **S3:** создать занятие, и пока первый запрос в полёте (в окне задержки), создать второе; на протяжении обеих операций виден ровно один `toast-loading` (`expect(await page.getByTestId('toast-loading').count()).toBe(1)`), после обоих ответов — скрыт.
  - **S4:** перехват на создание отвечает 500 (`page.route` с `route.abort()` или `fulfill({ status: 500 })`); создать занятие — `toast-loading` появляется и затем исчезает, появляется тост ошибки; `toast-loading` не остаётся висеть.
  - **S5:** удалить занятие через карточку (DeleteDialog); во время удаления виден `toast-loading`; после — скрыт и виден undo-тост («удалено»).
- [ ] Прогнать: все пять падают на отсутствии/ожидании `toast-loading` (RED по правильной причине — не на селекторах сетки или логине). Зафиксировать вывод прогона.

### DoD
- 5 e2e существуют, попадают в shard-schedule, падают только из-за отсутствия индикатора (RED-GREEN подход: RED зафиксирован до Task 5).

---

## Task 4: Хук useSavingToast + Topbar без чипа (GREEN) + уборка unit-тестов

### Classification: standard

### Required Docs
- `docs/specs/2026-09-14-saving-toast-design.md` — §3 D2–D4, D7; §4
- `frontend/admin/app/components/layout/Topbar.tsx:55-59,338-363` — текущий флаг `isSaving`, guard, удаляемый чип
- `frontend/admin/__tests__/Topbar.test.tsx:321-355`, `Topbar.saving-indicator.test.tsx`, `CellHeight.Topbar.test.tsx:40` — уборка
- `docs/design-system.md` — стили тостов

### Steps

- [ ] Создать `frontend/admin/hooks/useSavingToast.ts`:
  ```ts
  const IN_FLIGHT = new Set(['pending']); // v5: пауза (офлайн) — это state.isPaused=true при status 'pending',
                                          // так что подсчёт 'pending' покрывает и paused (спека D2: «pending или paused»)
  export function useSavingToast() {
    const { showToast, hideToast } = useUI();
    const statuses = useMutationState({
      filters: { mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY },
      select: (m) => m.state.status,
    });
    const toastIdRef = useRef<string | null>(null);
    useEffect(() => {
      const inFlight = statuses.filter((s) => IN_FLIGHT.has(s)).length;
      if (inFlight > 0 && toastIdRef.current === null) {
        toastIdRef.current = showToast('Сохраняем…', 'loading'); // id из возврата Task 1
      } else if (inFlight === 0 && toastIdRef.current !== null) {
        hideToast(toastIdRef.current);
        toastIdRef.current = null;
      }
    }, [statuses, showToast, hideToast]);
    useEffect(() => () => {
      if (toastIdRef.current !== null) hideToast(toastIdRef.current); // cleanup при размонтировании — единственная страховка от «вечного» тоста
    }, [hideToast]);
  }
  ```
  `showToast` здесь использует возвращённый id из Task 1. Тексты: «Сохраняем…» (как у чипа). Хук ничего не возвращает.
- [ ] `Topbar.tsx`: вызвать `useSavingToast()` рядом с текущим блоком `:55-59`; удалить блок чипа `:338-363` целиком (спиннер уже перенесён в ToastContainer в Task 2); `isSaving` + `useUnsavedChangesGuard(isSaving)` **остаются**; убрать ставшие неиспользуемыми импорты.
- [ ] Создать `frontend/admin/__tests__/useSavingToast.test.tsx` (обёртка `QueryClientProvider` + `UIProvider`): (а) при мутации с ключом `SCHEDULE_ACTIVITY_MUTATION_KEY` в pending (промис без резолва) — виден один `toast-loading`; (б) две параллельные pending-мутации — по-прежнему один тост; (в) резолв обеих — тост снят; (г) reject — тост снят; (д) новая пачка после settle — новый тост (другой id); (е) размонтирование при живой мутации — тост снят; (ж) `useMutationState` вызван с `filters.mutationKey === SCHEDULE_ACTIVITY_MUTATION_KEY` (перенос смысла ассерта `Topbar.test.tsx:345`).
- [ ] `Topbar.test.tsx:321-355`: ассерты чипа (роль/текст/спиннер) удалить; ассерт того, что при pending-мутации активен beforeunload-guard, **сохранить**; ассерт mutationKey-фильтра (`:345`) убрать — его смысл переехал в тест хука (ж).
- [ ] Удалить `frontend/admin/__tests__/Topbar.saving-indicator.test.tsx` (файл целиком про чип).
- [ ] Прогнать `CellHeight.Topbar.test.tsx` — мок `useMutationState` (`:36`, возвращает пустой массив) остаётся функционально валидным: пустой массив → хук не показывает тост; менять его не нужно (если когда-нибудь понадобится симулировать in-flight — мок должен вернуть мутации со статусами, не булевы).
- [ ] Прогнать e2e из Task 3 — все пять сценариев GREEN.

### DoD
- E2E-тесты сценариев 1–5 проходят (RED→GREEN зафиксирован). Unit зелёный; чипа в Topbar нет; guard жив; «Сохраняем…» — один тост на пачку, снимается по завершении и при ошибке.

---

## Task 5: Финал — полный прогон, CHANGELOG, контроль чистоты

### Classification: small

### Required Docs
- `docs/tests_workflow.md` — команды полных прогонов
- `CHANGELOG.md` — формат записей

### Steps

- [ ] Полный unit-прогон админки (vitest) — зелёный.
- [ ] Полный e2e-прогон shard-schedule + smoke-набор — зелёный (workers=1, локально по `docs/tests_workflow.md`).
- [ ] Visual-набор — зелёный без обновления базлайнов (чип под маской `[role="status"]`, спека §4). Если базлайн всё же разошёлся — стоп, разбор с юзером, а не молчаливый переснапшот.
- [ ] `CHANGELOG.md` — запись в раздел очередной версии:
  ```markdown
  - Индикатор «Сохраняем…» перенесён из плашки в Topbar в общий стек тостов: новый вид тоста
    `loading` (спиннер, без автоскрытия и кнопки закрытия, вне лимита «видимо 5»), один тост
    на пачку мутаций расписания, снимается по завершении (успех и ошибка).
  ```
- [ ] Контроль чистоты: `git grep -n "Сохраняем" frontend/admin` — ровно два места (хук и его тесты); `git grep -n "saving-indicator"` — пусто; `git grep -n "isSaving" frontend/admin/app/components/layout/Topbar.tsx` — только guard.

### DoD
- Все прогоны зелёные; CHANGELOG дополнен; следов чипа нет; ветка готова к PR (Closes #261).
