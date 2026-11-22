# План #616 — Прод-деплой из main: релизы milestone → образы → VPS

**Goal:** воспроизводимая доставка приложения из main на прод-сервер с откатом по спеке `docs/specs/2026-11-21-prod-deploy-616-design.md` (рев.2): релиз milestone → 3 образа в GHCR → деплой на VPS (миграции + healthcheck), откат — повтор с предыдущим тегом.

**Architecture:** 3 образа (backend — uvicorn single-process с прокси-заголовками; admin — Next standalone с basePath `/admin`; web — статический экспорт в nginx:alpine) публикуются по тегу релиза; `deploy.yml` (триггер `release: published` + dispatch) собирает и катит через SSH `deploy.sh`; локальная проверяемость до VPS — `prod-smoke.sh`.

**Tech Stack:** Docker/compose, GitHub Actions (buildx, GHCR), gh CLI, bash, uv, Next 14 standalone, nginx:alpine.

Порядок: 1 → 2 → 3 → 4 → 6; 5 независимо. Задачи 1–2 правят приложение, 3–6 — инфраструктура.

## Task 1: Прод-режим backend — валидация ENV, sqladmin по флагу, WAL-прагмы

### Classification: small

Правки приложения: `ENV` — `Literal["development","testing","production"]` с отказом старта на неизвестном значении (сегодня опечатка молча выключает все прод-защиты); sqladmin монтируется только по явному флагу включения (по умолчанию выключен, инверсия текущего `ENV != "testing"`); проверить и закрепить прагмы `journal_mode=WAL` + `busy_timeout` в настройке движка БД.

Юнит-тесты: неизвестный `ENV` → ошибка валидации; флаг по умолчанию выключен → sqladmin не монтируется; флаг включён → монтируется.

### Required Docs

Спека §3.3 (валидация режима), §3.4 (sqladmin), §3.2 (WAL). Дом-правила не затронуты.

### DoD

Юнит-тесты задач зелёные; полный бэкенд-сюит не деградирует (существующие тесты с `ENV=testing` не затронуты).

## Task 2: Frontend сборочные аргументы — относительный `/api`, basePath админки, standalone

### Classification: small

`frontend/admin/next.config.mjs`: `output: 'standalone'`, `basePath` от `NEXT_PUBLIC_BASE_PATH` (аргумент пуст в dev — dev не меняется), `images.unoptimized: true`. Сборки web/admin принимают `NEXT_PUBLIC_API_URL=/api` (относительный — образы не зависят от домена). Юнит-проверка api-client: относительный base собирает запросы same-origin корректно (dev-фолбэк `http://<host>:8000` нетронут).

### Required Docs

Спека §3.1 (таблица образов, относительный `/api`). Дизайн-система не затронута.

### DoD

Юнит api-client зелёный; локальная сборка admin с тремя аргументами (`/api`, `/admin`, standalone) проходит; `next dev` обеих приложений работает как раньше.

## Task 3: Каталог `deploy/` — 3 Dockerfile + `docker-compose.prod.yml` + nginx веба

### Classification: standard

### Dispatch:

1. `deploy/Dockerfile.backend` — uv-образ, uvicorn без `--reload`, 1 процесс, `--proxy-headers --forwarded-allow-ips` со значением из ARG (по умолчанию — адрес шлюза compose-сети, никогда `*`), без curl — @backend-coder — сборка из чистого чекаута зелёная.
2. `deploy/Dockerfile.admin` — multi-stage node-сборка с аргументами задачи 2 → standalone-рантайм; докопировать `public/` и `.next/static` (standalone их не включает) — @frontend-coder — образ собирается, контейнер отдаёт `/admin`.
3. `deploy/Dockerfile.edge` + `deploy/nginx.conf` — сборка статики веба → `nginx:alpine` со статикой и конфигом сайта: 80 (редирект + ACME-путь), 443 TLS (сертификаты монтируются с хоста), `/` → статика с SPA-fallback, `/images/` → примонтированный медиа-каталог, `/admin` → сервис admin, `/api` → сервис backend (без переписывания путей), `X-Forwarded-Proto`, лимит тела под загрузки — @frontend-coder — образ собирается, контейнер отдаёт `/` и проксирует `/api`/`/admin`.
4. `deploy/docker-compose.prod.yml` — сервисы `edge`/`backend`/`admin`; наружу публикует только edge (80/443), backend и admin без опубликованных портов (edge ходит по именам сервисов); `env_file` для backend с путём из спеки §3.3 (`/opt/memo/env/production.env`); тома `/opt/memo/data`, `/opt/memo/files` и `/opt/memo/web-media` (edge монтирует read-only, отдаёт по `/images/`); `stop_grace_period` для флаша WAL; healthcheck python-однострочником (`urllib.request`, `/api/v1/health`); подсеть закреплена, edge — статический IP (значение `FORWARDED_ALLOW_IPS`) — @backend-coder — `docker compose config` валиден.

Build-args несут только публичные значения (проверить отсутствие секретов в аргументах сборки).

### Required Docs

Спека §3.1–3.3.

### DoD

Все 3 образа собираются локально из чистого чекаута одной командой; compose-конфиг валиден.

## Task 4: `deploy.yml` + `deploy.sh` + PR-проверка сборки и запуска

### Classification: standard

### Dispatch:

1. `.github/workflows/deploy.yml` — триггеры `release: [published]` + `workflow_dispatch` (вход `tag`); job build: чекаут по `github.event.release.tag_name`, buildx 3 образов, push с тегом релиза, префикс реестра из переменной (дефолт `ghcr.io/<владелец репо>`; репо публичный → пакет публичен, токен не нужен; `REGISTRY_TOKEN` — только если пакет переведён в private), секреты `DEPLOY_SSH_HOST`/`DEPLOY_SSH_USER`/`DEPLOY_SSH_KEY` + секреты приложения для рендера env (`SECRET_KEY`, `OTP_PEPPER`, транспорты — §3.3 спеки), минимальные `permissions`; job deploy: `concurrency: prod-deploy` без cancel, GitHub environment `production`, SSH + scp (`deploy.sh` + `render-env.sh` + compose из чекаута релиза) + запуск — @backend-coder — линт схемы workflow зелёный.
2. `deploy/deploy.sh` + `deploy/render-env.sh` — рендер env-файла из переменных джоба (атомарно, 0600, значения не печатаются; тот же скрипт используют CI-смоук и `prod-smoke.sh`), при заданном `REGISTRY_TOKEN` логин в реестр (read:packages), pull по тегу, `docker compose run --rm backend alembic upgrade head`, `up -d`, ожидание health через edge (`GET /api/v1/health` на хосте — вся цепочка nginx → backend → БД) python-циклом с таймаутом, внятные коды выхода (провал healthcheck ≠ провал миграций) — @backend-coder — shellcheck чистый.
3. `test.yml`: новый job сборки 3 образов **без push + запуск** (backend health `/api/v1/health`, admin `/admin`, web `/`); тестовый env — литералы-пустышки через `render-env.sh` в канонический путь `/opt/memo/env/production.env` (runner — root, каталог создаётся джобой; замена упавшей подмены оверрайдом: `env_file` базового compose при склейке не переписывается — путь остаётся каноническим, файл создаёт рендер) — @backend-coder — job зелёный на PR этой ветки.

### Required Docs

Спека §4.2–4.3, §7 (сценарий 5).

### DoD

Полный CI прогон PR зелёный включая новый job — @tester. Сценарий 5 спеки: любой PR ломает/не ломает прод-сборку видимо до мержа. Сценарий 1, локальная часть: PR-job зелёный + смоук миграций/health (Задача 6) зелёный.

## Task 5: `scripts/release.sh` — milestone → релиз

### Classification: small

gh CLI: (1) все issues milestone закрыты — иначе стоп (форс `--force`); (2) закрыть milestone; (3) notes из issues milestone (номер + заголовок); (4) `gh release create <tag> --target main`; флаг `--dry-run` печатает действия без выполнения (для проверки и для DoD).

### Required Docs

Спека §4.1.

### DoD

`--dry-run` на живом milestone печатает корректный план (список issues, тег, целевой коммит); shellcheck чистый; релиз не создаётся.

## Task 6: `scripts/prod-smoke.sh` — локальный смоук прода

### Classification: small

Чистый временный каталог с томами → тестовый env рендерится `render-env.sh` в канонический путь `/opt/memo/env/production.env` (на imac — одноразовый `sudo mkdir -p /opt/memo/env`) → миграции → `up -d` → проверки через edge с выключенным TLS (оверрайд: сертификатов на imac нет): `/api/v1/health` 200, `/` отдаётся, `/admin` оболочка, анониму 401 на API → ассерт наличия `-wal`/`-shm` на томе (критерий закрепления WAL-прагм Задачи 1) → teardown. Два режима сверх базового: повторный прогон с предыдущим тегом (сценарий 2 — откат); env без `SECRET_KEY`/`OTP_PEPPER` → контейнер отказывается стартовать (сценарий 4, уровень образа).

### Required Docs

Спека §5, §7 (сценарии 2–4).

### DoD

Смоук зелёный на imac: сценарии 2, 3, 4 спеки проходят; teardown не оставляет контейнеров/томов.
