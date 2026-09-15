# Спека: дедупликация enum VisitStatus + чистка сырых строк статусов

- Issue: #134 (tech-debt, backend)
- Дата: 2026-09-15
- Статус: черновик на гейт G1b
- Автор: auto-DESIGN watcher (протокол `.zcode/skills/auto-design`), G1a утверждён юзером 2026-09-15

## 1. Проблема

В бэкенде есть два одинаковых enum `VisitStatus` (значения `waiting` / `visited` / `missed` / `cancelled`):

1. `backend/src/models/enums.py:18` — `class VisitStatus(str, enum.Enum)`. Потребители: `backend/src/schemas/visit.py:5` и `backend/src/schemas/record.py:8` (Pydantic-типы полей схем).
2. `backend/src/domain/visit_status.py:8` — `class VisitStatus(str, Enum)`; в том же файле живёт смысловая логика статусов после #98: `ACTIVE_RECORD_STATUSES` (:18) и `compute_record_status` (:28). Потребители: `backend/src/domain/record_visits.py`, `backend/src/services/activity.py:14,196`, `backend/src/services/visit.py`, `backend/src/services/record.py`, юнит-тесты `backend/tests/test_compute_record_status.py:3`, `backend/tests/test_record_visits.py:4`.

Значения сегодня идентичны, но это два независимых класса: добавить статус в одну копию и забыть вторую — тихий дефект дрейфа. Дополнительно часть продакшен-кода обращается со статусами как с сырыми строками, дублируя значения в третий раз.

Проверено скаутом по живому коду (все утверждения issue подтверждены, номера строк уточнены: 18 и 8, а не 28 и 8).

## 2. Решение

### 2.1 Канон — `src/domain/visit_status.py`, дубль удаляется без алиаса

- Единственное определение `VisitStatus` остаётся в `backend/src/domain/visit_status.py`.
- Определение в `backend/src/models/enums.py:18-22` удаляется; реэкспорта/алиаса на старом месте не оставляем.
- Единственные импортеры удаляемой копии — `backend/src/schemas/visit.py:5` и `backend/src/schemas/record.py:8` — перепривязываются на `src.domain.visit_status` (прямой импорт, не через `record_visits`). Больше импортеров нет (проверено скаутом: `api/v1/visits.py` использует схему `VisitStatusUpdate`, а не enum).
- Направление «схемы → домен» — существующий паттерн репо (`backend/src/schemas/client.py:8` импортирует `phone_digits`); цикла импорта не возникает (домен ничего не импортирует из схем).
- Остальные enum в `models/enums.py` (UserRole, RecordStatus, PaymentMethod, Channel, ArchiveStatus) не трогаются.

Отвергнутые варианты: канон в `models/enums.py` (домен начинает зависеть от модуля ORM-окружения — неверное направление, больше потребителей к перепривязке) и алиас-реэкспорт (сохраняет видимость двух мест — та самая ловушка дрейфа, против которой направлено issue).

### 2.2 Политика чистки сырых строк

**Меняются на ссылки на enum-члены** все сырые литералы статусов в продакшен-коде `backend/src` вне определений enum (правило единое: используем член enum — `VisitStatus.MISSED`, без `.value`; `str`-mixin делает член полноценной строкой для сравнений, дефолтов, bind-параметров SQLAlchemy и json-сериализации; исключение — существующий `ACTIVE_RECORD_STATUSES`, уже хранящий строки-значения, его не трогаем):

| Место | Сейчас | Станет |
|---|---|---|
| `backend/src/services/client.py:117` | `Record.status == "missed"` | `Record.status == VisitStatus.MISSED` |
| `backend/src/services/record.py:712` | `visit_item.get("status", "waiting")` | дефолт `VisitStatus.WAITING` |
| `backend/src/schemas/record.py:143` | `RecordStatusFilter = Literal["waiting","visited","missed","cancelled"]` | `RecordStatusFilter = VisitStatus` (см. 2.3) |
| `backend/src/seed/seed.py:432-437,445-454` | 16 литералов в seed-словарях (6 у записей + 10 у визитов) | члены `VisitStatus` |

**Остаются сырыми строками** (осознанно, границы зафиксированы):

- `backend/alembic/versions/4d5e6f7a8b9c_add_status_derivation.py` (19 литералов) — исполненные миграции не редактируются и код не импортируют.
- Тесты (около 200 литералов: JSON-пейлоады API, конструкторы моделей, ассерты) — строка здесь формат провода и тестовые данные; конвертация — объёмный churn без защиты от дрейфа. Ни один тест не импортирует enum из `models.enums` (проверено скаутом), поэтому удаление копии не требует правок тестов.
- Фронтенд (`packages/domain/src/visit_status.ts` и его потребители в `packages/api-client`) — самостоятельная копия на границе домена, вне скоупа.
- e2e (`frontend/admin/e2e/`) — работают с русскими UI-метками, data-testid и URL-параметрами; к бэкенд-enum не привязаны.

Граница «seed конвертируем, тесты нет»: seed — исполняемый код в продакшен-дереве `backend/src`, его конвертация дешёвая и делает критерий готовности 3 механически проверяемым grep-ом; тестовые строки — формат провода и данные, их конвертация — объёмный churn без добавленной защиты.

### 2.3 Замена `Literal` на enum: поведение и OpenAPI

`RecordStatusFilter` — тип query-параметра фильтра статуса записи (`backend/src/schemas/record.py:143`); потребителей имени типа вне этого файла нет. Решение: аннотация поля меняется прямо на `VisitStatus`, имя `RecordStatusFilter` удаляется вместе с `Literal`-определением (алиас-реэкспорт противоречил бы принципу 2.1 «без алиасов»).

Набор допустимых значений фильтра не меняется: выводимый статус записи хранит ровно эти четыре значения (`compute_record_status` возвращает `VisitStatus`; колонка `backend/src/models/record.py:23` — `String(20)`).

**Известное микрорасширение входа (Behavioral Delta).** Pydantic v2 валидирует `str`-enum в smart-режиме: помимо строковых значений (`waiting`) принимается и имя члена (`CANCELLED`), которое `Literal` раньше отклонял с 422. Расширение одностороннее и безвредное: сравнение фильтра идёт по значению (`VisitStatus.CANCELLED == "cancelled"`), фронтенд присылает только нижний регистр. Фиксируем как осознанную дельту, а не регрессию.

OpenAPI-схема параметра остаётся перечислением с теми же значениями (форма `$ref` вместо инлайн-списка — клиентов не ломает: api-client рукописный, не кодогенерится).

### 2.4 Почему это безопасно для БД и сериализации

- Колонки статусов — обычные строки: `backend/src/models/visit.py:25`, `backend/src/models/record.py:23` (`String(20)`); SQL-enum и CHECK-констрейнтов нет, миграции их не создают. Изменений схемы БД нет вообще.
- `str`-enum сравним со строкой по значению (`VisitStatus.MISSED == "missed"` → `True`), а член enum — сам экземпляр `str`: bind в колонку `String(20)` кладёт строковое значение. Подводный камень типизированной колонки `sa.Enum` (по умолчанию хранит имя члена, а не значение) здесь неприменим: колонок `Enum(VisitStatus)` в схеме нет.
- Pydantic/FastAPI сериализуют `str`-enum в строковое значение — ответы API не меняются.

## 3. User Scenarios (регрессионные якоря)

Рефакторинг не меняет видимое поведение. Сценарии фиксируют то, что обязано продолжать работать; каждый маппится на существующий тест (e2e или API):

| # | Сценарий | E2E-якорь |
|---|---|---|
| S1 | Админ меняет статус визита на «Посетил» — бейдж статуса записи пересчитывается | `frontend/admin/e2e/wave6-record-status-derived.spec.ts:18` (Scenario 1) |
| S2 | Админ выставляет статус записи через пикер у записи | `frontend/admin/e2e/admin-changes-status.spec.ts:31` |
| S3 | Фильтр списка записей по статусу — сервер фильтрует строки | `frontend/admin/e2e/records.spec.ts:151` (секция server-side фильтрации) |
| S4 | Статус-пикер консистентен в /records, модалке занятия и /clients | `frontend/admin/e2e/wave6-status-shared.spec.ts:19` |
| S5 | Занятость занятия не считается по отменённым записям | `frontend/admin/e2e/occupied-calc.spec.ts:11` |
| S6 | Изменение статуса визита мимо UI — сервер пере-выводит статус записи | `frontend/admin/e2e/records-view.spec.ts:475` |
| S7 | Счётчик пропущенных записей в списке клиентов считает только `missed` | API-уровень: `backend/tests/test_client_stats.py` (e2e на этот счётчик нет — фильтр `client.py:117` покрыт здесь) |

## 4. Вне скоупа

- Дедупликация/перенос `RecordStatus` (`models/enums.py:11`, легаси-значения pending/confirmed/cancelled/no_show; доменного двойника нет).
- Чистка существующих нарушений «домен не импортирует ORM» (`backend/src/domain/deletion.py:47-70`, `backend/src/domain/record_visits.py:20-22`) — отдельный техдолг; задача не добавляет новых таких импортов.
- Миграции БД, нативные SQL-enum, CHECK-констрейнты.
- Фронтенд и e2e (код, не запуск).
- Тестовые литералы (см. 2.2).
- CI-guard «единственность определения» — после удаления дубля любой забытый импорт падает на импорте; отдельная защита не нужна.
- Два одноимённых класса `VisitItem` (`backend/src/schemas/record.py:12` и `backend/src/domain/visit_status.py:25`) после рефакторинга станут взаимозаменяемыми по типу поля `status` — существующая коллизия имён; в этой задаче не переименовывается (осознанная граница).

## 5. Критерии готовности

1. `backend/src/models/enums.py` не содержит `VisitStatus`; в backend ровно одно определение enum.
2. Оба импортера схем перепривязаны; поиск `from src.models.enums import VisitStatus` пуст.
3. В `backend/src` нет сырых литералов четырёх значений `VisitStatus` вне определений enum, alembic-миграций и тестов (seed конвертирован); проверка механическая — grep по `"waiting"/"visited"/"missed"/"cancelled"` в `backend/src` пуст вне `domain/visit_status.py`, `alembic/` и `tests/`.
4. Юнит-тесты домена (`test_compute_record_status.py`, `test_record_visits.py`) и полный pytest зелёные.
5. E2E-якоря S1–S6 зелёные — поведение не изменилось.
6. Контракт API не изменился (покрывается существующими API-тестами без их правок).
