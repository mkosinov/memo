# План: e2e-guardrails — валидация шардов, конфликт переменных, CI-guard, канон регенерации (issue #209)

## Goal

Закрыть живой остаток постмортема #209: опечатка в `SHARD_ID` отсекается на входе стартового скрипта; конфликт `SHARD_ID × TEST_DB_PATH` — громкая ошибка во всех шести местах TS-слоя; CI падает рано и понятно, если проект Playwright резолвит ноль spec-файлов; канон регенерации снапшотов и протокол переиспользования стека записаны в скилле `dev-workflow`; существующий сухой тест стартового скрипта подключён к CI и локальному полному прогону.

## Architecture

Изменения только в test-инфраструктуре: shell-скрипты (`scripts/`), TS-слой e2e (`frontend/admin/e2e/`), GitHub Actions workflows (`.github/workflows/`), Markdown-скилл (`.opencode/skills/dev-workflow/SKILL.md`). Продуктовый код, схема БД и API не затрагиваются. Ключевой новый узел — общий чистый хелпер `frontend/admin/e2e/lib/db-path.ts`, единственный источник пути тестовой БД для шести существующих мест дублирования.

## Tech Stack

bash, TypeScript (без новых зависимостей), GitHub Actions yaml, vitest (существующая сюита админки), Markdown.

Поведенческая дельта живёт в спеке (`docs/specs/2026-09-18-e2e-env-guardrails-design.md`, §Behavioral Delta) и здесь не повторяется. Сценарии — из спеки §User Scenarios (S1–S4).

---

## Task 1: Белый список SHARD_ID в стартовом скрипте + кейс в dryrun-тесте

### Classification: small

### Required Docs

Нет доменных/UID-доков (test-infra). Контекст: `docs/tests_workflow.md` (канон прогонов).

### Что сделать

1. `scripts/e2e-shard-start.sh`: сразу после цикла проверки непустоты переменных (сейчас ~строка 40, `for var in SHARD_ID …; done`), до `ROOT_DIR=` (~строка 42), вставить:

   ```sh
   case "$SHARD_ID" in
     1|2) ;;
     *)
       echo "ERROR: SHARD_ID must be 1 or 2 (canonical shards; got '$SHARD_ID')" >&2
       exit 1
       ;;
   esac
   ```

   Текст ошибки фиксируется дословно — на него завязан тест (подстрока `must be 1 or 2`).
2. `scripts/e2e-shard-start.dryrun.test.sh`: новый кейс — вызвать скрипт напрямую (мимо стаб-харнесса: валидация срабатывает до `uv`/`pnpm`, заглушки не нужны) с `SHARD_ID=rest` и остальными переменными из существующего кейса; assert: код выхода 1, stderr содержит `must be 1 or 2`.

### Verification

- `bash scripts/e2e-shard-start.dryrun.test.sh` — зелёный целиком (старые кейсы с SHARD_ID 1/2 не ломаются: белый список стоит до машинерии).
- Ручной прогон: `SHARD_ID=rest SHARD_PORT=3003 BACKEND_PORT=8002 BACKEND_URL=http://127.0.0.1:8002 NEXT_PUBLIC_API_URL=http://127.0.0.1:8002 bash scripts/e2e-shard-start.sh` → exit 1, стек не поднимается.

### DoD

E2E-эквивалент сценария S1 проходит (новый кейс dryrun-теста, RED-GREEN-REFACTOR). Красный до правки скрипта, зелёный после.

---

## Task 2: Подключение dryrun-теста к CI и к test-all.sh

### Classification: trivial

### Required Docs

Нет (test-infra).

### Что сделать

1. `.github/workflows/test.yml`: новая джоба `shard-script-checks` (ubuntu-latest, параллельно матрице e2e, без `needs`): checkout → установка pnpm/node тем же паттерном, что у матричных джоб (копировать их setup-шаги, браузеры не нужны) → `bash scripts/e2e-shard-start.dryrun.test.sh`.
2. `scripts/test-all.sh`: ранний шаг после стартовых проверок окружения и до цикла шардов: `bash "$ROOT_DIR/scripts/e2e-shard-start.dryrun.test.sh"` (миллисекунды на заглушках, локальные прогоны не удлиняет). Нюанс: dryrun-тест использует GNU `timeout`, которого может не быть на macOS без coreutils — шаг оборачивается в precheck `command -v timeout >/dev/null || { echo "skip dryrun test (no timeout binary)"; }` с пропуском и предупреждением вместо падения.

### Verification

- Джоба `shard-script-checks` зелёная в change-PR (это же проверяет чувствительность guard'а «/root/.npm-global/bin/pnpm» к окружению раннера — см. спеку, открытый вопрос 4).
- Локально `scripts/test-all.sh` доходит до шага и не падает на нём.

### DoD

E2E-эквивалент сценария S4 проходит (сухой тест зелёный и в CI-джобе, и в локальном полном прогоне).

---

## Task 3: Общий хелпер пути тестовой БД + миграция шести мест

### Classification: standard

### Required Docs

Нет доменных/UID-доков (test-infra).

### Что сделать

1. Новый файл `frontend/admin/e2e/lib/db-path.ts`:

   ```ts
   export function resolveTestDbPath(opts: { shardId?: string; testDbPath?: string }): string
   ```

   Контракт (из спеки §2): корень репо хелпер вычисляет сам (`path.resolve(__dirname, '../../../..')` от `e2e/lib/` — четыре уровня: lib → e2e → admin → frontend → корень; глубина как в `factories.ts:387`); задан `shardId` → `<root>/backend/test_memo_shard${shardId}.db`; если при этом задан и `testDbPath` и его абсолютное разрешение (относительное `testDbPath` разрешать от корня репо, НЕ от `process.cwd()`) отличается → `throw new Error(...)` с текстом: значение `SHARD_ID`, производный путь, значение `TEST_DB_PATH`, подсказка «уберите одну из переменных»; пути совпали или задана одна переменная — вернуть путь.

2. Мигрировать все шесть мест на хелпер (каждое удаляет свой локальный дубль разрешения; возвращённое значение — единственный источник пути вниз по потоку, включая сборку строки `sqlite3 "${dbPath}"`):
   - `frontend/admin/e2e/globalSetup.ts` (~строки 79–83; производный путь использовать и в sqlite3-команде ~строки 92);
   - `frontend/admin/e2e/fixtures/db-query.ts` (~26–32);
   - `frontend/admin/e2e/fixtures/seed-reset.ts` (~107–112);
   - `frontend/admin/e2e/fixtures/factories.ts` (~385–390);
   - `frontend/admin/e2e/unify-caches.spec.ts` (~45–47);
   - `frontend/admin/e2e/visual-compliance-checks.spec.ts` (~42–45; его обратный приоритет «TEST_DB_PATH побеждает» исчезает — общий контракт).

3. Тесты (vitest-сюита админки; файлы только в `__tests__/` — vitest исключает `e2e/**` из коллекции, импорт хелпера из `e2e/lib` разрешён):
   - новый `frontend/admin/__tests__/db-path.test.ts`: конфликт бросает ошибку (текст называет обе переменные); относительный и абсолютный вид одного пути проходят тихо; только `shardId`; только `testDbPath`; относительный путь резолвится от корня репо независимо от cwd;
   - обновить `frontend/admin/__tests__/seed-reset.test.ts` (~101–131): assertion старого приоритета «shard wins, TEST_DB_PATH ignored» (`'/tmp/should-be-ignored.sqlite'`, ~строка 115) заменить на новый контракт (конфликт → ошибка).

### Verification

- `pnpm test` в `frontend/admin` — зелёный (включая обновлённый seed-reset.test.ts).
- `grep -rn "test_memo_shard" frontend/admin/e2e --include="*.ts" | grep -v lib/db-path` — после миграции производные имени файла БД остаются только в хелпере (места вызова не конкатенируют имя сами).

### DoD

E2E-эквивалент сценария S2 проходит (vitest на хелпер, RED-GREEN-REFACTOR).

---

## Task 4: Правка устаревшего комментария в шапке globalSetup

### Classification: trivial

### Required Docs

Нет.

### Что сделать

`frontend/admin/e2e/globalSetup.ts`, шапка-комментарий: `test_memo_shard{1-5}.db` → `test_memo_shard{1,2}.db`.

### Verification

`grep -rn "1-5" frontend/admin/e2e/globalSetup.ts` — пусто.

### DoD

Строковая правка, покрывается прогоном Task 3 (`pnpm test` зелёный).

---

## Task 5: CI-guard «в проекте 0 spec-файлов»

### Classification: small

### Required Docs

Нет (test-infra).

### Что сделать

1. `.github/workflows/test.yml`, обе матричные e2e-джобы: новый шаг после установки зависимостей и Playwright-браузеров, **до** шага старта стека:
   - `working-directory: frontend/admin`;
   - env шага повторяет матрицу джобы: `SHARD_ID`, `SHARD_PORT`, `BACKEND_PORT`, `BACKEND_URL`, `NEXT_PUBLIC_API_URL` (те же значения, что у шага прогона тестов);
   - скрипт шага: `pnpm exec playwright test --project=<проект джобы> --list` с раздельным перехватом stdout/stderr (stderr не сканировать — трейс ошибки конфига содержит абсолютные пути `.spec.ts`);
   - ненулевой код выхода → отдельное сообщение об ошибке (опечатка в имени проекта/матрице), exit 1;
   - ноль строк с `.spec.ts` в stdout → сообщение о классе «регрессия фильтра тестов / путь worktree» с указанием на regex в `frontend/admin/playwright.config.ts:118,125`, exit 1.
2. `.github/workflows/update-snapshots.yml`: тот же guard перед стартом стека (до шага подъёма shard-rest), проект `shard-rest`.

### Verification

- Оба workflow зелёные в change-PR (на здоровом дереве guard проходит молча — это и есть проверка S3/S4).
- Ручная негативная проверка локально: `pnpm exec playwright test --project=nonexistent --list` → ненулевой выход, guard-логика различает «проект не найден» и «ноль spec-файлов».

### DoD

E2E-эквивалент сценариев S3+S4 проходит (зелёные прогоны обоих workflow в change-PR).

---

## Task 6: Канон регенерации и протоколы в скилле dev-workflow

### Classification: small

### Required Docs

Нет (harness-доки, английский — конвенция харнесс-языка).

### Что сделать

`.opencode/skills/dev-workflow/SKILL.md`:

1. Новый подраздел «Visual snapshot regeneration»: дрилл — ручной запуск GitHub-workflow `update-snapshots.yml` (workflow_dispatch, шард 2) → скачать артефакт `updated-snapshots-shard-rest` → скопировать PNG в `frontend/admin/e2e/**/*-snapshots/` → коммит; локальная регенерация — только для итераций, `SHARD_ID` из {1, 2}; перекрёстная ссылка на полный канон `docs/tests_workflow.md` (второго параллельного канона не создавать).
2. Протокол переиспользования запущенного стека (в раздел про e2e-стеки): слушающий порт — не идентичность; перед reuse проверить переменные процесса-владельца (`SHARD_ID`, `DATABASE_URL`, `NEXT_DIST_DIR`); при любых сомнениях убить и поднять свежий.
3. В разделе worktree (сейчас голый сниппет `git worktree add/list/remove`, ~строки 181–193) — подраздел-чеклист свежего worktree: бэкенд `uv sync --extra dev` перед pytest; фронт `corepack enable && pnpm install`; пункт про браузеры Playwright — не новый текст, а перекрёстная ссылка на существующую check-first секцию скилла (~строки 118–131).

### Verification

- `grep -n "snapshot" .opencode/skills/dev-workflow/SKILL.md` находит новый подраздел; чеклист worktree содержит `uv sync --extra dev`.
- Смысловое ревью в change-PR.

### DoD

Документальные сценарии S3/S4-канона зафиксированы; автоматических проверок для дока нет (осознанное решение спеки — «что сознательно НЕ строим»).

---

## Порядок и зависимости

- Task 1 → Task 2 (подключается тест, появившийся в Task 1).
- Task 3 и Task 4 — независимая ветка (Task 4 однострочный, едет вместе с Task 3).
- Task 5 — независим (guard не зависит от хелпера).
- Task 6 — независим (доки).
- Сквозной DoD всего плана: оба workflow (`Tests`, `update-snapshots`) зелёные в change-PR; `pnpm test` и dryrun-тест зелёные локально.
