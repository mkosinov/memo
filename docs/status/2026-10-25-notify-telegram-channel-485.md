# GH #485 — Канал Telegram (Telethon/MTProto) + перестройка задачи на канал (часть 4 системы оповещений #476)

- **Date**: 2026-10-25
- **Branch**: `485-notify-telegram-channel`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `1e0f354e` — 13 коммитов (`459b82de..a848d8e4`), 52 файла, +6923/−711
- **Issue**: #485 — notify subsystem part 4: первый реальный канал доставки (Telegram через пользовательский аккаунт студии, MTProto/Telethon) и перестройка механизма — задача = один канал с замороженным шаблоном и данными рендера, сборка текста в воркере, цепочка каналов задачами, лимиты с защитой аккаунта, отправленный текст в журнале попыток; семья — #476 (часть 4/5; части 1–3 = #482/#483/#484 на main)
- **Спека**: `docs/specs/2026-10-25-notify-telegram-channel-485-design.md` (рев.2 + errata §4.1 `template_channel`)
- **План**: `docs/plans/2026-10-25-notify-telegram-channel-485-plan.md` — 6/6 задач, все done
- **Domain rules**: `docs/domain-rules/notify.md` — синхронизирован этой веткой (+6/−1)
- **ADR**: `docs/decisions/014-per-channel-tasks-worker-render.md` — per-channel-задачи, рендер в воркере; ADR 009 неприкосновенно (воркер без БД)
- **Новая зависимость**: `telethon>=1.34` (backend) + `backend/scripts/generate_telegram_session.py`

## Что выполнено

1. **Модель и миграции (T1, `459b82de` standard, линт-фикс `84145990`)** —
   пер-канальная задача: `NotifyTask` получил канал/шаблон-снапшот/данные
   рендера, шаблоны связаны с каналом, попытка хранит `sent_text`;
   миграции `d94b1f7c2a6e` (per-channel-задачи) + `a7c3e9f1b2d4`
   (template origin), UNIQUE-шов и lookup, skip-landing.
2. **Сборка текста в воркере + протокол канала (T2, `7fc0386e` standard,
   фикс `e618b10e`)** — воркер собирает текст один раз в песочнице
   Jinja2 по escape-режиму канала (`assembly.py`); протокол канала
   расширен escape-режимом и крестовым кейсом; мок-канал — декларативные
   настройки лимитов (ревью T2).
3. **Общий механизм лимитов канала (T3, `0e497697` standard, фикс
   `794a23cf`)** — суточный потолок, окно паузы, служебное сообщение при
   упоре в потолок (`channels/limits.py`); человеческое имя канала в
   служебном сообщении (ревью T3).
4. **Канал Telegram (T4, `4bb48e5b` standard + errata `edfc794f`)** —
   `channels/telegram.py` на Telethon (пользовательский аккаунт,
   MTProto), parse-режим и нормализация адресатов; контракт-errata:
   `template_channel` в §4.2 семейной спеки, протокол ADR 014, §4.1
   модели 485-спеки (ревью T4).
5. **Диспетчер — цепочка каналов (T5, `ce50cddc` standard)** —
   заморозка в сценарии, при терминальной неудаче канала спавн задачи
   следующего канала (`UNIQUE(root_task_id, channel)` —
   идемпотентность), итог цепочки на корневой задаче, PEL-предикат
   пере-заливки.
6. **Тестовое покрытие (T6, `4be81545` + `466d5ce9` + `e603f003` +
   `a848d8e4`)** — юниты: таблица §6.4 построчно, заморозка/lookup,
   крестовое экранирование, сборка один раз, идемпотентность спавна,
   лимиты; контур `pytest -m redis`: потолок + служебное сообщение +
   флаг окна, skip-ветка цепочки, пагинация PEL; E2E §12-1/2/3/5 на
   мок-каналах (второй мок `mock2` для §12-3, стек на приоритете
   `mock,mock2`); dryrun-сюит пополнен.

## Отклонения и фикс-циклы

- **`edfc794f` (errata по ревью T4):** контракт-факт `template_channel`
  в §4.2 семейной спеки (§4.1), ADR 014 и §4.1 485-спеки выправлены под
  реализацию.
- **`84145990` / `e618b10e` / `794a23cf`** — фикс-итерации ревью T1–T3
  (линт-бюджет F401/I001/mypy re-export; декларативные настройки лимитов
  мок-канала; человеческое имя канала в служебном сообщении).

## Верификация (финальное дерево, `a848d8e4`)

| Проверка | Результат |
| --- | --- |
| Backend полный, без `REDIS_URL` | **3949 passed / 0 failed** |
| Маркированный контур `pytest -m redis` | **55 passed / 1 known env-skip / 0 failed** |
| notify e2e-контур (`notify-s6-mock-delivery.spec.ts`) | **5/5** (S6 + §12-1/2/3/5) |
| ruff + mypy + lint-бюджет | **зелёные** |

## DoD-статус

- Модель: UNIQUE + lookup + skip-landing ✅.
- Сборка: escape-режим + крестовый кейс + «собирается один раз» ✅.
- Лимиты: потолок/пауза/служебное сообщение — DoD ✅.
- Telegram-канал: §6.4 построчно, нормализация, parse-режим,
  доступность ✅.
- Цепочка: контур DoD (спавн, идемпотентность, итог на корне) ✅.
- E2E: §12 сценарии 1/2/3/5 ✅ (сценарий 4 не входил в план).

## Ревью

- Все 6 задач — standard, two-stage ревью пройдены; фикс-итерации T1–T4
  сложены в ветку (`84145990`, `e618b10e`, `794a23cf`, `edfc794f`).

## Behavioral Delta

По умолчанию (без настроенного Telegram) поведение прежнее: мок-каналы
покрывают юнит/контур/e2e. Реальная доставка появляется у канала
`telegram` — отправка через пользовательский аккаунт студии (MTProto),
с лимитами (суточный потолок + пауза + служебное сообщение) и
журналированием отправленного текста в попытке. Задача = один канал:
диспетчер спавнит следующего кандидата приоритета при терминальной
неудаче, итог цепочки живёт на корневой задаче. Шаблоны правятся
админкой как раньше (правка подхватывается новыми задачами; в полёте —
замороженный снапшот, e2e §12-5).

## PR-заметки

- `Closes #485` — только в описании PR (канон репо), в коммиты не пишется.
- Семья #476: часть 4 из 5; части 1–3 (#482/#483/#484) на main;
  спека семьи — `docs/specs/2026-10-11-notify-system-476-design.md`.

## Тронутые файлы (`git diff --name-only 1e0f354e..a848d8e4`)

```
backend/alembic/versions/a7c3e9f1b2d4_notify_task_template_origin.py
backend/alembic/versions/d94b1f7c2a6e_per_channel_notify_tasks.py
backend/pyproject.toml
backend/scripts/generate_telegram_session.py
backend/src/core/config.py
backend/src/notify/assembly.py
backend/src/notify/channels/__init__.py
backend/src/notify/channels/base.py
backend/src/notify/channels/limits.py
backend/src/notify/channels/mock.py
backend/src/notify/channels/mock2.py
backend/src/notify/channels/registry.py
backend/src/notify/channels/telegram.py
backend/src/notify/dispatcher.py
backend/src/notify/models.py
backend/src/notify/queue.py
backend/src/notify/redis_queue.py
backend/src/notify/render.py
backend/src/notify/scenarios.py
backend/src/notify/worker.py
backend/tests/notify_redis_support.py
backend/tests/test_notify_assembly.py
backend/tests/test_notify_channel_limits.py
backend/tests/test_notify_channel_telegram.py
backend/tests/test_notify_channels.py
backend/tests/test_notify_channels_mock.py
backend/tests/test_notify_channels_mock2.py
backend/tests/test_notify_delivery.py
backend/tests/test_notify_dispatcher.py
backend/tests/test_notify_migration.py
backend/tests/test_notify_per_channel_model.py
backend/tests/test_notify_redis_cap_store.py
backend/tests/test_notify_redis_chain.py
backend/tests/test_notify_redis_limits_chain.py
backend/tests/test_notify_redis_queue.py
backend/tests/test_notify_redis_reenqueue.py
backend/tests/test_notify_redis_s1_queue.py
backend/tests/test_notify_redis_s6_delivery.py
backend/tests/test_notify_redis_s7_fallback.py
backend/tests/test_notify_redis_s8_recovery.py
backend/tests/test_notify_redis_worker_queue.py
backend/tests/test_notify_scenarios.py
backend/tests/test_notify_worker.py
backend/tests/test_seed_canon.py
backend/uv.lock
docs/decisions/014-per-channel-tasks-worker-render.md
docs/domain-rules/notify.md
docs/specs/2026-10-11-notify-system-476-design.md
docs/specs/2026-10-25-notify-telegram-channel-485-design.md
frontend/admin/e2e/notify-s6-mock-delivery.spec.ts
scripts/e2e-shard-start.dryrun.test.sh
scripts/e2e-shard-start.sh
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-25-notify-telegram-channel-485.md` — только
мета-доки; код/спеки/планы/domain-rules не тронуты.

## References

- **GitHub Issue**: #485 (семья #476, часть 4/5)
- **Design Spec**: `docs/specs/2026-10-25-notify-telegram-channel-485-design.md` (рев.2 + errata §4.1)
- **Family Spec**: `docs/specs/2026-10-11-notify-system-476-design.md`
- **ADR**: `docs/decisions/014-per-channel-tasks-worker-render.md`
- **Plan**: `docs/plans/2026-10-25-notify-telegram-channel-485-plan.md` (6/6)
- **Parts 1–3**: #482 — `docs/status/2026-10-20-notify-events-482.md`,
  #483 — `docs/status/2026-10-22-notify-infra-483.md`,
  #484 — `docs/status/2026-10-24-notify-worker-484.md`
- **PR**: _(to be added after PR creation)_
