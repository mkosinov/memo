# План #538: локализация ошибок бронирования в web по кодам (рев.2 — вариант А)

## Goal

Единственная оставшаяся английская утечка в web-флоу брони — 404 `ACTIVITY_NOT_FOUND`
(«Activity not found») — перекрывается словарём код → русский текст на 3 кода в
web-хелпере `structuredServerMessage`. 409 «мест нет» с 21.11.2026 (#551) доезжает
до клиента русским серверным текстом «Недостаточно мест» и этой задачей не меняется
(регрессионная булавка). Чисел в сообщении 409 больше нет — никакого извлечения
N/M в web нет. Поведение меняется ровно в одном месте: текст 404.

## Architecture

- **Словарь — презентационный слой web**: `CODE_MESSAGES` в
  `frontend/web/app/lib/errors.ts` (3 кода: `ACTIVITY_NOT_FOUND`,
  `TARIFF_REQUIRED`, `TARIFF_NOT_FOUND`); записи `ACTIVITY_AT_CAPACITY` нет —
  серверный русский текст проходит существующий pass-through (вариант А, спека
  рев.2 §Решение).
- **Один промежуточный шаг в `structuredServerMessage`** перед текущей логикой:
  код найден в словаре → текст словаря; иначе логика без изменений (код вне
  словаря → серверский `message`; нет кода/структуры → `fallback`).
- Бэкенд и admin не трогаются (спека §Границы; мёртвая ветка N/M в admin —
  принятый побочный эффект #551, не реанимируется).
- Спека: `docs/specs/2026-10-25-web-booking-error-l10n-design.md` (рев.2) —
  поведенческая дельта и решения живут там, не здесь.

## Tech Stack

Next.js web (frontend/web), vitest (юнит + компонентные), Playwright (web-e2e —
собственный конфит, globalSetup с OTP-входом сида, фикстуры `sqlite-exec`).

## Tasks

### Task 1: Компонентная булавка утечки 404 в BookingOverlay (RED на main)

### Classification: trivial

### Required Docs

- docs/specs/2026-10-25-web-booking-error-l10n-design.md (§Тестовая стратегия)

Работа:

1. `frontend/web/app/ui/__tests__/BookingOverlay.test.tsx` — два монтажа с
   реалистичными `ApiError`:
   - `ApiError(404, "Activity not found", "ACTIVITY_NOT_FOUND")` → блок
     `booking-error` содержит «Занятие не найдено» и НЕ содержит
     "Activity not found";
   - `ApiError(409, "Недостаточно мест", "ACTIVITY_AT_CAPACITY")` → блок
     `booking-error` содержит «Недостаточно мест» (пин pass-through, без чисел).
2. Первый прогон — на main, ДО Task 2: ассерт 404-случая падает (в блоке виден
   английский серверный текст) — это RED этапа, фиксирующий настоящую утечку
   (сегодняшние моки тестов подставляют русский текст и её пропускают).

DoD: тест написан, 409-случай зелёный, 404-случай красный на main (RED
RED-GREEN-REFACTOR; GREEN — Task 2).

### Task 2: Словарь `CODE_MESSAGES` + промежуточный шаг в `structuredServerMessage`

### Classification: small

### Required Docs

- docs/specs/2026-10-25-web-booking-error-l10n-design.md (§Решение, §Границы,
  §Достижимые коды вне словаря)

Работа:

1. `frontend/web/app/lib/errors.ts`: словарь
   `CODE_MESSAGES: Record<string, string>` —
   `ACTIVITY_NOT_FOUND: 'Занятие не найдено'`,
   `TARIFF_REQUIRED: 'Выберите тариф для каждого места'`,
   `TARIFF_NOT_FOUND: 'Тариф не найден'`. Записи для `ACTIVITY_AT_CAPACITY` нет.
2. `structuredServerMessage(err, fallback)`: один промежуточный шаг ПЕРЕД
   текущей логикой — есть `err.code` и он найден в `CODE_MESSAGES` → вернуть
   текст словаря. Дальше текущая логика без изменений: код вне словаря →
   серверский `message`; кода/структуры нет → `fallback`. Никаких регулярок и
   извлечения чисел в файле нет.
3. `frontend/web/app/lib/__tests__/errors.test.ts` (расширение):
   - каждый из 3 кодов словаря → соответствующий русский текст;
   - код `ACTIVITY_AT_CAPACITY` с серверским сообщением «Недостаточно мест» →
     сообщение как есть (pass-through, без попыток извлечь числа);
   - код вне словаря (например `SOME_FUTURE_CODE`) → серверский `message`;
   - без кода/структуры → `fallback`;
   - существующий тест с моком capacity (русский message) остаётся зелёным без
     правок ожиданий — он теперь попадает в pass-through-ветку.

DoD: vitest `errors.test.ts` зелёный; RED-булавка Task 1 становится зелёной
(GREEN RED-GREEN-REFACTOR); юнит-уровень US-2/US-3/US-4 покрыт; существующие
компонентные тесты входа (OtpStep.test.tsx, auth-шаги BookingOverlay.test.tsx)
остаются зелёными без правок ожиданий — это компонентный уровень US-5 (E2E для
US-5 по спеке нет).

### Task 3: E2E web — US-1 (пин 409) + US-2 (404 словарь)

### Classification: small

### Required Docs

- docs/specs/2026-10-25-web-booking-error-l10n-design.md (§User Scenarios,
  §Тестовая стратегия)

Работа:

1. Новый web-e2e спек (по образцу существующих спек `frontend/web/e2e/`,
   фикстуры: globalSetup OTP-вход сида-клиента, `sqlite-exec`):
   - US-1: бронь на «Индивидуальный МК» (capacity=1 из сида) занимает
     единственное место, повторная отправка формы → 409, блок `booking-error`
     содержит «Недостаточно мест» и не содержит "seats occupied"/"Activity"
     (регрессионный пин поведения #551 — рождается зелёным);
   - US-2: между открытием формы и отправкой тест удаляет занятие прямой
     записью в тестовую БД (`sqlite-exec`) → блок `booking-error` содержит
     «Занятие не найдено» и не содержит "Activity not found".
2. Прогон целевой: только новый спек + существующие сюиты брони, которые
   могут касаться `booking-error`; полный прогон web-e2e не требуется (сценарии
   изолированы в новом файле, существующие ожидания не меняются).

DoD: E2E-тесты сценариев 1 и 2 проходят (RED-GREEN-REFACTOR; RED-этап US-2
зафиксирован компонентной булавкой Task 1 на main, полный E2E-прогон после
Task 2 зелёный); US-3/US-4 E2E не имеют по спеке (недостижимы через UI),
US-5 закрыт существующими компонентными тестами входа.
