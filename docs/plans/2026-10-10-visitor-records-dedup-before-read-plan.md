# План #380: дедупликация before-read SELECT в путях посетителей и записей

## Goal

Убрать ровно по одному лишнему SELECT в трёх мутационных путях (одиночное удаление посетителя, полное и частичное изменение записи), не меняя видимого поведения: ответы API, содержимое журнала действий (байт-в-байт), интерфейс — прежние. Спека: `docs/specs/2026-10-10-visitor-records-dedup-before-read-design.md` (рев.1, Gate B OK 2026-10-10).

## Architecture

- Слой: `backend/src/services/` + `backend/src/usecases/`. Сценарий читает строку один раз в начале и передаёт её вниз необязательным keyword-параметром (`existing` / `visitor`); при приёме параметра метод сверяет id строки с запрошенным (расхождение — `ValueError`, программная ошибка вызывающего); без параметра метод читает сам, как сейчас.
- `_delete_cascade` дополнительно проверяет rowcount удаления строки посетителя: 0 затронутых строк → `False` — полный паритет с нынешним «перечитал — нет строки — False».
- Транзакции и границы не меняются: одна `@transactional` на бизнес-действие (канон `docs/domain-rules/service-layer.md`, правило 6); передаваемый объект — живая строка той же сессии.
- НЕ трогаем: каскад удаления клиента (`backend/src/usecases/clients.py:223` — вызов остаётся двухаргументным, тестовые подмены не меняются), глобальные чтения (`BaseRepository.get` → `session.get` не переводим), механизм журнала, тесты подсчёта запросов (отклонены пользователем на Gate B 2026-10-10: слишком специфичный тест).

## Tech Stack

Python, async SQLAlchemy 2.x, FastAPI; pytest. Новых зависимостей нет.

## Task 1: `update_row` принимает прочитанную строку (US-2)

### Classification: small

- `RecordService.update_row` (`backend/src/services/record.py:504`): новый keyword-параметр `existing: Record | None = None`; при переданном — сверка `existing.id == id`, расхождение → `ValueError`; переданная строка используется вместо внутреннего `self.get(db_session, id)`. Docstring: зафиксировать исключение из контракта value-typed (точные формулировки — спека, §Концепт: оригиналы `"Value-typed parameters — no foreign ORM/schema objects"`).
- `update_record` (`backend/src/usecases/records.py:283`): передать `existing` (строка уже прочитана для `_old` выше; порядок «снимок до мутации» — инвариант #344 §4.2 — не меняется).
- DoD: тесты сценария US-2 зелёные до и после правки (страж неизменности): точные `changes`-словари `backend/tests/test_audit_explicit.py`, `backend/tests/test_api_records.py`.

### Required Docs

- `docs/domain-rules/service-layer.md` (правила 2, 4, 6 — коридор и передача собственной строки)
- `docs/specs/2026-09-20-audit-log-344-design.md` (§4.2 — «до»-половина diff до первой мутации)
- `docs/domain-rules/records.md`

## Task 2: `patch_row` принимает прочитанную строку (US-3)

### Classification: trivial

- `RecordService.patch_row` (`backend/src/services/record.py:539`): то же, что Task 1 — keyword-параметр `existing`, сверка id, использование вместо внутреннего чтения; docstring `"Value-typed input only"` дополняется тем же исключением.
- `patch_record` (`backend/src/usecases/records.py:376`): передать `existing`.
- DoD: тесты сценария US-3 зелёные до и после: `test_audit_explicit.py` (diff только по явным полям), `test_api_records.py`.

### Required Docs

- `docs/domain-rules/service-layer.md`
- `docs/specs/2026-09-20-audit-log-344-design.md` (§4.2)
- `docs/domain-rules/records.md`

## Task 3: `_delete_cascade` принимает строку + rowcount-паритет (US-1, US-4)

### Classification: small

- `VisitorService._delete_cascade` (`backend/src/services/visitor.py:187`): keyword-параметр `visitor: Visitor | None = None`; при переданном — сверка `visitor.id == visitor_id` (`ValueError`), внутреннее чтение пропускается; результат `delete(Visitor)` проверяется по rowcount — 0 затронутых строк → `False`. Docstring ядра: убрать ставшую ложной фразу о неизменности сигнатуры («The name and signature are kept EXACTLY as-is»), зафиксировать новый необязательный параметр и rowcount-семантику.
- `VisitorService.delete` (`backend/src/services/visitor.py:228`): передать прочитанную для метки журнала строку.
- Каскад клиента НЕ меняется: `backend/src/usecases/clients.py:223` остаётся двухаргументным; тестовые подмены (`backend/tests/test_api_clients.py:1246`, `backend/tests/usecases/test_clients_delete.py:548`) не трогаются.
- DoD: тесты сценариев US-1 и US-4 зелёные до и после: `test_audit_explicit.py` (delete посетителя — label + before-снимок), негативные 404-тесты удаления посетителя.

### Required Docs

- `docs/domain-rules/visitors.md`
- `docs/domain-rules/service-layer.md` (правило 3 — декорированный тонкий метод над ядром без транзакции)
- `docs/specs/2026-09-20-audit-log-344-design.md` (§4.1, §8 — метка до исчезновения строки; дети каскада не журналируются)

## Task 4: регрессионная сверка и полный прогон (US-5 и все)

### Classification: trivial

- Полный pytest бэкенда; обязательные зелёные: `test_audit_explicit.py`, `test_audit_log_transactional.py`, `test_audit_autocollect.py`, `test_api_records.py`, `delete_family_full_contract.py`, сюиты посетителей.
- Финальная сверка приёмки по диффу: в трёх путях второй SELECT отсутствует, новых запросов не появилось (субъектная приёмка issue; тестов счёта нет по решению Gate B).
- DoD: полный pytest зелёный; US-5 зелёный (`delete_family_full_contract.py` — каскад клиента не задет).

### Required Docs

- `docs/specs/2026-09-20-audit-log-344-design.md`
- `docs/specs/2026-10-10-visitor-records-dedup-before-read-design.md` (§Гонки и границы транзакции — сверка выводов)
