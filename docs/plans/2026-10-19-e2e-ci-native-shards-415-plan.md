# План: нативные шарды e2e в CI + HTML-отчёт с трейсами + блокирующий флейк-гейт (#415)

- Дата: 2026-10-19
- Спека: `docs/specs/2026-10-13-e2e-ci-native-shards-415-design.md` (рев.3) — Behavioral Delta и User Scenarios живут там, здесь не пересказываются.
- Поток: STANDARD, Gate B пройден 2026-10-19 (решения пользователя: флейк блокирует мерж; критерий «≤ 10 мин» с рычагом «5-й шард»).

## Goal

Перевести e2e-прогон CI с двух ручных regex-проектов на нативное деление Playwright `--shard=i/N` (4 шарда в CI, 2 локально), включить репортеры `list`+`html`+`json` с выгрузкой отчёта и трейсов при падении, и добавить флейк-гейт: тест со статусом `flaky` роняет джобу сводкой и блокирует мерж.

## Architecture

Один проект `e2e` в `frontend/admin/playwright.config.ts` (все 99 спек-файлов); пути выходов отчётов управляются env (`E2E_RESULTS_JSON`, `E2E_REPORT_DIR`) с CI-дефолтами `results.json` / `playwright-report`. CI-матрица `test.yml` — 4 джобы-шарда, каждая со своим стеком (`scripts/e2e-shard-start.sh`, SHARD_ID 1–4, порты 3002/8001…3005/8004). Шаг `Flake summary` (`scripts/e2e-report-summary.mjs`, Node без зависимостей) читает `results.json` после прогона: ≥1 `flaky` → exit 1 (красная джоба) + таблица в Step Summary + `::warning`-аннотации; ноль → «Flaky: 0»; файла нет/битый → предупреждение, exit 0. Локальный `test-all.sh` — те же 2 стека, нативные `--shard=1/2`/`2/2` с пер-шардными выходами. Сопутствующие workflows (`visual-check.yml`, `update-snapshots.yml`) и два контейнерных скилла мигрируют на селектор `--project=e2e`.

## Tech Stack

Playwright (проекты, `--shard`, репортеры list/html/json, статусы тестов), GitHub Actions (матрица, артефакты `actions/upload-artifact@v4`, `$GITHUB_STEP_SUMMARY`, `::warning`), bash (стек-скрипты + dryrun-тесты), Node ESM (скрипт сводки), vitest (юнит-тест сводки). Продуктовый код не затрагивается.

## Task 1: Конфиг Playwright — один проект `e2e`, репортеры, env-выходы

### Classification: small

Заменить проекты `shard-schedule`/`shard-rest` одним проектом `e2e` (те же `use`-настройки: Desktop Chrome + storageState; глобальные `retries`/`workers`/`timeout`/`trace` не меняются) — кастомные testMatch-regex обоих проектов УДАЛЯЮТСЯ, проект живёт на дефолтном testMatch Playwright (именно это даёт ровно 99 файлов: дефолт ловит все `.spec.ts`, а `.test.ts` под `e2e/` нет). Репортер: `[['list'], ['html'], ['json', { outputFile: process.env.E2E_RESULTS_JSON ?? 'results.json' }]]`; каталог HTML-отчёта — `process.env.E2E_REPORT_DIR ?? 'playwright-report'`. Комментарий о локальном ограничении 2 шардов сохранить.

### Required Docs

- Спека §3.1, §3.4.

### DoD

- `pnpm exec playwright test --project=e2e --list` в `frontend/admin` печатывает 99 спек-файлов (US-5/US-6, структурная проверка).
- Локальный smoke: прогон одной быстрой спеки создаёт `playwright-report/index.html` и `results.json` (US-2, первая половина).
- E2E test for scenario 5/6 passes (структурная `--list`-проверка вместо браузерного теста — инфра-задача, маппинг по спеке §6).

## Task 2: Скрипт флейк-сводки + юнит-тест

### Classification: standard

`scripts/e2e-report-summary.mjs` (Node ESM, без зависимостей): чистая экспортируемая функция суммаризации `summarize(results) → { flaky: [...], lines, exitCode }` + CLI — путь к JSON аргументом (дефолт `frontend/admin/results.json`), печать строк `FLAKY: <suite> — <title>`, при заданном `GITHUB_STEP_SUMMARY` — Markdown-таблица с итоговой строкой («Flaky: 0» при пустом списке), `::warning`-аннотации на каждый флейк (best-effort). Контракт exit-кодов: ≥1 статуса `flaky` → 1; ноль → 0; файл отсутствует / битый JSON / незнакомые статусы (`interrupted`, `didNotRun`, `skipped`, `timedOut`) → одна предупреждающая строка, exit 0. Ключ детекции — статус ТЕСТА `flaky` (у Playwright нет «passed с ретраем»). Юнит-тест `frontend/admin/__tests__/e2e-report-summary.test.ts` (vitest): фикстура — срез реального формата Playwright JSON; ассерты по всем веткам контракта.

### Required Docs

- Спека §3.5 (рев.3 — флейк роняет джобу), §8 (формат results.json).

### DoD

- Юнит-тест зелёный: passed/flaky/failed/interrupted, ноль флейков, файла нет, битый JSON, exit-коды 1/0 (US-3).
- Smoke на живом `results.json` из Task 1: вывод «Flaky: 0», exit 0.
- E2E test for scenario 3 passes (юнит-тест контракта вместо браузерного теста — маппинг по спеке §6).

## Task 3: Allowlist SHARD_ID 1–4 + табличные dryrun-кейсы

### Classification: small

`scripts/e2e-shard-start.sh`: `case "$SHARD_ID" in 1|2)` → `1|2|3|4)`, сообщение об ошибке «must be 1–4». `scripts/e2e-shard-start.dryrun.test.sh`: allowlist-кейсы переписать циклом по таблице — валидные `1 2 3 4` (rc=0), невалидные `rest 0 5 abc` (rc=1 + сообщение); добавить кейсы экспортов для id 3/4 по образцу существующих Cases 3/4. Таблица — чтобы будущее изменение числа шардов не плодило копипасту (замечание панели).

### Required Docs

- Спека §3.2.

### DoD

- `bash scripts/e2e-shard-start.dryrun.test.sh` зелёный на хосте (bash 3.2-совместимо).
- CI-джоба `shard-script-checks` зелёная (US-4).
- E2E test for scenario 4 passes (dryrun-проверка — маппинг по спеке §6).

## Task 4: test.yml — матрица 4 шардов, гард, артефакты, шаг сводки

### Classification: standard

Джоба `e2e-tests`: матрица `shard: [1,2,3,4]` (SHARD_ID = номер; порты 3002/8001, 3003/8002, 3004/8003, 3005/8004; каждая запись — свой стек через `e2e-shard-start.sh`). Прогон: `pnpm exec playwright test --project=e2e --shard=${{ matrix.shard }}/4` (без `--project`-имён старых шардов). «Spec-file guard» — на `--project=e2e --shard=i/4 --list`, счёт строк `.spec.ts`, fail-fast сохранён. Выгрузка `if: failure()`: `frontend/admin/playwright-report/**` + `frontend/admin/test-results/**`, `if-no-files-found: warn`, имя артефакта `e2e-report-shard-<i>`. Новый шаг «Flake summary»: `if: always()`, из корня репо, `node scripts/e2e-report-summary.mjs frontend/admin/results.json` (Node уже установлен в джобе). Блок `permissions` не добавлять.

### Required Docs

- Спека §3.2, §3.4, §3.5.

### DoD

- PR: все 4 e2e-джобы зелёные; «Spec-file guard OK: N spec files» в каждой; wall каждой e2e-джобы ≤ 10 мин (первый фактический замер — провал критерия = возврат к числу шардов по спеке §8) (US-1, US-6).
- Принудительное красное падение в пробной ветке (временный `expect(true).toBe(false)` в одной спеке): артефакт `e2e-report-shard-<i>` скачивается, `index.html` открывается, трейс в `test-results` на месте; шаг Flake summary не роняет джобу при наличии отчёта без флейков (US-2).
- E2E test for scenarios 1, 2, 6 passes (сам CI-прогон PR — маппинг по спеке §6).

## Task 5: Локальный test-all.sh — нативные шарды, пер-шардные выходы, gitignore

### Classification: small

`scripts/test-all.sh`: убрать `SHARD_PROJECTS`; для каждого из 2 стеков запуск `CI= pnpm exec playwright test --project=e2e --shard=${N}/2 --workers=1` с env `E2E_RESULTS_JSON=results-shard${N}.json`, `E2E_REPORT_DIR=playwright-report-shard${N}` (шарды параллельны в одном cwd — без этого выходы перезаписываются). `frontend/admin/.gitignore`: маска `results*.json`. Комментарии скрипта о 2 локальных шардах актуализировать.

### Required Docs

- Спека §3.3, §3.4.

### DoD

- Полный локальный `bash scripts/test-all.sh` зелёный; `results-shard1.json`/`results-shard2.json` и оба каталога отчётов существуют и валидны (US-4).
- `git status` после прогона не показывает новые неотслеживаемые `results*.json` (gitignore работает).
- E2E test for scenario 4 passes (локальный полный прогон — маппинг по спеке §6).

## Task 6: Сопутствующие workflows — visual-check и update-snapshots

### Classification: small

`visual-check.yml`: оба вызова `--project=shard-rest` → `--project=e2e` (три файла-аргумента и стековые env SHARD_ID=2/3003/8002 не меняются); переименовать и человекочитаемые следы старого имени — заголовок-комментарий (строка 4) и имя шага «Start E2E stack (shard-rest)» (строка 99). `update-snapshots.yml`: селекторы → `--project=e2e`; переименовать следы старого имени — имя workflow «Update Snapshots (shard-rest)», артефакт `updated-snapshots-shard-rest` → `updated-snapshots-e2e`, тексты шагов/комментариев; охват растёт 86 → 99 файлов (осознанное следствие, спека §3.6).

### Required Docs

- Спека §3.6.

### DoD

- Локально `pnpm exec playwright test --project=e2e visual-regression.spec.ts week-view.spec.ts wave6-status-snapshots.spec.ts --list` печатывает ровно 3 файла (US-5, структурная проверка).
- workflow-файлы не содержат `shard-rest`/`shard-schedule` (grep).
- E2E test for scenario 5 passes (структурная `--list`-проверка; первый диспетчерский запуск после мержа — контрольный).

## Task 7: Документация и скиллы

### Classification: small

`docs/tests_workflow.md`: раздел о шардах переписать (один проект `e2e`, `--shard=i/N`, 4 в CI / 2 локально, пер-шардные выходы локальных отчётов, артефакты и флейк-сводка, блокирующая политика флейков); за пределами раздела мигрировать все упоминания старых имён — включая заметку об авторитете скриншотов со ссылкой на `shard-rest`-джобу (~строка 328). `.opencode/skills/dev-workflow/SKILL.md`: мигрировать команду `--project=shard-rest --workers=1` (строка 232), drill-ссылки «shard 2 = shard-rest» и артефакт `updated-snapshots-shard-rest` (253, 257), маппинг SHARD_ID (266–267) → `--project=e2e`, SHARD_ID ∈ {1..4} CI / {1,2} локально, артефакт `updated-snapshots-e2e`. `.opencode/skills/vitest-playwright-patterns/SKILL.md`: строку 400 «CI is the authority (`shard-rest` in `test.yml`)» → «(project `e2e`, `--shard` в `test.yml`)».

### Required Docs

- Спека §3.6; docs/tests_workflow.md (текущий канон до правки).

### DoD

- `grep -rn 'shard-rest\|shard-schedule'` по зоне (`frontend/admin/playwright.config.ts`, `.github/workflows/`, `scripts/`, `docs/tests_workflow.md`, оба скилла) пуст.
- E2E test for scenario 5 passes (документная часть US-5).

## Task 8: Приёмочный PR

### Classification: small

Открыть PR (`Closes #415` в описании) со всеми задачами; дождаться зелёного CI по гейту мержа (AGENTS.md: `gh pr checks --watch` → `gh pr merge --squash --delete-branch`); зафиксировать в PR wall-время каждой e2e-джобы. При провале «≤ 10 мин» — не мержить: возврат к числу шардов (5-й шард: матрица + порты + allowlist + dryrun-таблица, спека §8) отдельной правкой.

### Required Docs

- Спека §7 (DoD), §8; AGENTS.md (гейт мержа).

### DoD

- CI зелёный, все e2e-джобы ≤ 10 мин, гард печатает счёт файлов в каждом из 4 шардов, `shard-script-checks` зелёная; PR смержен по гейту.
- Контрольный запуск `update-snapshots.yml` и `visual-check.yml` после мержа — ожидаемо зелёные / с ожидаемым охватом 99 файлов (US-5, контрольный пункт DoD спеки).
- E2E test for scenarios 1, 2, 6 passes (арбитр — сам CI PR).
