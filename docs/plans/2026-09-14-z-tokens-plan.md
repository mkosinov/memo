# План: #260 z-шкала расписания → токены + CI-guard

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Плашка «N cards» перестаёт перекрывать панели/сайдбар (110 → 26), все z-значения админки переходят на именованные CSS-токены, блокирующий CI-guard запрещает голые z-числа, три e2e-сценария фиксируют порядок слоёв.

**Architecture:** Токены — CSS-переменные в одном `:root`-блоке `globals.css` (единственное место с голыми числами). В TSX — `z-[var(--z-имя)]` в классах и `zIndex: 'var(--z-имя)'` в inline-стилях (getComputedStyle резолвит число — подстановка var() идёт на computed-value time). Guard — python-скрипт по сырому тексту в job `frontend-checks`. Карточная модель глубины в DayColumn (`25−z`) — явное исключение guard'а. Значения не перенумеровываются, кроме плашки.

**Tech Stack:** React 18 / Next 14 / Tailwind 3.4, vitest+jsdom (unit), Playwright (e2e, shard-schedule), python3 (guard), GitHub Actions.

**Спека:** `docs/specs/2026-09-14-z-tokens-design.md` (rev2.1 — §3.4 уточнён при написании плана: S1/S3 — численные пары только по элементам корневого stacking context).

---

## Behavioral Delta

Как это поведёт себя для пользователя (маппинг на сценарии спеки):

- **Сценарий 1:** открываю поповер «Масштаб расписания» на неделе со стопками — плашки «N cards» больше не видны поверх поповера и всей верхней шапки (сейчас — видны).
- **Сценарий 2:** кликаю по плашке стопки — список карточек открывается поверх плашки; повторный клик по плашке закрывает.
- **Сценарий 3:** при открытой модалке приходит тост — тост виден поверх модалки.
- **Без изменений:** вид сетки, панелей, модалок и тостов не меняется; существующие значения слоёв не перенумерованы.
- **Guard:** попытка закоммитить в код админки голый `z-N`, `z-[N]` или числовой `zIndex` роняет CI с сообщением, где нарушено и на что заменить.

## Структура файлов

**Создаётся:** `frontend/admin/e2e/schedule-z-layering.spec.ts`; `scripts/check_z_tokens.py`.
**Изменяется:** `frontend/admin/app/globals.css`; schedule-компоненты (DayColumn, DayView, WeekView, NowLine, TimeColumn, ScheduleColumnHeader); layout (Menubar, Topbar, Toolbar, StampFab); shared (Combobox, ColumnPicker, DataTable, CalendarPopover, FilterDropdown, MultiSelect, RemoteSearchSelect, MonthYearPicker, StatusFiltersPicker, StatusPicker); оверлеи (OverlapPopover, ActivityCard, DeleteDialog, ArchiveStaffDialog, ActivityDetailsModal, ToastContainer); `__tests__/DayColumn.test.tsx`; `.github/workflows/test.yml`; `CHANGELOG.md`.

## Таблица маппинга (значение → токен)

Единственный источник правды для миграции (Tasks 3–4). Расхождения с греп-бейзлайном Task 1 маппируются по этой таблице.

| значение (сейчас) | токен | где |
|---|---|---|
| 10 | `--z-base` | Combobox, ColumnPicker, DataTable |
| 15 | `--z-grid` | NowLine, границы групп (DayColumn inline) |
| 20 | `--z-grid-panel` | TimeColumn (sticky), Toolbar (правая панель) |
| 22 | `--z-slot-hover` | DayView, WeekView |
| 25 | `--z-header` | ScheduleColumnHeader (default-проп) |
| 110 → **26** | `--z-badge` | DayColumn, плашка «N cards» |
| 30 | `--z-sidebar` | Menubar |
| 30 | `--z-drag-ghost` | DayColumn (drag/stamp-призраки: `:114,124` inline, `:458`) |
| 40 | `--z-topbar` | Topbar (корневой sticky) |
| 50 | `--z-popover` | Topbar-поповеры, StampFab, все shared-дропдауны, ScheduleColumnHeader (условный, dragging) |
| 50 | `--z-drag-active` | ActivityCard (drag-copy/dragging) |
| 60 | `--z-drag-chip` | DayView, WeekView (чип при drag) |
| 120 | `--z-popover-stack` | OverlapPopover |
| 150 | `--z-modal` | DeleteDialog, ArchiveStaffDialog |
| 200 | `--z-modal-details` | ActivityDetailsModal |
| 250 | `--z-toast` | ToastContainer |

Не трогается (исключение спеки §3.3): карточная модель глубины `DayColumn.tsx:494-534` (`cardZIndex = z === 0 ? 25 : 25 - z`, рендер `zIndex: cardZIndex`).

---

## Task 1: Токен-блок globals.css + grep-бейзлайн

### Classification: small

### Required Docs
- `docs/specs/2026-09-14-z-tokens-design.md` — §2 (инвентарь), §3.1 (токены, значения фиксированы)
- `docs/design-system.md` — conventions по CSS-переменным, если описаны

### Task Description

Заменить устаревший блок-документацию z-шкалы (`frontend/admin/app/globals.css:125-136`) на `:root`-блок токенов и снять grep-бейзлайн всех z-использований (он — критерий DoD guard'а «ноль нарушений» в Task 5).

### Steps

- [ ] Заменить блок `/* ===== Z-Index Stacking Order ===== … */` (строки ~125-136) в `frontend/admin/app/globals.css` на:

```css
/* ===== Z-Index Tokens — единственное место с голыми z-числами =====
   Спека: docs/specs/2026-09-14-z-tokens-design.md §3.1.
   Использование: классы z-[var(--z-имя)], inline zIndex: 'var(--z-имя)'.
   Guard: scripts/check_z_tokens.py. Значения не перенумеровывать (кроме --z-badge 110→26, спека §3.1). */
:root {
  --z-base: 10;           /* дропдауны, фоновые карточки */
  --z-grid: 15;           /* now-line, границы групп */
  --z-grid-panel: 20;     /* sticky TimeColumn, правая панель Toolbar */
  --z-slot-hover: 22;     /* подсветка слота */
  --z-header: 25;         /* шапки колонок, карточки (верх модели 25−z в DayColumn) */
  --z-badge: 26;          /* плашка «N cards»: выше карточек (25), ниже сайдбара (30) и панелей (50) */
  --z-sidebar: 30;        /* Menubar */
  --z-drag-ghost: 30;     /* drag/stamp-призраки в колонке */
  --z-topbar: 40;         /* Topbar */
  --z-popover: 50;        /* кластер поповеров и дропдаунов */
  --z-drag-active: 50;    /* активный drag (ActivityCard) */
  --z-drag-chip: 60;      /* чип/метка при drag */
  --z-popover-stack: 120; /* OverlapPopover */
  --z-modal: 150;         /* DeleteDialog, ArchiveStaffDialog */
  --z-modal-details: 200; /* ActivityDetailsModal */
  --z-toast: 250;         /* ToastContainer */
}
```

- [ ] Снять бейзлайн тремя грепами (вывод сохранить — он чек-лист миграции Tasks 3–4):

```bash
grep -rnE '\bz-\[[0-9]+\]' frontend/admin/app --include='*.tsx' --include='*.ts' | grep -v __tests__
grep -rnE '\bz-[0-9]+\b' frontend/admin/app --include='*.tsx' --include='*.ts' | grep -v __tests__
grep -rnE 'zIndex *: *["'"'"']?[0-9]' frontend/admin/app --include='*.tsx' --include='*.ts' | grep -v __tests__
```

- [ ] Сверить вывод с инвентарём §2 спеки и таблицей маппинга выше. Каждое найденное место должно иметь строку в таблице; если греп нашёл лишнее — выбрать токен по значению из таблицы (значение, которого нет в таблице = STOP, вопрос архитектору).
- [ ] Commit: `docs(#260): z-токены в globals.css + grep-бейзлайн миграции`

### DoD
- `:root`-блок присутствует, старый блок-комментарий удалён.
- Три грепа дали непустой вывод, покрывающий инвентарь §2; расхождения разрешены таблицей маппинга.

---

## Task 2: e2e RED — schedule-z-layering.spec.ts

### Classification: standard

### Required Docs
- `docs/specs/2026-09-14-z-tokens-design.md` — §3.4 (сценарии S1–S3), §5
- `frontend/admin/e2e/wave5-x-cards-blurred.spec.ts` — образец: импорты фикстур, seed двух активностей в один слот, локатор плашки, чтение вычисленного z
- `frontend/admin/e2e/fixtures/test.ts` — авто `seedReset` и storageState
- `docs/tests_workflow.md` — как гонять e2e локально (стек на 3004/8001, workers=1)

### Task Description

Создать спецификацию трёх сценариев. Она пишется ДО фикса: S1 и S3 обязаны упасть на текущем коде (плашка 110 > topbar 40 и > сайдбара 30), S2 уже зелёный (120 > 110) и остаётся регрессионным guard'ом. Селекторы уже есть в коде: `[data-testid="zoom-button"]`/`[data-testid="zoom-popup"]` (Topbar), `[data-testid="overlap-popover"]` (OverlapPopover), `[data-testid="menubar"]` (Menubar), `[data-testid="delete-dialog-overlay"]`, `[data-testid="activity-details-modal"]`, плашка — `button[data-popover-toggle]` с текстом `/\d cards/`. У ToastContainer testid появится в Task 4 — S3 читает его через `role="status"`, либо (если роль не уникальна) пропуск этого чтения до Task 4 недопустим: добавь testid в этом же коммите (см. шаг 5).

Имя файла `schedule-z-layering.spec.ts` автоматически попадает в проект `shard-schedule` (testMatch `schedule[^/]*`), регистрация не нужна.

### Steps

- [ ] Создать `frontend/admin/e2e/schedule-z-layering.spec.ts`:

```ts
import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { createTestActivity } from './fixtures/factories';

test.describe('Schedule z-layering (#260)', () => {
  const dayStr = new Date().toISOString().slice(0, 10);

  test.beforeEach(async ({ request }) => {
    // Две активности в один слот => стопка + плашка «2 cards» (приём wave5-спеки)
    await createTestActivity(request, { start: `${dayStr}T10:00:00`, capacity: 10 });
    await createTestActivity(request, { start: `${dayStr}T10:00:00`, capacity: 10 });
  });

  const badge = (page: import('@playwright/test').Page) =>
    page.locator('button[data-popover-toggle]').filter({ hasText: /cards/ }).first();
  const zOf = (loc: ReturnType<import('@playwright/test').Page['locator']>) =>
    loc.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));

  test('S1: badge sits below the topbar (zoom popover paints above badges)', async ({ page }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await expect(badge(page)).toBeVisible();
    // Отношение в корневом stacking context — причина бага: 110 > 40 => вся шапка с
    // поповером рисовалась под плашкой. Числам cross-context верить нельзя, но плашка
    // и header (sticky z-40) — соседи корневого контекста, пара корректна.
    expect(await zOf(badge(page))).toBeLessThan(await zOf(page.locator('header')));
  });

  test('S2: stack badge click opens OverlapPopover above the badge', async ({ page }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    const b = badge(page);
    await expect(b).toBeVisible();
    await b.click();
    const popover = page.locator('[data-testid="overlap-popover"]');
    await expect(popover).toBeVisible();
    expect(await zOf(popover)).toBeGreaterThan(await zOf(b));
    await b.click(); // toggle закрывает: onMouseDown плашки глушит outside-close (DayColumn.tsx:542-546);
    // Locator.click() бьёт в element handle, а не в hit-test по экрану — новая отрисовка (плашка под поповером) тесту не мешает
    await expect(popover).toBeHidden();
  });

  test('S3: root-context ladder badge < sidebar < topbar < details-modal < toast', async ({ page }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    const badgeZ = await zOf(badge(page));
    const menubarZ = await zOf(page.locator('[data-testid="menubar"]'));
    const topbarZ = await zOf(page.locator('header'));
    const toastZ = await zOf(page.locator('[data-testid="toast-container"]'));
    expect(badgeZ).toBeLessThan(menubarZ);
    expect(menubarZ).toBeLessThan(topbarZ);
    // Сценарий 3: тост поверх модалки (обе — корневой контекст)
    await openModal(page); // сигнатура как в wave5-x-cards-blurred.spec.ts
    const modal = page.locator('[data-testid="activity-details-modal"]');
    await expect(modal).toBeVisible();
    expect(topbarZ).toBeLessThan(await zOf(modal));
    expect(await zOf(modal)).toBeLessThan(toastZ);
  });
});
```

- [ ] Если `[data-testid="toast-container"]` не существует (его добавит Task 4): добавить в `frontend/admin/app/components/toast/ToastContainer.tsx` (корневой div, ~строка 21) атрибут `data-testid="toast-container"` в этом же коммите — S3 не должен зависеть от хрупкого `role="status"` (роль используют и другие элементы, например подсказка пустой недели).
- [ ] Прогнать: `pnpm exec playwright test e2e/schedule-z-layering.spec.ts --project=shard-schedule` (стек e2e поднят по `docs/tests_workflow.md`).
- [ ] Ожидаемый RED: **S1 падает** (110 > 40), **S3 падает** (110 > 30 на первой паре), **S2 зелёный**. Если S1/S3 зелёные — стоп: баг не воспроизведён, вопрос архитектору.
- [ ] Commit: `test(#260): e2e z-layering S1–S3 (RED: плашка поверх шапки/сайдбара)`

### DoD
- Спека создана, S1 и S3 красные по причинe «превышение z», S2 зелёный.

---

## Task 3: Миграция schedule-компонентов + фикс плашки + юнит-тест (GREEN)

### Classification: standard

### Required Docs
- `docs/specs/2026-09-14-z-tokens-design.md` — §3.1–3.2, §3.4 (юнит-тест), таблица маппинга из плана
- `docs/design-system.md` — conventions
- `frontend/admin/__tests__/DayColumn.test.tsx:725-755` — текущий протухший тест

### Task Description

Перевести все schedule-компоненты на токены. Единственное изменение ЗНАЧЕНИЯ: плашка 110 → `--z-badge` (26). Карточную модель `DayColumn.tsx:494-534` не трогать (исключение guard'а).

### Steps

- [ ] `DayColumn.tsx`: `:566` класс `z-[110]` → `z-[var(--z-badge)]`; `:458` `z-[30]` → `z-[var(--z-drag-ghost)]`; `:114,124` inline `zIndex: 30` → `zIndex: 'var(--z-drag-ghost)'`; `:587` inline `zIndex: 15` → `zIndex: 'var(--z-grid)'`. Строки 494-534 (модель `25−z`) не менять.
- [ ] `DayView.tsx`: `:482` `z-[22]` → `z-[var(--z-slot-hover)]`; `:530` `z-[60]` → `z-[var(--z-drag-chip)]`.
- [ ] `WeekView.tsx`: `:291` `z-[22]` → `z-[var(--z-slot-hover)]`; `:309` `z-[60]` → `z-[var(--z-drag-chip)]`.
- [ ] `NowLine.tsx:43`: `z-[15]` → `z-[var(--z-grid)]`.
- [ ] `TimeColumn.tsx:21`: `z-20` → `z-[var(--z-grid-panel)]`.
- [ ] `ScheduleColumnHeader.tsx`: default-проп `zIndex = 25` (`:12`, используется `:25`) → тип `number | string`, значение `'var(--z-header)'`; условный класс `:86` `isDragging ? 'z-50' : ''` → `isDragging ? 'z-[var(--z-popover)]' : ''`.
- [ ] `__tests__/DayColumn.test.tsx:731-754` — заменить тест (jsdom не резолвит `var()` в getComputedStyle, поэтому ассерт на уровне класса; поведенческую часть «поповер над плашкой» с этого момента несёт e2e S2):

```ts
it('badge z comes from the --z-badge token, not a raw z number', () => {
  render(<DayColumn dayIndex={0} date={new Date()} activities={partialOverlapActivities} masters={MOCK_MASTERS} />);
  const badge = screen.getByRole('button', { name: /2 cards/i });
  expect(badge.className).toContain('z-[var(--z-badge)]');
  expect(badge.className).not.toMatch(/z-\[\d+\]/);
});
```

- [ ] Юнит: `npx vitest run __tests__/DayColumn.test.tsx` — зелёный.
- [ ] e2e: `pnpm exec playwright test e2e/schedule-z-layering.spec.ts --project=shard-schedule` — **все три зелёные** (GREEN).
- [ ] Commit: `fix(#260): плашка стопки в слой --z-badge (26), schedule-компоненты на z-токены`

### DoD
- **E2E tests for scenarios 1–3 pass (RED-GREEN-REFACTOR)** — S1 и S3 переведены из RED в GREEN этим таском, S2 остался зелёным.
- Юнит-тест DayColumn зелёный; карточная модель не тронута.

---

## Task 4: Миграция layout, shared и оверлеев

### Classification: standard

### Required Docs
- `docs/specs/2026-09-14-z-tokens-design.md` — §2 (инвентарь), §3.2 (механизм)
- `docs/design-system.md` — conventions
- Чек-лист Task 1 (grep-вывод)

### Task Description

Перевести оставшиеся использования по таблице маппинга. После таска все три грепа Task 1 обязаны вернуть пустой вывод.

### Steps

- [ ] Layout: `Menubar.tsx:530` `z-30` → `z-[var(--z-sidebar)]`; `Topbar.tsx:164` `z-40` → `z-[var(--z-topbar)]`, `:274` и `:382` `z-50` → `z-[var(--z-popover)]`; `Toolbar.tsx:67` `z-20` → `z-[var(--z-grid-panel)]`; `StampFab.tsx:12` `z-50` → `z-[var(--z-popover)]`.
- [ ] Shared (`z-10` → `z-[var(--z-base)]`): `Combobox.tsx:173`, `ColumnPicker.tsx:56`, `DataTable.tsx:410`. (`z-50` → `z-[var(--z-popover)]`, включая template literal `MultiSelect.tsx:195`): CalendarPopover, FilterDropdown, MultiSelect, RemoteSearchSelect, MonthYearPicker, StatusFiltersPicker, StatusPicker.
- [ ] Оверлеи: `OverlapPopover.tsx:123` inline `zIndex: 120` → `zIndex: 'var(--z-popover-stack)'`; `ActivityCard.tsx:65,67` inline `zIndex: 50` → `zIndex: 'var(--z-drag-active)'`; `DeleteDialog.tsx:243` и `frontend/admin/app/(main)/staff/components/ArchiveStaffDialog.tsx:69` `z-[150]` → `z-[var(--z-modal)]`; `ActivityDetailsModal.tsx:192` `z-[200]` → `z-[var(--z-modal-details)]`; `frontend/admin/app/components/toast/ToastContainer.tsx:21` `z-[250]` → `z-[var(--z-toast)]` (+ `data-testid="toast-container"`, если не добавлен в Task 2).
- [ ] Вернуть три грепа Task 1 — **все пустые**. Если непусто — домигрировать по таблице (Stop-условие то же: неизвестное значение = вопрос архитектору).
- [ ] Юнит- suite: `npx vitest run` — зелёный.
- [ ] e2e `schedule-z-layering` + смоук `wave5-x-cards-blurred` — зелёные.
- [ ] Commit: `refactor(#260): layout/shared/оверлеи на z-токены (грепы чисты)`

### DoD
- Три грепа Task 1 возвращают пустой вывод; юнит и e2e зелёные.

---

## Task 5: Guard-скрипт + CI-шаг + CHANGELOG

### Classification: small

### Required Docs
- `docs/specs/2026-09-14-z-tokens-design.md` — §3.3 (контракт guard'а)
- `scripts/check_skipped_tests.py` — стиль репо для check-скриптов
- `.github/workflows/test.yml:93-112` — job `frontend-checks` (job-level `working-directory: frontend/admin`)

### Task Description

Блокирующий guard по сырому тексту (спека §3.3): сканирует `frontend/admin/app/**/*.{ts,tsx}`, пропускает `__tests__` и `*.test.*`; разрешены только `z-[var(--…)]` и `zIndex: 'var(--…)'`.

### Steps

- [ ] Создать `scripts/check_z_tokens.py`:

```python
#!/usr/bin/env python3
"""Запрещает голые z-значения в коде админки вне токен-блока globals.css.

Разрешено: z-[var(--z-*)] в классах, zIndex: 'var(--z-*)' в inline-стилях.
Токены: frontend/admin/app/globals.css (:root). Спека: docs/specs/2026-09-14-z-tokens-design.md §3.3.
Исключение спеки: карточная модель глубины DayColumn рендерит `zIndex: cardZIndex` — на месте
вызова нет числового литерала, ни один паттерн не срабатывает (числа живут в арифметике 25−z).
"""
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "frontend" / "admin" / "app"

ARBITRARY = re.compile(r"\bz-\[(?!var\()[^\]]*\d")   # z-[110], z-[15px]…
BARE = re.compile(r"\bz-(?!\[)\d+\b")                 # z-30, z-50… (z-[N] не дублируется — ловит ARBITRARY)
INLINE = re.compile(r"\bzIndex\s*:\s*['\"]?\d")       # zIndex: 15, zIndex: '15'…
PATTERNS = (("z-[N]", ARBITRARY), ("z-N", BARE), ("zIndex: N", INLINE))


def main() -> int:
    files = sorted(
        p for glob in ("*.ts", "*.tsx") for p in APP.rglob(glob)
        if "__tests__" not in p.parts and ".test." not in p.name
    )
    violations = []
    for path in files:
        rel = path.relative_to(APP.parents[2])
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for label, pattern in PATTERNS:
                if pattern.search(line):
                    violations.append(f"{rel}:{lineno}: {label}: {line.strip()}")
    if violations:
        print("z-token guard: голые z-значения запрещены.")
        print("Токены: frontend/admin/app/globals.css (:root). Используй z-[var(--z-имя)] / zIndex: 'var(--z-имя)'.")
        for v in violations:
            print(f"  {v}")
        return 1
    print(f"z-token guard: OK ({len(files)} files scanned, 0 violations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Негативная самопроверка: добавить в любой компонент временную строку-класс `z-[999]`, запустить `python3 scripts/check_z_tokens.py` — exit 1 с этим file:line; убрать строку, запустить снова — `OK, 0 violations`, exit 0.
- [ ] В `.github/workflows/test.yml`, job `frontend-checks` (после `- run: pnpm run type-check`) добавить шаг с перекрытием job-level working-directory (скрипт лежит в корне репо):

```yaml
      - name: z-token guard
        run: python3 scripts/check_z_tokens.py
        working-directory: .
```

- [ ] `CHANGELOG.md`: добавить строку в верхнюю (непReleased) секцию, в формат соседних строк: `#260 — плашки стопок не перекрывают панели/сайдбар; z-шкала на токенах + блокирующий CI-guard`.
- [ ] Commit: `ci(#260): блокирующий z-token guard в frontend-checks + CHANGELOG`

### DoD
- Guard локально зелёный (0 violations), негативная самопроверка подтвердила exit 1 на нарушении.
- CI-шаг добавлен; в PR нужно дождаться зелёного `frontend-checks` (включая dispatch-прогон при молчании pull_request-триггера — прецедент #250).

---

## Self-Review

- **Spec coverage:** §3.1 → Task 1; §3.2+инвентарь → Tasks 3–4; §3.3 → Task 5; §3.4/§5 (S1–S3) → Tasks 2–3; юнит-ревизия → Task 3; CHANGELOG и тест-гигиена → Task 5. Покрыто.
- **Placeholders:** нет — весь код (токены, спека e2e, юнит-тест, guard, yaml) приведён дословно; селекторы существуют в коде (проверены скаутом).
- **Типы:** `ScheduleColumnHeader` проп `zIndex` расширяется до `number | string`; остальные места — строковые значения в существующих позициях className/style.
- **Required Docs:** у каждого таска указаны.
