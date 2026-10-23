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

**Перенос всех env-файлов в единую корневую папку `envs/` со схемой имён `<zone>.env[.<role>]`, переключение всех потребителей путей, трекаемый playground-env с запечёнными CORS-origins.** Семантика загрузчика (`ENV_FILE` → pydantic-settings) не меняется — меняются только значения путей, которые потребители в него передают.

Альтернатива одной строкой: `config/env/` — отклонена (лишний уровень вложенности, имя конфликтует по смыслу с `backend/src/core/config.py`).

Архитектурные решения (моя зона, зафиксированы, вариантов в IMPL не плодить):

- **А1. Папка и нейминг**: `envs/` в корне репо; имена `<zone>.env[.<role>]`: зона `backend` / `admin`, роль `dev` / `test` / `example` / `playground` / без роли = локальный файл. Имя самодокументирующе сортируется по зонам в листинге.
- **А2. Разрешение путей**: каждый потребитель строит путь от якоря корня репо (скрипты — от `$SCRIPT_DIR`/расчётного корня, `conftest.py` — от `__file__`, `playwright.config.ts` — от `__dirname`), в `ENV_FILE` попадает абсолютный путь. Это убирает сегодняшнюю хрупкость cwd-относительных `.env.dev` / `.env.test` (сейчас pytest обязан запускаться из `backend/`).
- **А3. Playground-env трекается**: `envs/backend.env.playground` коммитится с запечёнными origins плейграунда. Трекаемый файл автоматически появляется в плейграунд-worktree (worktree содержит все трекаемые файлы) — шаг «скопировать env в worktree» исчезает из канона, ручной патч CORS больше не нужен, worktree не пачкается diff'ом по трекаемому файлу (как сегодня с патченым `backend/.env.dev`).
- **А4. Паритет семантики**: `envs/backend.env` (gitignored) сохраняется как локальный файл, copy-if-absent в `dev.sh` сохраняется (обновляются пути). Факт «файл сегодня никем не читается» фиксируется в спеке (§8, В1) как follow-up кандидат; в рамках этого рефакторинга семантика загрузчика не трогается.
- **А5. Содержимое переносится как есть**: значения переменных в переносимых файлах не меняются (кроме нового `backend.env.playground` и правок комментариев-документации внутри файлов).

## 4. Целевая раскладка

| Сейчас | Станет | git | Механизм переноса |
|---|---|---|---|
| `backend/.env.dev` | `envs/backend.env.dev` | tracked | `git mv` |
| `backend/.env.test` | `envs/backend.env.test` | tracked | `git mv` |
| `backend/.env.example` | `envs/backend.env.example` | tracked | `git mv` |
| `frontend/admin/.env.test` | `envs/admin.env.test` | tracked | `git mv` |
| `backend/.env` | `envs/backend.env` | gitignored | вручную (см. §7); `dev.sh` создаст сам, если файла нет |
| — | `envs/backend.env.playground` | tracked, **новый** | создание (копия dev-значений + CORS-origins плейграунда) |

`envs/backend.env.playground` (содержимое-модель): все значения как в `backend.env.dev`, кроме:
- `CORS_ORIGINS=http://localhost:3100,http://127.0.0.1:3100,http://localhost:3101,http://127.0.0.1:3101` — запечённые веб-порты плейграунда (канон: backend `:8101`, web `:3100`/`:3101`);
- шапка-комментарий (английский, как в остальных env): "Derived from backend.env.dev (re-sync when it gains new vars). Playground: backend :8101, web :3100/:3101."

`.gitignore` (корень, блок `# Environment`): добавить правило `envs/backend.env` (точный путь; существующие правила `.env` / `.env.local` / `.env*.local` имён вида `<zone>.env` не матчат — и остаются для старых локальных файлов). После переноса трекаемых файлов из `backend/` новых ignore-правил для старых путей не нужно (файлов в git там больше нет; локальный `backend/.env` у разработчиков остаётся накрыт действующим глобальным правилом `.env`).

## 5. Потребители путей — полный список изменений

Реестр всех вхождений (scout 2026-10-23, `git grep`; полнота проверена по паттернам `backend/.env`, `\.env\.(dev|test|example)`, `ENV_FILE`):

| # | Файл:строки | Изменение |
|---|---|---|
| 1 | `backend/src/core/config.py:157` | **Без изменений кода** (механизм `ENV_FILE` прежний); опционально обновить докстринг `:13` под новую раскладку |
| 2 | `backend/tests/conftest.py:54` | `ENV_FILE` = абсолютный путь `Path(__file__).resolve().parents[2] / "envs" / "backend.env.test"` |
| 3 | `backend/tests/test_auth_otp_api.py:74` | докстринг: упоминание `.env.test` → `envs/backend.env.test` |
| 4 | `dev.sh:123-133, 144, 147` | ввод `ENV_DIR` от корня репо; copy-if-absent `envs/backend.env.dev` → `envs/backend.env`; `ENV_FILE="$ENV_DIR/backend.env.dev"` (3 места) |
| 5 | `scripts/e2e-shard-start.sh:369-373, 433, 437` | `ENV_FILE` = абсолютный путь к `envs/backend.env.test` (uvicorn `:372` и dispatcher `:437`); CORS-override per-shard (`:373`) **сохраняется** поверх файла; комментарии `:369, :433` обновить |
| 6 | `scripts/e2e-shard-start.dryrun.test.sh:143, 420, 425-426, 1806-1809` | Case 17a: путь `ENV_FILE` теперь машинозависимый (абсолютный) — ассерт с фиксированного литерала `ENV_FILE=[.env.test]` переходит на паттерн по суффиксу `envs/backend.env.test` |
| 7 | `frontend/admin/playwright.config.ts:15-21, 55` | `path.resolve(__dirname, '../../envs/admin.env.test')`; комментарии `:15, :21, :55` |
| 8 | `frontend/admin/__tests__/db-path.test.ts:107` | комментарий про `.env.test` (проверить, что ассерты не завязаны на путь файла; ожидаемо только правка текста) |
| 9 | `.gitignore` | + `envs/backend.env` (см. §4) |
| 10 | `.opencode/command/playground.md:28, 34` | см. §6 |
| 11 | `.opencode/scripts/create-worktree.sh:47-54` | цикл копирования корневых `.env*` (сегодня мёртвый код — корневых env нет) заменить на copy-if-absent локального `envs/backend.env` в `$WORKTREE_DIR/envs/` |
| 12 | `.opencode/opencode.jsonc:10`, `.opencode/agents/manager.md:12` | permission-глоб `*.env.example` может перестать матчить `envs/backend.env.example` (зависит от семантики `*` через `/`) — добавить паттерн `envs/*.env.example`, существующий не удалять (старые worktree'и) |
| 13 | `.opencode/skills/dev-workflow/SKILL.md:32, 214-216` | английский harness-док: `ENV_FILE=.env.dev` → путь к `envs/backend.env.dev`; standalone-рецепт `:214` → путь к `envs/backend.env.test` |
| 14 | `.opencode/skills/pytest-patterns/references/conftest-template.py:38` | шаблон: `ENV_FILE` → путь к `envs/backend.env.test` (якорь `__file__`, как в #2) |
| 15 | `backend/.env.example:5, 8-9` (после переноса — `envs/backend.env.example`) | шапка-документация: примеры запуска на новые пути (`ENV_FILE=envs/backend.env.dev …`) |
| 16 | `frontend/admin/.env.test:2` (после переноса — `envs/admin.env.test`) | комментарий "Must match backend/.env.test" → `envs/backend.env.test` |
| 17 | `docs/specs/2026-05-31-env-config-design.md` | в шапку добавить строку "> Superseded (file layout §2.1): docs/specs/2026-10-23-env-single-folder-540-design.md" — иначе живой канон врёт; тело истории не переписывать |
| 18 | `docs/plans/*`, `docs/status/*`, `.opencode/scratchpad.md` | **не трогать** — исторические записи; новые доки ссылаются на новую раскладку |

CI (`.github/workflows/*.yml`) — изменений нет: прямых ссылок на env-файлы нет, env приходит через `scripts/e2e-shard-start.sh`.

## 6. Плейграунд-редизайн (поглощение CORS-инцидента 2026-10-23)

Канон `.opencode/command/playground.md` (единственная копия, `.zcode`-зеркала нет):

1. Шаг copy-if-absent (строка 28): убрать `backend/.env.dev` из списка копируемых (трекаемый `envs/backend.env.playground` приходит в worktree сам через checkout); `backend/memo.db` (seed) остаётся копируемым.
2. Старт бэкенда (строка 34): `ENV_FILE=.env.dev` → `ENV_FILE=../envs/backend.env.playground` (cwd = `backend/` внутри worktree) либо абсолютный путь от корня worktree — единообразно с dev.sh (А2).
3. В канон добавляется примечание: CORS-origins для `:3100`/`:3101` уже в `envs/backend.env.playground` — ручной патч env'а в плейграунде запрещён (файл трекаемый: патч = грязный worktree).

Следствие: класс фейлов «логин в плейграунде = ошибка сети, потому что origins не дописаны» исчезает структурно.

## 7. Миграция

- Трекаемые (4 файла): `git mv` в PR — история сохраняется, у проверяющих файлы переезжают сами.
- Локальный `backend/.env` (не в git): однострочная инструкция в описании PR: `mkdir -p envs && mv backend/.env envs/backend.env` (опционально: если не сделать, `dev.sh` создаст рабочий `envs/backend.env` copy-if-absent из dev-файла; старый `backend/.env` останется лежать мёртвым грузом, накрытый ignore-правилом `.env`).
- Существующие worktree'и (7 шт. в `.worktrees/`): не трогаем и не мигрируем — они живут на своих ветках со старой раскладкой; `create-worktree.sh` создаёт новые уже по новой схеме.
- CI: миграция не требуется (§5).

## 8. Совместимость и пограничные случаи

- **#317 (динамические порты e2e-шардов)**: per-shard `CORS_ORIGINS` override в `e2e-shard-start.sh:373` остаётся ровно как есть — он поверх `envs/backend.env.test`, порядок приоритетов (`os.environ` > env-файл) не меняется.
- **#389 (локальное vitest-окружение admin)**: vitest env-файлы не грузит (`vitest.config.ts` — только `process.env.TZ`); трогаем только `playwright.config.ts` (standalone-fallback). Публичный контракт `db-path.test.ts` не меняется (правка комментария).
- **#499 (auth/OTP)**: `OTP_TRANSPORT=dev` и точные CORS-origins переезжают внутри файлов без изменения значений (А5).
- **В1 (факт)**: `backend/.env` сегодня создаётся (`dev.sh:124-126`), но загрузчиком не читается (`config.py:157` читает только `ENV_FILE`; фолбэк «нет ENV_FILE → читать .env» из канона 2026-05-31 §2.2 в код не вживлён). Дизайн сохраняет файл и copy-if-absent для паритета (А4); follow-up кандидат — либо вживить фолбэк, либо убрать шаг и файл (отдельная задача, не этот PR).
- **Запуск pytest не из `backend/`**: сегодня `conftest.py` с относительным `.env.test` ломается; после А2 (абсолютный путь от `__file__`) — работает из любого cwd. Единственное намеренное микроулучшение, совместимое по поведению (тот же файл загружается).
- **Прод-деплой вне репо**: если внешний скрипт передаёт `ENV_FILE=<абсолютный путь>` — не затронут; авто-чтения `.env` и сегодня нет (В1).

## 9. User Scenarios

| # | Сценарий | Проверка (якорь для плана) |
|---|---|---|
| U1 | Разработчику нужно поправить конфиг окружения — все env лежат в `envs/`, ищутся в одном месте | layout-проверка в DoD: 5 трекаемых + правило ignore; в `git status` после миграции пусто |
| U2 | Локальная разработка: `./dev.sh` поднимает стек как раньше, backend :8000 на конфиге из `envs/backend.env.dev` | smoke в DoD: health-check backend + preflight CORS от `:3000` проходит как сегодня |
| U3 | E2E-шард: `scripts/e2e-shard-start.sh` стартует uvicorn с `envs/backend.env.test` + per-shard CORS override (#317 не ломается) | dryrun-тест Case 17a (паттерн суффикса `envs/backend.env.test`) + полный backend-суит |
| U4 | Standalone-запуск Playwright admin (без test-all.sh) подхватывает `envs/admin.env.test` (#389 не ломается) | unit-проверка резолва пути в playwright.config (или e2e smoke через CI) |
| U5 | Плейграунд: свежий worktree, логин из браузера на `:3100`/`:3101` без ручного патча CORS | ручная E2E по канону плейграунда после merge (в DoD PR — чеклист-строка) |
| U6 | Новый feature-worktree получает локальные секреты (`envs/backend.env`) автоматически | проверка `create-worktree.sh` в тестовом worktree (DoD) |

## 10. Behavioral Delta

| Аспект | До | После |
|---|---|---|
| Расположение env-файлов | `backend/` (4 файла) + `frontend/admin/` (1) | все в `envs/` (6: 5 трекаемых + 1 gitignored) |
| Имена | `.env`, `.env.dev`, `.env.test`, `.env.example` | самодокументируемые `backend.env[.role]`, `admin.env[.role]` |
| Плейграунд-CORS | ручной патч копии `.env.dev` (инцидент 2026-10-23) | tracked `backend.env.playground` с готовыми origins; патчить запрещено каноном |
| Шаг «копировать env в worktree» | в каноне плейграунда и мёртвом цикле create-worktree.sh | исчезает для трекаемых файлов; остаётся только для локального `backend.env` |
| cwd для pytest | только из `backend/` (относительный `ENV_FILE`) | любой cwd (абсолютный путь от `__file__`) |
| Рантайм-поведение приложения, CI-пайплайн, значения конфигов | — | **без изменений** |

## 11. Acceptance Criteria

- [ ] Все env-файлы лежат в `envs/`, имена по схеме `<zone>.env[.<role>]`; в `backend/` и `frontend/admin/` env-файлов нет
- [ ] 4 трекаемых файла перенесены `git mv` (история сохранена); `envs/backend.env.playground` создан и трекается
- [ ] `.gitignore`: `envs/backend.env` игнорируется; `envs/backend.env.dev|test|example|playground`, `envs/admin.env.test` — трекаются
- [ ] Реестр §5 закрыт полностью: позиции 1–17 выполнены (#1 — код не меняется, докстринг опционален); #18 (исторические доки) не трогается
- [ ] Канон плейграунда обновлён: без copy-if-absent env, старт с `envs/backend.env.playground`, примечание о запрете патчей
- [ ] Backend-суит зелёный; dryrun-тест (Case 17a) зелёный с новым паттерном; admin unit/e2e зелёные; ruff/mypy/tsc/lint чистые
- [ ] U2 smoke: `./dev.sh` поднимается, CORS preflight проходит
- [ ] Значения переменных в переносимых файлах не изменены (diff переноса — только пути/имена и правки комментариев)

## 12. Visual Compliance Checks

- N/A
