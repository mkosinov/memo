# План: #94 «Undo-тост с кольцом обратного отсчёта»

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undo-тосты отложенного удаления (визиты/оплаты) получают визуальное кольцо обратного отсчёта с цифрой (5→4→…→1): окно отсчёта, время жизни тоста и момент commit сходятся в один источник — `delayMs` отложенного действия (новый внутренний параметр `countdownMs`). Тосты без undo и undo-тост занятия (`ActivityCard.tsx:78`) не меняются; «×» работает как раньше (скрытие, не отмена — D9).

**Architecture:** Четыре точки. (1) `UIContext` — поле `countdownMs?: number` в `Toast`, 4-й опциональный параметр `showToast`, длительность undo-тоста = `undoFn ? (countdownMs ?? 5000) : 4500`. (2) Новый компонент `CountdownRing` — SVG-круг и цифры от **одного** секундного интервала (ступенчатое заполнение кольца; без CSS-кефреймов и inline `animationDuration`). (3) `ToastContainer` — рендер кольца слева от текста при `toast.countdownMs !== undefined` (гейт по `countdownMs`, не по `undo` — D1). (4) `PendingActionsContext.enqueuePendingAction` — передаёт `delayMs` как `countdownMs` (единственный производитель).

**Tech Stack:** React 18 / Next 14 / Tailwind 3.4, TanStack Query v5, vitest+jsdom (unit), Playwright (e2e — существующий `unified-rows.spec.ts`).

**Спека:** `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` (rev2).

**Хард-гейта нет.** Соседние дорожки правят тот же файл `ToastContainer.tsx`: #261 (рендер `loading`, строки непересекающиеся) и #260 (z-токен `:24`, testid контейнера) — если к старту IMPL не смержены, брать актуальное состояние main; по смыслу конфликтов нет. Перед каждым коммитом — `git pull --rebase origin main`.

---

## Behavioral Delta

Как это поведёт себя для пользователя (маппинг на сценарии спеки):

- **Сценарий S1:** удаляю визит — строка исчезает, undo-тост «Удалено. Отменить» появляется с кольцом отсчёта слева от текста; кольцо ступенчато убывает, цифра тикает 5→1. (Сегодня тот же тост без кольца.)
- **Сценарий S2:** нажимаю «Отменить» — тост исчезает, строка возвращается. (Без изменений.)
- **Сценарий S3:** окно истекает без клика — тост исчезает, визит удалён. (Без изменений.)
- **Сценарий S4:** удалил → отменил → удалил снова — новый undo-тост, отсчёт начинается заново. (Без изменений; добавляется e2e-покрытие.)
- **Сценарий S5:** удаляю запись (records) — мгновенный тост «Запись удалена» без кольца и «Отменить», при 409 — DeleteDialog. (Без изменений.)
- **Сценарий S6:** удаляю платёж — как S1 (кольцо + «Отменить»). (Без изменений, кроме появления кольца.)
- **Без изменений:** тосты без undo («Сохраняем…» #261, «Данные обновлены» #239, результатные), undo-тост занятия (undo есть, кольца нет), тексты тостов, кнопка «×» (скрывает тост; commit продолжается — D9), лимит стека «видимо 5», дефолтные тайминги (undo-тост без `countdownMs` живёт 5000 мс, обычные 4500 мс).

## Структура файлов

**Создаётся:** `frontend/admin/app/components/toast/CountdownRing.tsx`; `frontend/admin/__tests__/CountdownRing.test.tsx`.
**Изменяется:** `frontend/admin/contexts/UIContext.tsx`; `frontend/admin/app/components/toast/ToastContainer.tsx`; `frontend/admin/contexts/PendingActionsContext.tsx`; `frontend/admin/__tests__/UIContext.test.tsx`; `frontend/admin/__tests__/ToastContainer.test.tsx`; `frontend/admin/__tests__/PendingActionsContext.test.tsx`; `frontend/admin/e2e/unified-rows.spec.ts`; `docs/design-system.md`; `CHANGELOG.md`.
**Удаляется:** ничего.

---

## Task 1: UIContext — проводка `countdownMs` (поле + 4-й параметр + длительность)

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §3 D3 (механика), §2 (тост-система)
- `frontend/admin/contexts/UIContext.tsx:7-12,73-97` — `Toast`, сигнатура `showToast`, блок автоскрытия
- `frontend/admin/__tests__/UIContext.test.tsx` — существующий ассерт 4500 мс (`:168`)

### Steps
- [ ] `Toast` (`:7-12`): добавить `countdownMs?: number;`
- [ ] `showToast` (`:73-77`): четвёртый опциональный параметр `countdownMs?: number` (после `undo`). Остальные 40+ вызовов не трогаются — параметр опциональный, не-undo вызовы его игнорируют.
- [ ] Создание тоста (`:87`): в объект добавить `countdownMs` (как передано; `undefined` — нормальное состояние, гейт рендера — `!== undefined`).
- [ ] Длительность (`:88-89`): `const duration = undoFn ? (countdownMs ?? 5000) : 4500;` — остальной блок автоскрытия без изменений; ветка `loading` не меняется.
- [ ] Тесты `UIContext.test.tsx`: (а) undo-тост с `countdownMs: 3000` — `showToast('Удалено', () => {}, 3000)`: жив после `advanceTimersByTime(2999)`, удалён после `+1`; (б) undo-тост без `countdownMs` — удалён после 5000 мс; (в) **не**-undo тост с переданным 4-м параметром — по-прежнему 4500 мс (параметр игнорируется).

### DoD
- `vitest` зелёный; `tsc --noEmit` чист; окно undo-тоста управляется `countdownMs`, дефолты (5000/4500) и вид `loading` не изменились.

---

## Task 2: Компонент CountdownRing (один таймер на кольцо и цифры)

### Classification: standard

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §3 D2 (размеры/токены), D4 (один интервал), D5 (a11y); §4 (края)
- `docs/design-system.md` — секция Toast (`:458-463`), токены
- `frontend/admin/app/components/toast/ToastContainer.tsx:34-46` — геометрия существующего спиннера (viewBox 12, r 4.5, strokeWidth 1.5)

### Steps
- [ ] Создать `frontend/admin/app/components/toast/CountdownRing.tsx`:
  - пропс: `countdownMs: number`;
  - состояние: `remainingMs`, старт = `countdownMs`; `setInterval(1000)` уменьшает на 1000; при `<= 0` интервал очищается (тиков больше нет);
  - цифра: `Math.max(1, Math.ceil(remainingMs / 1000))`;
  - SVG: два круга с геометрией спиннера (viewBox 12, r 4.5): дорожка (`stroke-current` с низкой непрозрачностью — нейтральная дорожка) и прогресс (`stroke-current`); `strokeDasharray = 2π·4.5 ≈ 28.27`; `stroke-dashoffset = (1 - remainingMs/countdownMs) · 28.27`; поворот на -90° (старт в 12 часов); цифра по центру, мелкий шрифт, `tabular-nums`;
  - обёртка целиком `aria-hidden="true"`; компонент ничего не скрывает сам — исчезновение тоста делает UIContext.
- [ ] Создать `frontend/admin/__tests__/CountdownRing.test.tsx` (`vi.useFakeTimers`): (а) цифры убывают 5→4→3→2→1 по секундам и **никогда не показывают 0** (после `advanceTimersByTime(countdownMs)` и дальше остаётся 1); (б) `stroke-dashoffset` растёт с каждым тиком пропорционально доле окна; (в) после `countdownMs` интервал остановлен — рендер стабилен; (г) обёртка `aria-hidden="true"`; (д) размонтирование не оставляет живых интервалов (прогон с `vi.advanceTimersByTime` после unmount не бросает и не ререндерит).

### DoD
- `vitest` зелёный; кольцо и цифры двигаются одним интервалом синхронно; a11y-атрибут на месте.

---

## Task 3: ToastContainer — рендер кольца по гейту `countdownMs`

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §3 D1 (гейт), D2 (размещение), D9 («×» остаётся); §2 (рендер)
- `frontend/admin/app/components/toast/ToastContainer.tsx:28-67` — тело тоста, спиннер (`loading`), «Отменить», «×»
- `frontend/admin/__tests__/ToastContainer.test.tsx:47-54` — существующие тесты «Отменить»

### Steps
- [ ] В теле тоста: при `toast.countdownMs !== undefined` перед текстом сообщения рендерить `<CountdownRing countdownMs={toast.countdownMs} />` (слева от текста, где `loading` рисует спиннер). Гейт — только `countdownMs`, **не** `toast.undo`: undo-тост занятия (`ActivityCard.tsx:78`, без `countdownMs`) кольца не получает.
- [ ] «Отменить» (`:48-57`) и «×» (`:59-67`) без изменений — D9 (у undo-тостов «×» остаётся, скрытие не отменяет действие).
- [ ] Тесты `ToastContainer.test.tsx` — добавить пару: (а) тост с `countdownMs` содержит кольцо (`data-testid="toast-countdown"` на обёртке кольца в CountdownRing) и «Отменить»; (б) undo-тост без `countdownMs` (прямой `showToast` с функцией) — «Отменить» есть, кольца нет; (в) не-undo тост — ни кольца, ни «Отменить». Существующие тесты файла не меняются.

### DoD
- `vitest` зелёный; кольцо появляется только у тостов с `countdownMs`; «Отменить»/«×»/лимит стека не изменились.

---

## Task 4: PendingActionsContext — единственный производитель `countdownMs`

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §3 D3 (механика, сигнатура, моки)
- `frontend/admin/contexts/PendingActionsContext.tsx:42-71` — enqueue, показ тоста
- `frontend/admin/__tests__/PendingActionsContext.test.tsx:69-237` — ассерты вызова `showToast`

### Steps
- [ ] `enqueuePendingAction` (`:54-61`): вызов тоста дополнить — `showToast(action.message, undoCallback, undefined, action.delayMs)` (3-й аргумент — слот `kind`, для undo-пути не используется).
- [ ] Обновить ассерты `showToast` в `PendingActionsContext.test.tsx` с осознанной сменой арности: `(message, function)` → `(message, function, undefined, action.delayMs)` (у обоих потребителей — визиты/оплаты, `delayMs: 5000`).
- [ ] Прогнать unit-набор админки целиком — зелёный (других вызовов `showToast` с 4-м аргументом не появилось: греп `grep -rn "showToast(" frontend/admin --include="*.tsx"` — 4 аргумента только в PendingActionsContext).

### DoD
- `vitest` зелёный; `enqueuePendingAction` передаёт окно в тост; прямые undo-вызовы (ActivityCard и пр.) сигнатуру не меняют.

---

## Task 5: e2e — сценарий S4 (повторное удаление после отмены)

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §6 (S4), D6 (без цифр/таймингов)
- `docs/tests_workflow.md` — локальный прогон e2e (стек на 3004/8001, workers=1)
- `frontend/admin/e2e/unified-rows.spec.ts:773-812` — готовые паттерны: delete → тост → optimistic → expiry → deferred DELETE
- `frontend/admin/e2e/unify-caches.spec.ts:274-279` — паттерн клика «Отменить» и возврата строки

### Steps
- [ ] В `unified-rows.spec.ts` добавить тест S4 (визит): удалить визит → клик «Отменить» в окне (строка вернулась) → удалить снова → undo-тост появился снова (`[role="status"]` / `data-testid^="toast-"`, без ассертов цифр и таймингов — D6) → `page.waitForResponse` на deferred DELETE → reload → визита нет.
- [ ] Прогнать весь `unified-rows.spec.ts` — существующие тесты S1–S3/S6 (`:773-812`, `:996-1030`) и `unify-caches.spec.ts` зелёные, новый тест зелёный.

### DoD
- E2E test for scenario 4 passes (RED-GREEN-REFACTOR: тест добавляется как регресс-гард существующего поведения — ожидаемо зелёный с первого прогона, RED-фазы нет; этим сценарий S4 получает явное покрытие, остальных — существующие спеки, §6/§7 спеки).

---

## Task 6: Финал — документация, полный прогон, CHANGELOG

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` — §3 D8 (design-system), §8 (DoD)
- `docs/tests_workflow.md` — команды полных прогонов
- `CHANGELOG.md` — формат записей

### Steps
- [ ] `docs/design-system.md`: секция Toast (`:458-463`) — блок «Кольцо отсчёта» (геометрия спиннера, дорожка/прогресс — токены, поведение: «Отменить» закрывает тост, «×» скрывает без отмены); таблица motion (`:269`) — строка «Undo ring — ступенчатое заполнение, шаг 1 с, синхронен цифрам».
- [ ] Полный unit-прогон админки (vitest) — зелёный.
- [ ] Полный e2e: shard с `unified-rows` + smoke-набор — зелёные (workers=1, по `docs/tests_workflow.md`). Visual-набор — зелёный без обновления базлайнов (тосты под маской `[role="status"]`); если базлайн разошёлся — стоп и разбор, не молчаливый переснапшот.
- [ ] `CHANGELOG.md` — запись:
  ```markdown
  - Undo-тосты отложенного удаления (визиты/оплаты) показывают кольцо обратного отсчёта с цифрой
    (5→1): окно отсчёта, время жизни тоста и момент удаления — один источник (окно отложенного
    действия). Кнопка «×» как раньше скрывает тост без отмены действия.
  ```
- [ ] Контроль чистоты: `git grep -n "countdownMs" frontend/admin --include="*.tsx"` — только UIContext/ToastContainer/CountdownRing/PendingActionsContext и их тесты; кольцо рендерится только по гейту `countdownMs !== undefined`.

### DoD
- Все прогоны зелёные; design-system и CHANGELOG дополнены; ветка готова к PR (закрытие #94 — в описании IMPL PR).
