# Рефакторинг: все env-файлы в одну папку `envs/`

> Date: 2026-10-23
> Issue: #540
> Status: Design (Gate B)
> Related: `backend/src/core/config.py`, `backend/tests/conftest.py`, `dev.sh`, `scripts/e2e-shard-start.sh`, `frontend/admin/playwright.config.ts`, `.opencode/command/playground.md`, `.opencode/scripts/create-worktree.sh`
> Частично замещает: `docs/specs/2026-05-31-env-config-design.md` §2.1 (раскладка файлов и имена); механизм `ENV_FILE` из той спеки НЕ меняется.

## 1. Проблема

Env-файлы раскиданы по подпапкам проекта: четыре в `backend/` (`.env`, `.env.dev`, `.env.test`, `.env.example`), один в `frontend/admin/` (`.env.test`). Разработчик (и агент), которому нужно поправить конфиг окружения, ищет файлы в разных местах; файлы, связанные по смыслу (`frontend/admin/.env.test` обязан совпадать по `DATABASE_URL` с `backend/.env.test` — комментарий в самом файле), физически разнесены. Запрос пользователя (дословно): «хотелось бы чтобы все env были в одной папке, а не раскиданы по подпапкам».

Дополнительная боль, поглощаемая редизайном: плейграунд-канон не покрывает CORS для веб-портов плейграунда — 2026-10-23 в плейграундную копию `backend/.env.dev` пришлось вручную дописывать origins `localhost/127.0.0.1 :3100+:3101`, без них логин в браузере падал с «ошибкой сети» (preflight 400).

## 2. Актуальная инвентаризация (scout 2026-10-23)

| Файл | Статус в git | Роль |
|---|---|---|
| `backend/.env` | gitignored (`.gitignore:16`) | локальные секреты; создаётся `dev.sh` copy-if-absent из `.env.dev`; загрузчиком **не читается** (см. §8, факт В1) |
| `backend/.env.dev` | **трекается** | dev-конфиг (инкл. `OTP_TRANSPORT=dev`, #499); источник для плейграунда |
| `backend/.env.test` | **трекается** | конфиг тестов/e2e |
| `backend/.env.example` | трекается | шаблон-документация всех переменных |
| `frontend/admin/.env.test` | трекается | env для standalone-запуска Playwright (`playwright.config.ts:19`); vitest env-файлы не грузит (#389) |

Корректировки к инвентаризации issue зафиксированы комментарием в #540 (2026-10-23): `.env.dev`/`.env.test` трекаются; CI-workflows не ссылаются на env-файлы напрямую; зеркала `.zcode/command/playground.md` не существует.

## 3. Выбранный подход (Gate A — авто)

Один подход (расходящихся пользовательски-видимых альтернатив нет — различия кандидатов были только во внутренних деталях путей, что по фильтру дивергенции схлопывается в один):

**Перенос всех env-файлов в единую корневую папку `envs/` со схемой имён `<zone>.env[.<role>]`, переключение всех потребителей путей, CORS-override для плейграунда в строке запуска канона (механизм e2e-шардов), удаление мёртвого `backend/.env`.** Семантика загрузчика (`ENV_FILE` → pydantic-settings) не меняется — меняются только значения путей, которые потребители в него передают.

Альтернатива одной строкой: `config/env/` — отклонена (лишний уровень вложенности, имя конфликтует по смыслу с `backend/src/core/config.py`).

Архитектурные решения (моя зона, зафиксированы, вариантов в IMPL не плодить):

- **А1. Папка и нейминг**: `envs/` в корне репо; имена `<zone>.env[.<role>]`: зона `backend` / `admin`, роль `dev` / `test` / `example`; имя без роли (`envs/<zone>.env`) зарезервировано под будущие локальные файлы и игнорится правилом `envs/*.env` (§4). Имя самодокументирующе сортируется по зонам в листинге.
- **А2. Разрешение путей**: каждый потребитель строит путь от якоря корня репо (скрипты — от `$SCRIPT_DIR`/расчётного корня, `conftest.py` — от `__file__`, `playwright.config.ts` — от `__dirname`), в `ENV_FILE` попадает абсолютный путь. Это убирает сегодняшнюю хрупкость cwd-относительных `.env.dev` / `.env.test` (сейчас pytest обязан запускаться из `backend/`).
- **А3. Playground через override, а не отдельный файл**: плейграунд-бэкенд стартует на трекаемом `envs/backend.env.dev` (приходит в worktree сам через checkout) с процессным override `CORS_ORIGINS=…3100/3101` прямо в строке запуска канона — тот же механизм, что уже используют e2e-шарды (#317: `os.environ` > env-файл). Отдельный трекаемый `backend.env.playground` отвергнут по итогам ревью простоты: форк dev-файла — постоянный риск рассинхрона (ровно тот класс фейлов, который рефакторинг убирает; #499 уже добавлял `OTP_TRANSPORT` в dev мимо плейграунда).
- **А4. Мёртвый `backend/.env` удаляется, а не переезжает**: файл сегодня никем не читается (§8, В1), поэтому шаг copy-if-absent в `dev.sh` и мёртвый цикл копирования в `create-worktree.sh` удаляются, локальные остатки убираются вручную (§7). Локальный механизм переопределений (если понадобится) — отдельный follow-up с реальной проводкой в загрузчик, не этот PR. Семантика загрузчика (`ENV_FILE` → pydantic-settings) не меняется — меняются только значения путей.
- **А5. Содержимое переносится как есть**: значения переменных в переносимых файлах не меняются (правки — только комментарии-документация внутри файлов: шапки-рецепты `envs/backend.env.example`, ссылка `envs/admin.env.test` на `envs/backend.env.test`).

## 4. Целевая раскладка

| Сейчас | Станет | git | Механизм переноса |
|---|---|---|---|
| `backend/.env.dev` | `envs/backend.env.dev` | tracked | `git mv` |
| `backend/.env.test` | `envs/backend.env.test` | tracked | `git mv` |
| `backend/.env.example` | `envs/backend.env.example` | tracked | `git mv` |
| `frontend/admin/.env.test` | `envs/admin.env.test` | tracked | `git mv` |
| `backend/.env` | — (удаляется из обихода) | был gitignored | шаг создания в `dev.sh` и цикл в `create-worktree.sh` удаляются; локальный остаток — `rm` вручную (§7) |

Итог в `envs/`: 4 трекаемых файла. Плейграунд использует `envs/backend.env.dev` + override при запуске (§6) — отдельного файла нет (А3).

`.gitignore` (корень, блок `# Environment`): добавить одно fail-safe правило `envs/*.env`. Паттерн не матчит ни одно трекаемое имя (`backend.env.dev` кончается на `.dev`, `admin.env.test` — на `.test` и т.д.), поэтому исключения `!` не нужны; правило защищает пространство имён папки на случай будущих локальных/секретных файлов вида `envs/backend.env`, `envs/admin.env` (соглашение двух панелей: полнота + best-practices). Существующие правила `.env` / `.env.local` / `.env*.local` не трогаются — старый локальный `backend/.env` у разработчиков остаётся накрыт глобальным правилом `.env`.

## 5. Потребители путей — полный список изменений

Реестр всех вхождений (scout 2026-10-23, `git grep`; полнота проверена по паттернам `backend/.env`, `\.env\.(dev|test|example)`, `ENV_FILE`):

| # | Файл:строки | Изменение |
|---|---|---|
| 1 | `backend/src/core/config.py:157` | **Без изменений кода** (механизм `ENV_FILE` прежний); опционально обновить докстринг `:13` под новую раскладку |
| 2 | `backend/tests/conftest.py:54` | `ENV_FILE` = абсолютный путь `Path(__file__).resolve().parents[2] / "envs" / "backend.env.test"` |
| 3 | `backend/tests/test_auth_otp_api.py:74` | докстринг: упоминание `.env.test` → `envs/backend.env.test` |
| 4 | `dev.sh:123-133, 144, 147` | удалить шаг copy-if-absent (`:123-126`, файл мёртв — В1); ввод `ENV_DIR` от корня репо; `ENV_FILE="$ENV_DIR/backend.env.dev"` (3 места: uvicorn `:133`, dispatcher `:144`, worker `:147`; в субшеллах — префиксной формой к команде или `export`) |
| 5 | `scripts/e2e-shard-start.sh:369-373, 433, 437` | `ENV_FILE` = абсолютный путь к `envs/backend.env.test` (uvicorn `:372` и dispatcher `:437`); CORS-override per-shard (`:373`) **сохраняется** поверх файла; комментарии `:369, :433` обновить |
| 6 | `scripts/e2e-shard-start.dryrun.test.sh:143, 420, 425-426, 1806-1809` | Case 17a: путь `ENV_FILE` теперь машинозависимый (абсолютный) — ассерты с фиксированного литерала `ENV_FILE=[.env.test]` переходят на паттерн по суффиксу `envs/backend.env.test`; каждая строка захвата (uvicorn-спавн и dispatcher-спавн) матчится своим паттерном, чтобы сохранить локализуемость фейла |
| 7 | `frontend/admin/playwright.config.ts:15-21, 55` | `path.resolve(__dirname, '../../envs/admin.env.test')`; комментарии `:15, :21, :55` |
| 8 | `frontend/admin/__tests__/db-path.test.ts:107` | комментарий про `.env.test` (проверить, что ассерты не завязаны на путь файла; ожидаемо только правка текста) |
| 9 | `.gitignore` | + `envs/*.env` (fail-safe на пространство имён, см. §4) |
| 10 | `.opencode/command/playground.md:28, 34` | см. §6 |
| 11 | `.opencode/scripts/create-worktree.sh:47-54` | мёртвый цикл копирования корневых `.env*` (корневых env-файлов нет) удаляется целиком; замены не требуется (нечего копировать: все env-файлы трекаемые) |
| 12 | `.opencode/opencode.jsonc:8-10`, `.opencode/agents/manager.md:10-12` | permission-глобы: `*` в opencode не пересекает `/`, поэтому после переезда ни allow-глоб `*.env.example`, ни deny-глобы `*.env` / `*.env.*` не матчат `envs/*` — добавить симметрично: allow `envs/*.env.example`, deny `envs/*.env`, `envs/*.env.*`; существующие глобы не удалять (старые worktree'и) |
| 13 | `.opencode/skills/dev-workflow/SKILL.md:32, 214-216` | английский harness-док: `ENV_FILE=.env.dev` → путь к `envs/backend.env.dev`; standalone-рецепт `:214` → путь к `envs/backend.env.test` |
| 14 | `.opencode/skills/pytest-patterns/references/conftest-template.py:38` | шаблон: `ENV_FILE` → путь к `envs/backend.env.test` (якорь `__file__`, как в #2) |
| 15 | `backend/.env.example:5, 8-9` (после переноса — `envs/backend.env.example`) | шапка-документация: примеры запуска на новые пути (`ENV_FILE=envs/backend.env.dev …`) |
| 16 | `frontend/admin/.env.test:2` (после переноса — `envs/admin.env.test`) | комментарий "Must match backend/.env.test" → `envs/backend.env.test` |
| 17 | `docs/specs/2026-05-31-env-config-design.md` | в шапку добавить строку "> Superseded (file layout §2.1): docs/specs/2026-10-23-env-single-folder-540-design.md" — иначе живой канон врёт; тело истории не переписывать |
| 18 | `frontend/admin/e2e/lib/backend-url.ts:29-46` | канонический рецепт в help-тексте guard'а (`ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn…`, печатается разработчику при каждом фейле guard'а) — обновить путь на `envs/backend.env.test` |
| 19 | `docs/tests_workflow.md:104-105, 114, 130` | живой runbook (связан из CONTRIBUTING.md, «нарративная версия» того же рецепта): `ENV_FILE=.env.test`, `frontend/admin/.env.test` → новые пути |
| 20 | `turbo.json:3` | `globalDependencies` глобит только `**/.env.*local` — после централизации env выпадает из ключей кэша Turbo; добавить `"envs/**"` |
| 21 | `docs/plans/*`, `docs/status/*`, `.opencode/scratchpad.md` | **не трогать** — исторические записи; новые доки ссылаются на новую раскладку |

CI (`.github/workflows/*.yml`) — изменений нет: прямых ссылок на env-файлы нет, env приходит через `scripts/e2e-shard-start.sh`.

## 6. Плейграунд-редизайн (поглощение CORS-инцидента 2026-10-23)

Канон `.opencode/command/playground.md` (единственная копия, `.zcode`-зеркала нет):

1. Шаг copy-if-absent (строка 28): убрать `backend/.env.dev` из списка копируемых (трекаемый `envs/backend.env.dev` приходит в worktree сам через checkout); `backend/memo.db` (seed) остаётся копируемым.
2. Старт бэкенда (строка 34) — единственная форма (относительно cwd `backend/` внутри worktree, куда канон делает `cd`):
   `ENV_FILE=../envs/backend.env.dev CORS_ORIGINS="http://localhost:3100,http://127.0.0.1:3100,http://localhost:3101,http://127.0.0.1:3101" PYTHONPATH=src uv run uvicorn src.main:app --host 0.0.0.0 --port 8101`
   Override процессным env — тот же механизм, что у e2e-шардов (#317); приоритет `os.environ` > env-файл гарантирует, что origins плейграунда перекрывают dev-значение.
3. В канон добавляется примечание: origins для `:3100`/`:3101` задаёт override в строке запуска; **патчить трекаемый env-файл в worktree запрещено** (патч = грязный worktree — именно это пришлось ручной правкой делать до редизайна).

Следствие: класс фейлов «логин в плейграунде = ошибка сети, потому что origins не дописаны» исчезает структурно — рецепт самонадёлен, ручных шагов с env больше нет.

## 7. Миграция

- Трекаемые (4 файла): `git mv` в PR — история сохраняется, у проверяющих файлы переезжают сами.
- Локальный `backend/.env` (не в git, никем не читается — В1): однострочная инструкция в описании PR: секреты, если там есть ценные, перенести в окружение деплоя/шелла, затем `rm backend/.env`. Ничего не ломается ни до, ни после удаления.
- Существующие worktree'и в `.worktrees/`: не мигрируем — живут на своих ветках со старой раскладкой. Известный риск: при rebase/merge этих веток на main после `git mv` возникнут rename/delete-modify конфликты по 4 перемещённым файлам; разрешение — принять раскладку main (правая сторона) и портировать содержательные правки ветки в новые пути. В активные ветки этих worktree'ов PR не вмешивается.
- CI: миграция не требуется (§5, прямой ссылки на env-файлы нет).

## 8. Совместимость и пограничные случаи

- **#317 (динамические порты e2e-шардов)**: per-shard `CORS_ORIGINS` override в `e2e-shard-start.sh:373` остаётся ровно как есть — он поверх `envs/backend.env.test`, порядок приоритетов (`os.environ` > env-файл) не меняется.
- **#389 (локальное vitest-окружение admin)**: vitest env-файлы не грузит (`vitest.config.ts` — только `process.env.TZ`); трогаем только `playwright.config.ts` (standalone-fallback). Публичный контракт `db-path.test.ts` не меняется (правка комментария).
- **#499 (auth/OTP)**: `OTP_TRANSPORT=dev` и точные CORS-origins переезжают внутри файлов без изменения значений (А5).
- **В1 (факт)**: `backend/.env` сегодня создаётся (`dev.sh:124-126`), но загрузчиком не читается (`config.py:157` читает только `ENV_FILE`; фолбэк «нет ENV_FILE → читать .env» из канона 2026-05-31 §2.2 в код не вживлён). Дизайн удаляет мёртвый файл и шаг его создания (А4); follow-up кандидат — осознанный локальный механизм переопределений с реальной проводкой в загрузчик (отдельная задача, не этот PR).
- **В2 (граница поведения)**: `ENV_FILE=""` (пустая строка) и сегодня, и после рефакторинга означает «файлы не грузить» (pydantic-settings), `ENV_FILE` вовсе не задан — тоже «не грузить, только process env». Не меняется.
- **В3 (молчаливая деградация)**: pydantic-settings молча игнорирует несуществующий `_env_file`, a `playwright.config.ts:18-22` глушит ошибку чтения `catch {}`. Опечатка в новом пути легко прошла бы все гейты молча. Компенсация в этом PR: ассерт в `conftest.py` — `Path(os.environ["ENV_FILE"]).is_file()` (fail-fast в тестах); U4 делает unit-проверку резолва пути playwright обязательной. Fail-fast в самом загрузчике — изменение семантики, follow-up кандидат (не этот PR).
- **В4 (косметика, принято)**: имена `<zone>.env[.<role>]` — не dotfile-стиль `.env*`, поэтому dotenv-подсветка/линтеры их не узнают (VS Code dotenv-режим матчит `.env*`-маски). Потеря косметическая, принята сознательно: самодокументируемая сортировка по зонам важнее; per-dev лечение — `files.associations` (`.vscode/` не трекается).
- **Запуск pytest не из `backend/`**: сегодня `conftest.py` с относительным `.env.test` молча грузит ничего (В3); после А2 (абсолютный путь от `__file__` + ассерт is_file) — работает из любого cwd и падает громко при битом пути.
- **Прод-деплой вне репо**: если внешний скрипт передаёт `ENV_FILE=<абсолютный путь>` — не затронут; авто-чтения `.env` и сегодня нет (В1).

## 9. User Scenarios

| # | Сценарий | Проверка (якорь для плана) |
|---|---|---|
| U1 | Разработчику нужно поправить конфиг окружения — все env лежат в `envs/`, ищутся в одном месте | layout-проверка в DoD: 4 трекаемых файла + правило ignore `envs/*.env`; в `git status` после миграции пусто |
| U2 | Локальная разработка: `./dev.sh` поднимает стек как раньше, backend :8000 на конфиге из `envs/backend.env.dev` — именно с загрузкой файла, не молчаливым фолбэком на дефолты | smoke в DoD: health-check backend + маркер, что env-файл реально загружен (например, dev-значение `OTP_TRANSPORT=dev` из #499 видно в рантайме/логах; health+preflight `:3000` проходят и на дефолтах — недостаточно, см. §8 В3) |
| U3 | E2E-шард: `scripts/e2e-shard-start.sh` стартует uvicorn с `envs/backend.env.test` + per-shard CORS override (#317 не ломается) | dryrun-тест Case 17a (суффикс-паттерны `envs/backend.env.test` по строкам uvicorn и dispatcher) + полный backend-суит |
| U4 | Standalone-запуск Playwright admin (без test-all.sh) подхватывает `envs/admin.env.test` (#389 не ломается) | обязательная unit-проверка резолва пути в playwright.config (путь существует на диске), не «или» |
| U5 | Плейграунд: свежий worktree, логин из браузера на `:3100`/`:3101` без ручного патча CORS — override в строке запуска канона | ручная E2E по канону плейграунда после merge (в DoD PR — чеклист-строка) |
| U6 | Запуск backend-тестов из любого cwd: `pytest` из корня репо и из `backend/` одинаково грузят `envs/backend.env.test` | прогон сьюита из обоих cwd в DoD (+ ассерт is_file в conftest как вечний страж) |
| U7 | Ручной standalone-старт бэкенда по документированному рецепту (dev-workflow / tests_workflow / help-text guard'а) работает с новыми путями | обновлённые рецепты скопированы в доки верbatim; ручная проверка одной команды из рецепта |

## 10. Behavioral Delta

| Аспект | До | После |
|---|---|---|
| Расположение env-файлов | `backend/` (4 файла) + `frontend/admin/` (1) | все в `envs/` (4 трекаемых) |
| Имена | `.env`, `.env.dev`, `.env.test`, `.env.example` | самодокументируемые `backend.env[.role]`, `admin.env[.role]` |
| Мёртвый `backend/.env` | создаётся `dev.sh`, никем не читается | файл и шаг создания удалены |
| Плейграунд-CORS | ручной патч копии `.env.dev` (инцидент 2026-10-23) | override в строке запуска канона (механизм e2e-шардов); патчить трекаемый файл запрещено каноном |
| Шаг «копировать env в worktree» | в каноне плейграунда и мёртвом цикле create-worktree.sh | исчезает полностью: трекаемые файлы приходят через checkout |
| cwd для pytest | только из `backend/` (относительный `ENV_FILE`, молча без файла при другом cwd) | любой cwd (абсолютный путь от `__file__` + ассерт is_file) |
| Рантайм-поведение приложения, CI-пайплайн, значения конфигов | — | **без изменений** |

## 11. Acceptance Criteria

- [ ] Все env-файлы лежат в `envs/`, имена по схеме `<zone>.env[.<role>]`; трекаемых env-файлов в `backend/` и `frontend/admin/` нет (незатреканный локальный остаток `backend/.env` — ручная уборка, §7)
- [ ] 4 трекаемых файла перенесены `git mv` (история сохранена); отдельного playground-env нет (override в каноне)
- [ ] `.gitignore`: правило `envs/*.env` добавлено; `envs/backend.env.dev|test|example`, `envs/admin.env.test` трекаются и правилом не матчатся
- [ ] Реестр §5 закрыт полностью: позиции 1–20 выполнены (#1 — код не меняется, докстринг опционален); #21 (исторические доки) не трогается
- [ ] Канон плейграунда обновлён: без copy-if-absent env, старт с `ENV_FILE=../envs/backend.env.dev` + CORS-override, примечание о запрете патчей
- [ ] `conftest.py` содержит ассерт `Path(os.environ["ENV_FILE"]).is_file()`; сьют зелёный из обоих cwd (корень и `backend/`)
- [ ] Dryrun-тест (Case 17a и строки uvicorn) зелёный с суффикс-паттернами; admin unit/e2e зелёные (вкл. unit-проверку резолва playwright-пути); ruff/mypy/tsc/lint чистые
- [ ] U2 smoke: `./dev.sh` поднимается, маркер загрузки dev-env подтверждён (например `OTP_TRANSPORT=dev`), CORS preflight проходит
- [ ] Значения переменных в переносимых файлах не изменены (diff переноса — только пути/имена и правки комментариев)

## 12. Visual Compliance Checks

- N/A
