# План #414: поле телефона — селектор кода страны + ввод остатка номера

**Goal:** пересобрать ввод телефона в админке на виджет «селектор кода страны + остаток номера» (`PhoneField`) во всех точках ввода (форма записи с типахедом, карточка клиента, оба поля сотрудника, вход), с компакт-хранением при изменении, единым форматтером показа и сохранением инварианта сверки клиента. Полная механика — в спеке `docs/specs/2026-10-07-phone-field-country-selector-414-design.md` (rev3); план не повторяет поведение, задачи реализуют её сценарии.

**Architecture:** новый изолированный модуль `frontend/admin/app/components/shared/phone/` (`PhoneField.tsx`, `countries.ts`, `format.ts` — единый дом TS-редукции после переезда из `useRecordMutations.ts`). Форма записи: `RemoteSearchSelect` получает опциональный `prefix`-слот, `PhoneInput` собирается из PhoneField-логики + типахеда. Бэкенд: единственная правка — поиск аккаунта при входе (точная строка → уникальная редукция `to_national_digits` → отказ). Без миграций; `clients.phone`/`User.phone` остаются `String(20)`. Правка канона `docs/domain-rules/clients.md` уже выполнена и лежит на main вместе со спекой (Gate B, коммит `07708257`) — задачи план только читает.

**Tech Stack:** Next.js 14 admin (React 18, TanStack Query, Tailwind, без UI-кита), `libphonenumber-js/min` (`AsYouType`, `parsePhoneNumber`, `isPossiblePhoneNumber`), FastAPI/SQLAlchemy (вход), Vitest + Playwright.

---

## Task 1: phone-модуль — словарь стран и формат-хелперы

### Classification: standard

Создать `frontend/admin/app/components/shared/phone/countries.ts` (кураторский массив 9 стран: код, код вызова, русское название, шаблон плейсхолдера; RU первым) и `frontend/admin/app/components/shared/phone/format.ts`: `toNationalDigits` (переезд из `frontend/admin/hooks/useRecordMutations.ts` с обновлением импортов — единственный TS-дом правила), `compact(country, national)`, `parseStoredPhone(s)` (страна списка / «без страны» / мусор), `formatPhoneDisplay(s)` (парс → международная группировка; мусор → как есть; пустое → пусто). Тесты: `phone/__tests__/format.test.ts` + перенос редукционных кейсов из `__tests__/useRecordMutations.test.ts` (кейсы «+7…», «8…», «999…», «+375…», «+1…», 11-значные с 7/8 и без, RU/KZ общий +7 — один ключ).

### Required Docs

- `docs/domain-rules/clients.md` — «Phone field (GH #414…)»
- `docs/specs/2026-10-07-phone-field-country-selector-414-design.md` — §Единая редукция цифр, §Список стран

### DoD

- Юнит-тесты `format.ts`/`countries.ts` зелёные (редукция, компакт, `parseStoredPhone`, `formatPhoneDisplay`, уникальность кодов словаря).
- Существующие тесты `useRecordMutations` зелёные после переезда импорта.

## Task 2: виджет PhoneField

### Classification: large

`frontend/admin/app/components/shared/phone/PhoneField.tsx`: составное поле — селектор кода страны (кнопка «+7 Россия ⌄», listbox на `--z-popover`, отметка выбранной, клик-вне/ESC, мышь) + инпут остатка (`AsYouType(страна)`, не-цифры игнорируются, набор «+» не вводится, вставка «+…» парсится: страна списка выбирается / вне списка → состояние «без страны», `type="tel"`, `dir="ltr"`, placeholder из словаря) + × (очистка, сброс к RU). Controlled-значение `{ country, national, pristine }` + производные `visible`/`compact`/`isComplete`. Атрибуты автозаполнения пробрасываются потребителями по сегодняшней семантике каждого экрана. `data-testid` селектора — `phone-country-select`.

### Required Docs

- `docs/design-system.md` (listbox-паттерн, переменные)
- спека §Виджет PhoneField, §Инициализация существующих значений

### DoD

- Юнит-тесты PhoneField: выбор страны, формат RU/BY/LV, плейсхолдеры, × и сброс, «без страны» (вставка вне списка), pristine, вставка «+» в списке, вставка «8…» (ровно 11 цифр) → селектор RU и остаток без ведущей 8, смена страны с сохранением цифр, валидатор полноты (`isComplete` = `isPossiblePhoneNumber`), `compact` (в т.ч. «без страны» → не определён).

## Task 3: RemoteSearchSelect — опциональный prefix-слот

### Classification: small

`frontend/admin/app/components/shared/RemoteSearchSelect.tsx`: проп `prefix?: ReactNode`, рендер внутри рамки перед инпутом; клик по префиксу не открывает подсказки (стоп клика); без пропа — вёрстка и поведение идентичны сегодняшним.

### Required Docs

- спека §Интеграция в кодовую базу

### DoD

- Регрессионный юнит-тест «без prefix — прежнее поведение» + тест «клик по prefix не открывает дропдаун»; существующие тесты RemoteSearchSelect зелёные.

## Task 4: PhoneInput формы записи на новом движке

### Classification: standard

Пересобрать `frontend/admin/app/components/shared/PhoneInput.tsx`: типахед `RemoteSearchSelect` с `prefix` = селектор страны; форматирование/`canSearch` (порог 4 нац. цифры)/`buildParams` (`?phone=` нац. цифры) — от выбранной страны; `onInputValueChange` поднимает `compact`; read-only «Имя · телефон» (телефон через `formatPhoneDisplay`) + ×, в read-only селектор страны неактивен; якорь `input-phone` остаётся на инпуте остатка. Переработать `__tests__/PhoneInput.test.tsx`.

### Required Docs

- `docs/domain-rules/clients.md` — «Phone field (GH #414…)»
- спека §Поиск и привязка клиента

### DoD

- Юнит-тесты PhoneInput зелёные (порог от выбранной страны, источник цифр `getNationalNumber`, read-only, подъём компакта).
- E2E-тест для сценария 4 спеки проходит (смена страны посреди ввода; вставка «+375 …» выбирает страну) — RED-GREEN-REFACTOR.

## Task 5: useRecordMutations — компакт и сверка-инвариант

### Classification: small

`frontend/admin/hooks/useRecordMutations.ts`: непикнутый путь — введённая сторона сверки = компакт (`toNationalDigits(compact) === toNationalDigits(c.phone)`), создание клиента с `compact`; импорт редукции из `phone/format`.

### Required Docs

- спека §Поиск и привязка клиента, §Единая редукция цифр

### DoD

- Юнит-тесты: RU/BY совпадение с сохранёнными написаниями («+7…», «8…», компакт), мусор → создание; защитная проверка длины компакта (≤20) блокирует сохранение с понятным сообщением.

## Task 6: карточка клиента

### Classification: standard

`frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx`: телефон — PhoneField; валидация изменённого номера (без страны → «Выберите страну из списка»; неполный → текст #221); pristine-значение уходит в базу как лежало; пустое допустимо (nullable).

### Required Docs

- `docs/domain-rules/clients.md`; спека §Инициализация, §Форматирование

### DoD

- E2E-тест для сценария 5 спеки проходит (нетронутое legacy сохраняется как есть; неполный изменённый блокирует) — RED-GREEN-REFACTOR.

## Task 7: сотрудник — StaffModal

### Classification: standard

`frontend/admin/app/(main)/staff/components/StaffModal.tsx`: оба телефонных поля — PhoneField; валидатор полноты входит в общий `validate()` и тем самым гейтит PATCH аккаунтного телефона (#348, уходит до PUT карточки) и создание аккаунта; в базу — компакт.

### Required Docs

- спека §Форматирование (пункт о #348)

### DoD

- Юнит: неполный аккаунтный телефон блокирует PATCH до отправки.
- E2E-тест для сценария 6 спеки проходит — RED-GREEN-REFACTOR.

## Task 8: вход + правка бэкенда

### Classification: large

Фронт: `frontend/admin/app/login/page.tsx` — PhoneField без валидатора полноты (только required-пустота); отправка `compact` при привязанной стране, иначе только цифры. Бэкенд: `backend/src/auth/` — поиск аккаунта: точная строка (существующий индексный путь) → при нуле линейный поиск по активным пользователям с редукцией `to_national_digits` обеих сторон → ровно одно совпадение = вход, ноль/несколько = отказ с единым сообщением «Неверный телефон или пароль»; лестница защиты (блокировка, пер-IP счётчик, тайминг-паритет) и ключевание счётчиков по набранной строке не меняются.

### Required Docs

- спека §Экран входа; `backend/src/domain/phone_digits.py`

### DoD

- Юнит бэкенда: точная строка → уникальная редукция → отказ; коллизия (включая RU/KZ +7) → отказ.
- E2E-тест для сценария 7 спеки проходит (старое написание «+7 999 …», вне списка «+1 …», отказ) — RED-GREEN-REFACTOR.

## Task 9: показ — форматтер в пяти точках

### Classification: standard

`formatPhoneDisplay` в: `clientColumns.tsx` (колонка «Телефон»), `RecordHeader.tsx`, `ClientLabelById.tsx`, `ClientCardModal.tsx` (оба места), `ClientQuickCard.tsx`. Аудит не трогать. Перегнать визуальные базлайны таблицы клиентов (снапшеты) под группированный показ.

### Required Docs

- спека §Форматирование (показ)

### DoD

- Юнит `formatPhoneDisplay` (Task 1) + обновлённые снапшеты зелёные; ручная сверка показа старых сид-записей.

## Task 10: разовый аудит сохранённых логинов

### Classification: trivial

Скрипт/запрос к базе: `User.phone`, не сводимые к цифрам или с кодами вне списка 9 стран; отчёт; нецифровые (если найдутся) — правка вручную с пользователем до приёмки.

### Required Docs

- спека §Граничные случаи (нецифровые логины)

### DoD

- Отчёт аудита приложен к PR; нецифровых логинов нет (или исправлены).

## Task 11: E2E-волна формы записи и обновление якорей

### Classification: standard

Новые E2E сценариев 1–3 спеки (запись с новым номером RU: компакт в базе + группированный показ; выбор из подсказок и ×; BY без дубля); обновление существующих спек под составное поле (`client-phone-typeahead.spec.ts`, `activity-details-modal.spec.ts`, `clients.spec.ts`, `master-role-record-create.spec.ts`, `server-push-offline.spec.ts`, `anonymous-visits.spec.ts` — якорь `input-phone` на инпуте остатка).

### Required Docs

- спека §User Scenarios, §Тесты

### DoD

- E2E-тесты для сценариев 1, 2, 3 спеки проходят — RED-GREEN-REFACTOR.
- Вся существующая E2E-волна зелёная на обновлённых якорях.
