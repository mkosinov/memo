# План #284: Автоподстановка тарифа по возрастной группе

Спека: `docs/specs/2026-09-19-tariff-age-autofill-284-design.md` (Behavioral Delta — там, здесь не дублируется).

## Goal

Админ перестаёт вручную править тариф в строке посетителя: при выборе возраста подставляется
первый тариф услуги с совпавшей возрастной группой («детский» для 3–11, «взрослый» для
остальных), ручной выбор остаётся возможным и переподставляется при смене возраста.

## Architecture

```
БД (tariffs.audience: "kid"/"adult"/"all", NOT NULL, default "all")  ← миграция + бэкфилл по title
        ↓
Backend: enum TariffAudience (models/enums.py) → Tariff-модель → Pydantic-схемы услуги
        ↓                                                            (типизировано, default ALL)
api-client (zod: TariffResponse/TariffCreate)  →  packages/domain (TariffSchema)  →  transformers.ts
        ↓
Единый резолвер resolveDefaultTariff(tariffs, age)  ← общий источник диапазона «Дети» (3–11)
        ↓                                                (константа кормит и AgeSelect)
Потребители: черновик строки · обработчик смены возраста · NewRecordTab ·
             ClientRecordTab (аноним) · AddVisitorForm · useRecordMutations.defaultTariff
        ↓
ServiceModal: выпадающий «возрастная группа» в строке тарифа
```

Сервер тариф не вычисляет — сохраняет присланный `tariff_id` как есть. Валидации формы услуги
и уникальности групп нет (решение владельца). Порядок «первого» — порядок списка тарифов от API.

## Tech Stack

Backend: FastAPI · SQLAlchemy · Alembic · Pydantic · pytest. Контракты: zod (`packages/api-client`,
`packages/domain`). Frontend: Next.js admin · vitest. E2E: Playwright.

---

## Task 1 — БД: колонка audience + миграция с бэкфиллом

**Классификация:** standard
**Сценарии:** 6 (незаполненные услуги без изменений), 7 (данные для настройки)
**Required Docs:** спека §5 Backend; `docs/domain-rules/services.md` (Tariff, Tariff audience)

- `backend/src/models/enums.py`: `class TariffAudience(str, enum.Enum)` — `KID="kid"`,
  `ADULT="adult"`, `ALL="all"` (канон значений строчными).
- `backend/src/models/tariff.py`: колонка `audience: Mapped[str] = mapped_column(String(10),
  nullable=False, server_default="all")`.
- Миграция alembic (одна ревизия, от текущего head): add column NOT NULL server_default "all";
  бэкфилл `UPDATE tariffs SET audience = ...` по `lower(trim(title))` — точное совпадение
  «детский» → kid, «взрослый» → adult, всё остальное (вкл. «единый») → all; бэкфилл накрывает
  мягко удалённые строки. Downgrade: drop колонки (бэкфилл необратим — принято).
- Тест миграции: каноничные названия, название с префиксом («Детский билет» → all),
  мягко удалённая строка.

## Task 2 — Backend-схемы: типизированное поле + тесты

**Классификация:** small
**Сценарии:** 7 (payload round-trip create/PUT/PATCH)
**Required Docs:** спека §5 Backend; parity-таблица services.md

- `backend/src/schemas/service.py`: `audience: TariffAudience = TariffAudience.ALL` в
  `TariffBase` (наследуют Create/Update/Response) — отсутствует → all, неизвестная строка → 422.
- Обновить `backend/tests/test_api_services.py` (вложенные тарифы: audience в payload'ах,
  проверки ответа; кейс 422 на мусорном значении).

## Task 3 — Контракты фронта: api-client + packages/domain

**Классификация:** small
**Сценарии:** 7 (пометка переживает сохранение услуги — BLOCKER спеки)
**Required Docs:** спека §5 api-client и «Доменная схема фронта»

- `packages/api-client/src/schemas.ts`: `TariffResponseSchema.audience` (обязательный enum),
  `TariffCreateSchema.audience` (optional, default `"all"`); типы.
- `packages/domain/src/index.ts`: `TariffSchema` + поле `audience`; `frontend/admin/lib/transformers.ts`
  (`transformService`) — прокинуть. Без этого PUT стирает пометки (панель: BLOCKER).
- Обновить `packages/api-client/src/schemas.test.ts` и тесты, где тарифы сравниваются поэлементно.

## Task 4 — Единый источник диапазона + резолвер

**Классификация:** standard
**Сценарии:** 1, 2, 3 (логика подстановки)
**Required Docs:** спека §2.3–2.4, §5 Frontend; services.md (autofill rule)

- Константа диапазона «Дети» (3–11) в одном месте; опции AgeSelect («Дети»/«Подростки»)
  собираются из неё; сентинел `'adult'` остаётся строковым и не смешивается с возрастами.
- `resolveDefaultTariff(tariffs, age)`: первый `kid` при age ∈ 3–11, иначе первый `adult`;
  нет совпадения → первый в списке; пустой список → тарифа нет; `all` не участвует;
  порядок — как отдаёт API.
- Unit-тесты vitest: все ветки (kid/adult/fallback в т.ч. пересекающий группы, несколько
  совпадений, пустой список, повторный вызов с тем же возрастом — no-op).

## Task 5 — Перевод потребителей на резолвер

**Классификация:** standard
**Сценарии:** 1, 2, 3, 4, 5, 6, 8
**Required Docs:** спека §2.5, §5 Frontend; services.md (consumers)

- `RecordVisitsTable.tsx`: `makeEmptyVisitRow` через резолвер; обработчик смены возраста —
  ВСЕГДА повторный резолв (п.2.5 спеки, затирает ручной выбор — норма).
- `NewRecordTab.tsx`, `ClientRecordTab.tsx` (`addAnonymousVisit`), `AddVisitorForm.tsx` —
  дефолт через резолвер.
- Аудит вызывающих параметра `defaultTariff` в `frontend/admin/hooks/useRecordMutations.ts` —
  передаётся результат резолвера.
- Обновить существующие vitest-тесты хуков/форм.

## Task 6 — Редактор услуги: селект «возрастная группа»

**Классификация:** small
**Сценарии:** 7 (настройка групп в редакторе), 8 (легальность нескольких групп)
**Required Docs:** спека §5 Frontend (ServiceModal, a11y); координация #203

- `ServiceModal.tsx` (NestedList): в строке тарифа выпадающий «возрастная группа» — опции
  «детский / взрослый / единый» (строчными), без валидации дубликатов; программная a11y-метка
  «Возрастная группа: {название тарифа}».
- **Гейт:** файл общий с припаркованным #203 (NULL max_age) — задача выполняется после
  финализации/мержа #203.
- Обновить существующие тесты редактора услуги.

## Task 7 — E2E, сиды, финальная зачистка тестов

**Классификация:** large
**Сценарии:** 1–8 (все)
**Required Docs:** спека §4 (сценарии), §5 Тесты

- E2E по восьми сценариям спеки §4 (включая затирание ручного выбора, «единый», холсты,
  возврат на «Взрослый»).
- Сид-данные: тарифы получают audience в согласии с их названиями.
- Прогон существующего набора: обновить все зацепившиеся тесты (требование владельца —
  ничего не должно покраснеть).

## DoD

- Все задачи выполнены; pytest / vitest / lint / typecheck зелёные; E2E сценарии 1–8 зелёные.
- Существующие тесты обновлены, ни один не удалён «для зелени».
- `services.md` уже дополнен (spec-коммит `93edacf`) — правок канона больше не требуется.
