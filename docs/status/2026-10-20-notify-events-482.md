# GH #482 — Подсистема доменных событий (часть 1 системы оповещений #476)

- **Date**: 2026-10-20
- **Branch**: `feat/482-notify-events`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `f7190cae` (main) — 13 коммитов (`f7051238..1a601c2c`), 42 файла, +4629/−14
- **Issue**: #482 — notify subsystem part 1: доменные события (журнал, диспетчер, сценарий `new_record` с рендером); семья — #476 (система оповещений)
- **Спека**: `docs/specs/2026-10-19-notify-events-482-design.md` (рев.2)
- **План**: `docs/plans/2026-10-20-notify-events-482-plan.md` — 10/10 задач, все done
- **Domain rules**: `docs/domain-rules/notify.md` — в синхроне (проверено финальным ревью); `docs/domain-rules/records.md` — обновлён в задаче 6
- **Характер**: backend-подсистема с тонким фронтом (флаг формы) — без Redis по построению (очередь — порт + FakeQueue, диспетчер — процесс на опросе), часть 2 (доставка) не строится

## Что выполнено

1. **Миграция и ORM-модели (T1, `f7051238`, standard)** — миграция `c970adc6b3d6`
   (таблицы notify-подсистемы) + ORM-модели `backend/src/notify/models.py`;
   каскадные хвосты удаления (`domain/deletion.py`, `services/client.py`) и
   тесты миграции.
2. **Настройки, бизнес-время, зависимость (T2, `60ef558e`, small)** — notify-настройки
   в `core/config.py`, `notify/time.py` с `business_now()`, зависимость
   `jinja2>=3.1.6` в `pyproject.toml` + `uv.lock`.
3. **Очередевой порт (T3, `30175968`, small)** — `notify/queue.py`: порт `NotifyQueue`
   + `FakeQueue` с reliable-list паттерном (шов к части 2 — Redis-реализация
   подменяется без изменения диспетчера).
4. **Журнал доменных событий (T4, `8b25872d`, standard)** — аккумулятор журнала
   `domain_events` как третий аккумулятор `@transactional` (врезка в
   `services/decorators.py` рядом с событиями #239 и аудитом #344);
   транзакционные гарантии пиняются `test_notify_journal_transactional.py`.
5. **Снапшот `new_record` (T5, `8ed09885`, standard)** — сборщик снапшота в
   `notify/snapshots.py` + хелпер `record_total_price`; интерпретации времени
   по спеке §3.2.
6. **Флаг notify по цепочке (T6, `0f9d977d`, standard)** — флаг «отправлять
   оповещения» проходит цепочку front→back: `useRecordMutations` (front) →
   api-client (`schemas.ts` + zod) → `RecordCreate` (backend) → гейт актёра;
   в сценарии `create_record` (`usecases/records.py`) — постановка метки
   события; `docs/domain-rules/records.md` синхронизирован в задаче.
7. **Рендер текста (T7, `45086fa2` + фикс `f8341ad9`, standard)** — песочница
   jinja2 в `notify/render.py`: шаблоны из БД, экранирование разметки;
   харденинг после ревью — полный wrap в `RenderError` + экранирование
   backslash-ов (защита от инъекций через тело шаблона).
8. **Сценарий-реакция `new_record` (T8, `d1537016` + фикс `88fca574`, standard)** —
   обработчик + реестр сценариев (`notify/scenarios.py`): live-предикат,
   frozen-каналы, постановка задач по §4.2 спеки; линт-фиксы и относительные
   будущие даты в тестах после ревью.
9. **Диспетчер-процесс (T9, `6710caba` + фикс `fb2f085c`, large)** —
   `notify/dispatcher.py`: три TaskGroup-цикла, политика попыток, re-enqueue,
   парсинг приоритетов; фикс после ревью качества — batch-resilience: падение
   обработчика не роняет батч (остаток батча обрабатывается), + observability.
10. **Канон сида и полная зелёность (T10, `1a601c2c`, small)** — blacklist
    notify-журнальных таблиц в `scripts/gen_seed_canon.py` + тесты исключения
    в `seed-reset`; финальный полный прогон зелёный.

## Верификация (финальное дерево, `1a601c2c`)

| Проверка | Результат |
| --- | --- |
| Полный backend `uv run pytest` | **3504 passed / 0 failed / 15 skipped** (15 skip — без Redis, US-7 по построению) |
| Admin vitest (seed-reset) | **26/26**, вкл. новые гарды канона |
| Admin vitest (useRecordMutations) | **80/80** |
| api-client vitest | **472/472** |
| Lint-рахет `scripts/lint_budget.py` | **114 == 114** (роста нет) |
| mypy | **0** |
| Визуальный комплаенс-гейт (G4.5) | **exit 0** — секция Visual Compliance Checks спеки помечена N/A (новых видимых поверхностей нет — только чекбокс флага в существующей форме) |

## DoD-статус

- **Все DoD 10 задач плана выполнены**; US-1…US-8 спеки проверены.
- Часть 2 (доставка оповещений, Redis-очередь) — вне скоупа, шов `NotifyQueue`
  готов.

## Ревью

- Каждая задача — two-stage ревью (small-задачи — комплаенс-стадия);
- 3 фикс-цикла: харденинг рендера (`f8341ad9`), линт сценариев (`88fca574`),
  batch-resilience диспетчера (`fb2f085c`) — каждый верифицирован повторным
  ревью;
- Финальное full-feature ревью — ✅ COMPLIANT.

## Behavioral Delta

По спеке §7: новые записи с включённым флагом «отправлять оповещения» создают
событие `new_record` в журнале `domain_events` и постановку задач сценария;
без включённого флага и для всех остальных потоков — поведение прежнее.
Диспетчер в части 1 ничего не отправляет (доставка — часть 2).

## PR-заметки

- `Closes #482` — только в описании PR (канон репо), в коммиты не пишется.
- Семья #476: это часть 1 из запланированных; спека семьи —
  `docs/specs/2026-10-11-notify-system-476-design.md`.

## Тронутые файлы (`git diff --name-only f7190cae..1a601c2c`)

```
backend/alembic/env.py
backend/alembic/versions/c970adc6b3d6_notify_subsystem_tables.py
backend/pyproject.toml
backend/src/core/config.py
backend/src/domain/deletion.py
backend/src/models/__init__.py
backend/src/models/client.py
backend/src/models/record.py
backend/src/notify/__init__.py
backend/src/notify/dispatcher.py
backend/src/notify/journal.py
backend/src/notify/models.py
backend/src/notify/queue.py
backend/src/notify/render.py
backend/src/notify/scenarios.py
backend/src/notify/snapshots.py
backend/src/notify/time.py
backend/src/schemas/record.py
backend/src/services/client.py
backend/src/services/decorators.py
backend/src/services/record.py
backend/src/usecases/records.py
backend/tests/domain/test_deletion.py
backend/tests/domain/test_deletion_family.py
backend/tests/test_api_records_notify_flag.py
backend/tests/test_notify_dispatcher.py
backend/tests/test_notify_journal_transactional.py
backend/tests/test_notify_migration.py
backend/tests/test_notify_queue.py
backend/tests/test_notify_render.py
backend/tests/test_notify_scenarios.py
backend/tests/test_notify_settings_time.py
backend/tests/test_notify_snapshots.py
backend/tests/usecases/test_records_create_notify_event.py
backend/uv.lock
docs/domain-rules/records.md
frontend/admin/__tests__/seed-reset.test.ts
frontend/admin/__tests__/useRecordMutations.test.ts
frontend/admin/hooks/useRecordMutations.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
scripts/gen_seed_canon.py
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` + `docs/status/2026-10-20-notify-events-482.md`
— только мета-доки; код/спеки/планы/domain-rules не тронуты.

## Scope guards

Часть 2 (доставка, Redis) не строилась; existing-поведение записей без флага —
без изменений; спека/план на ветке с базы, docser их не касался; `Closes #482`
— только в описании PR (канон репо).

## References

- **GitHub Issue**: #482 (семья #476)
- **Design Spec**: `docs/specs/2026-10-19-notify-events-482-design.md` (рев.2)
- **Family Spec**: `docs/specs/2026-10-11-notify-system-476-design.md`
- **Plan**: `docs/plans/2026-10-20-notify-events-482-plan.md` (10/10)
- **PR**: _(to be added after PR creation)_
