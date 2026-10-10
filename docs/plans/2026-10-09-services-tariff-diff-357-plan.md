# План: тарифы услуги — обновление на месте + мягкая ссылка посещения (#357)

- **Дата:** 2026-10-09
- **Спека:** `docs/specs/2026-10-09-services-tariff-diff-357-design.md` (rev3, Gate B OK)
- **Issue:** #357

## Goal

Реализовать согласованную спеку: тарифы услуги обновляются на месте (diff по `id`), удаление тарифа отвязывает посещения (FK `ondelete=SET NULL`), цена-снимок посещения не меняется ни в каком сценарии. Поведенческая дельта живёт в спеке (Behavioral Delta, US-1..US-5) и здесь не повторяется.

## Architecture

Три слоя, без новых компонентов:

- **Backend** (`backend/src`): схема записи тарифа получает необязательный `id`; общий helper тарифного diff в `ServiceService` применяется маршрутом PUT (полная замена: отсутствие поля = удалить все) и PATCH (отсутствие/`null` = не трогать); миграция Alembic пересоздаёт FK `visits.tariff_id` с `ondelete=SET NULL`. Семейный сценарий удаления услуги не меняется — отвязка происходит на уровне базы.
- **api-client** (`packages/api-client`): тарифная zod-схема пропускает необязательный `id` (сегодня молча отбрасывает — идентификатор не доходит до запроса).
- **Frontend** (`frontend/admin`): без функциональных правок; пин-тест фиксирует, что форма не вырезает `id` тарифов при сохранении.

## Tech Stack

FastAPI + SQLAlchemy + Alembic (backend), Pydantic-схемы `backend/src/schemas/service.py`; zod (`packages/api-client/src/schemas.ts`); vitest (unit/компонентные), Playwright e2e (`frontend/admin/e2e`); pytest с SQLite (pragma `foreign_keys=ON` обязательна — иначе `ondelete` в тестах молча не работает).

## Task 1 — Backend: `TariffUpdate.id` + валидация

**Классификация:** small. **Покрывает:** механизм US-1..US-4.
Списки тарифов в `ServiceUpdate` и `ServicePatch` переключаются на `TariffUpdate` (класс существует, но сейчас не подключён) с `id: str | None = None`; `ServiceCreate` остаётся на `TariffCreate` без `id` — идентификатор при создании не принимается. Валидация на уровне обеих схем запроса: повтор одного `id` в списке → 422 VALIDATION_ERROR с указанием индекса строки. Схемные юнит-тесты: id принимается, дубликат отвергается, создание идентификатор не принимает.
**Required docs:** `docs/domain-rules/services.md` § Tariff (nested), спека § Технические изменения п.1.

## Task 2 — Backend: тарифный diff в `ServiceService`

**Классификация:** standard. **Покрывает:** US-1 (правка на месте), US-2 (удаление занятого), US-3 (добавление), US-4 (правка услуги без изменения тарифов).
Общий helper: по `id` — найденный у этой услуги → `UPDATE` строки; без `id` → `INSERT`; не найденный/чужой → 422 с указанием строки; отсутствующий в присланном списке → `DELETE`. Весь diff — одна транзакция (действующий декоратор). `update` (PUT): отсутствие поля `tariffs` = удалить все (как сегодня); `patch` (PATCH): отсутствие/`null` = не трогать. Юнит-тесты на каждую ветку diff + PUT-очистка + PATCH-сохранение + чужой id + пустой список `[]` легален.
**Required docs:** `docs/domain-rules/services.md` § Business Logic/Backend, § API Endpoints; спека § Технические изменения п.2.

## Task 3 — Backend: миграция FK `ondelete=SET NULL` + тестовая прага

**Классификация:** small. **Покрывает:** US-2, US-5 (отвязка посещений при удалении тарифа/услуги).
Миграция Alembic: drop + create FK `visits.tariff_id → tariffs.id` с `ondelete=SET NULL` (данные не трогаются; downgrade — строгий FK, обнулённые ссылки остаются). Тестовая конфигурация SQLite: убедиться, что включена `PRAGMA foreign_keys=ON` (и включить, если нет) — иначе `ondelete` в тестах не работает. Юнит-тест: удаление тарифа с посещениями обнуляет `visits.tariff_id`, `price` не меняется; удаление услуги с посещениями на её тарифах проходит (семейный сценарий).
**Required docs:** `docs/domain-rules/visits.md` § Invariants, § Relationships; спека § Технические изменения п.3–4.

## Task 4 — api-client: необязательный `id` в тарифной схеме

**Классификация:** trivial. **Покрывает:** enables US-1..US-4 (форма уже переносит `id`, но клиентская схема его отбрасывает).
`TariffCreateSchema` (`packages/api-client/src/schemas.ts`) получает `id: z.string().optional()` — идентификатор доходит до запроса. Тест схемы: `id` переживает `parse`.
**Required docs:** спека § Технические изменения → api-client; `docs/domain-rules/services.md` § Tariff (nested).

## Task 5 — Frontend: пин-тест сохранения `id` тарифов формой

**Классификация:** small. **Покрывает:** регресс-страховка US-1..US-4.
Компонентный тест `ServiceModal`: сабмит формы с предзаполненными тарифами отправляет тарифы с исходными `id` (пересборка вложенного списка их не вырезает). Функциональных правок формы нет.
**Required docs:** спека § Технические изменения → Фронтенд.

## Task 6 — E2E: пять сценариев спеки

**Классификация:** standard. **Покрывает:** US-1..US-5 напрямую.
US-1..US-4 — в действующую `frontend/admin/e2e/services-crud.spec.ts` (сид: s5 «Ручная лепка» тарифы t5a/t5c, s7 «Морской пейзаж» t7a/t7c): правка цены и названия t5a → `id` стабилен, посещения не тронуты; удаление t5c → у посещений `tariff_id = null`, `price` прежний; добавление тарифа к s7 → существующие `id` стабильны; правка названия s5 без изменения тарифов → все `id` совпали. US-5 — там же, в `services-crud.spec.ts` (семейное удаление услуги сегодня e2e-покрытием не пользуется — сценарий новый, отдельный файл не заводим): удаление s7 → посещения остались с ценой, `tariff_id = null`.
**Required docs:** спека § User Scenarios; `docs/domain-rules/services.md` § Archive & delete semantics.
