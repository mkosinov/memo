# GH #380 — Дедуп before-read SELECT в visitor/records путях (`update_row` / `patch_row` / `_delete_cascade`)

- **Date**: 2026-10-11
- **Branch**: `380-visitor-records-dedup`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `816efac2` — 4 коммита (`29205322..5b3ba89d`) + merge main `4d65fe8b`,
  3 файла (наша работа), +119/−36
- **Issue**: #380 — техдолг: три мутационных пути (полное обновление записи, частичное
  обновление записи, одиночное удаление посетителя) делают лишний before-read SELECT —
  строка читается дважды (проверка + работа)
- **Спека**: `docs/specs/2026-10-10-visitor-records-dedup-before-read-design.md`
  (рев.1, Gate B OK 2026-10-10)
- **План**: `docs/plans/2026-10-10-visitor-records-dedup-before-read-plan.md` — 4/4 задач,
  все done
- **Характер**: невидимый рефактор — минус один SELECT на запрос в трёх путях; видимое
  поведение (ответы API, журнал действий байт-в-байт, UI) не изменилось

## Что выполнено

1. **T1 — `update_row` принимает прочитанную строку (US-2)** — `29205322` (small):
   `RecordService.update_row` получил необязательный keyword-параметр `existing` —
   при приёме сверка id (расхождение → `ValueError`), без параметра метод читает сам,
   как раньше; сценарий `usecases/records.py` читает строку один раз и передаёт вниз —
   второй before-read SELECT убран.
2. **T2 — `patch_row` принимает прочитанную строку (US-3)** — `216ff4c9`
   (trivial→small): тот же контракт для частичного обновления записи.
3. **T3 — `_delete_cascade` принимает прочитанную строку + rowcount-паритет
   (US-1, US-4)** — `8dbc3aad` (small; + typing-фикс `5b3ba89d`):
   `VisitorService._delete_cascade` получил необязательный keyword-параметр `visitor`
   (сверка id аналогично); дополнительно проверяет rowcount удаления строки посетителя —
   0 строк → `False` (паритет с прежним «перечитал — нет строки — `False`»).
4. **T4 — регрессионная сверка + полный прогон (US-5)** (trivial): полный backend pytest
   зелёный (см. таблицу); приёмка по диффу подтверждена ревьюерами — второй SELECT
   отсутствует во всех трёх путях, новых запросов нет.

## Границы (не тронуто — по плану)

- каскад удаления клиента: `usecases/clients.py` — двухаргументный вызов
  `_delete_cascade` сохранён (форма main/#466);
- глобальные `BaseRepository.get` / `session.get`;
- механизм журнала действий;
- **новых тестов НЕТ** — тесты подсчёта запросов отклонены пользователем на Gate B
  2026-10-10; приёмка — ревью диффа (см. T4).

## Верификация

| Проверка | Результат |
| --- | --- |
| Guard-сьюты `test_audit_explicit` + `test_api_records` | **153/0** — до и после каждой правки (страж неизменности) |
| Пост-мерж затронутые сьюты (audit/records/visitors/clients_delete/events_emit) | **202/0** |
| Lint-рахет | mypy **0**, ruff **117/117** (бюджет) |
| Полный backend pytest | **3208p / 0f / 15s** (EXIT 0, ~90 мин; машина делила нагрузку с параллельным прогоном) |
| US-1..US-5 | все зелёные (US-5 = `delete_family_full_contract` в полном прогоне — каскад клиента не задет) |
| Приёмка по диффу | ревьюеры: второй SELECT отсутствует в трёх путях, новых запросов нет |
| Visual Compliance | N/A (backend-only, видимого поведения нет) |

## Behavioral Delta

Отсутствует. Единственный эффект — минус один SELECT на запрос в трёх путях;
ответы API, журнал действий (байт-в-байт), UI — прежние.

## Merge с main (`4d65fe8b`)

main уехал на #466/#375 (метка `visits`) — конфликт в `backend/src/services/visitor.py`
разрешён с сохранением семантики обеих сторон (#375 событийная сетка + #380
`existing`/rowcount-контракт); `clients.py` и тест-файлы — авто-мерж main.

## Тронутые файлы (наша работа, без авто-мержа main)

```
backend/src/services/record.py
backend/src/services/visitor.py
backend/src/usecases/records.py
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-11-visitor-records-dedup-380.md` —
только meta-доки, код/тесты/спека/план не тронуты.

## References

- **GitHub Issue**: #380
- **Design Spec**: `docs/specs/2026-10-10-visitor-records-dedup-before-read-design.md`
- **Plan**: `docs/plans/2026-10-10-visitor-records-dedup-before-read-plan.md` (4/4)
- **PR**: _(to be added after PR creation)_
