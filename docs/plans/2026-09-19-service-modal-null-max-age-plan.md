# План: ServiceModal — NULL max_age, пустое поле вместо нуля (#203)

## Goal

Услуга без верхней возрастной границы (`max_age = null`) должна
редактироваться и сохраняться: пустое поле отображается пустым (placeholder
«без ограничения»), перекрёстное правило «Возраст от ≤ Возраст до» действует
только на заполненные значения, при сабмите пустота доезжает до сервера как
`null` (а не 0/18). Плюс (решение пользователя «вариант B», гейт C
2026-09-19): required-поля тарифов получают клиентскую валидацию (сегодня
required рисует только звёздочку, пустую цену ловит лишь сервер). Сервер не
трогаем — правки в трёх клиентских файлах.

Спека: `docs/specs/2026-09-18-service-modal-null-max-age-design.md` (rev4;
раскладка тестов по уровням — решение пользователя 2026-09-19 «вариант A»:
e2e только дымовая пара, остальное — компонентные тесты; клиентская
валидация полей тарифов — «вариант B» того же решения).

## Architecture

- Прод-код (3 файла): `frontend/admin/app/(main)/services/components/ServiceModal.tsx`
  — инициализация формы, валидация (включая элементы тарифов и вывод
  ошибок у их полей), нормализация сабмита;
  `frontend/admin/app/(main)/services/components/ServicesTable.tsx` —
  убрать `?? 18` в edit-маппере (PUT-ветка, `handleEditSubmit`; create-ветку
  не трогаем — она уже передаёт payload как есть);
  `frontend/admin/app/(main)/services/components/serviceFields.tsx` —
  placeholder в конфиге `max_age`.
- Placeholder: у числовой ветки `FieldRenderer` сейчас проброса `placeholder`
  нет вовсе — добавить прокидывание в инпут (обязательная правка, не
  условная; замечание план-ревьюера MINOR 1).
- Тесты: компонентные — `frontend/admin/__tests__/ServiceModal.test.tsx`
  (vitest + testing-library, монтируем модалку с фикстурой услуги; при
  необходимости мокаем мутации по образцу соседних тестов); юнит
  edit-маппера — в существующий `frontend/admin/__tests__/ServicesTable.test.tsx`
  (там уже есть паттерн мока мутаций); e2e —
  `frontend/admin/e2e/services-null-max-age.spec.ts` (новый файл, два
  теста).
- Сервер, миграции, API-клиент — без изменений (схемы уже `int | None`).

## Tech Stack

React (plain useState-форма), vitest + testing-library, Playwright;
FastAPI/SQLAlchemy — только чтение контракта, без правок.

---

## Task 1: Компонентные тесты логики (RED) + три клиентские правки (GREEN)

### Classification: standard

### Required Docs

- `docs/domain-rules/services.md` — семантика возрастных границ услуги
- `docs/design-system.md` — паттерны форм/инпутов (placeholder, состояния ошибок)

### Work

1. Создать `frontend/admin/__tests__/ServiceModal.test.tsx`; фикстура услуги
   без границы (`max_age: null`, `min_age: 5`). Сценарии спеки §4.3–4.5 и
   юниты (сейчас — RED):
   - перекрёстное правило: «от = 10, до = 5» → обе ошибки, мутация не
     зовётся; «до = 14» → сохранение; очистка «до» → сохранение без ошибки;
     «до = 0» при «от = 0» → сохраняется (range 0–18 пропускает, без
     ложной ошибки);
   - create-null-max-age: create с тарифом, «до» пусто → payload мутации
     содержит `max_age: null`;
   - required-numbers-regression (по спеке rev4 §4.5): пустая цена тарифа →
     клиентская ошибка обязательного поля у цены (RED: сегодня ошибки нет,
     запрос уезжает); цена 0 принимается; `min_age` пустое → 0; длительность
     0 → «Минимум: 15» (диапазон жив);
   - юнит нормализации: `'' → null` только для `max_age`;
   - юнит edit-маппера `ServicesTable`: `max_age: null` в edit-payload не
     превращается в 18 — положить в существующий
     `__tests__/ServicesTable.test.tsx` (готовый паттерн мока мутаций).
2. Правки (GREEN):
   - `ServiceModal.tsx`, инициализация: `max_age: null` → `''` — список
     полей с пустой инициализацией фиксирован явно (`max_age`), НЕ по флагу
     `required` (у `min_age` флага нет, его 0-инициализация сохраняется);
   - `ServiceModal.tsx`, `validate`: перекрёстное правило «от ≤ до» —
     условие «оба значения заполнены» (`value !== '' && value != null`),
     без truthy-проверок (0 — валидное значение); range-проверка уже
     пропускает пустые — не трогать;
   - `ServiceModal.tsx`, `validate` + рендер: обход элементов тарифа с
     проверками по их конфигам (`itemFields`: required, min/max — те же
     механизмы, что у полей верхнего уровня); текст ошибки выводится под
     соответствующим полем элемента;
   - `ServiceModal.tsx`, сабмит: `'' → null` только для `max_age` (по
     образцу `MyDataModal`, НЕ генерически на все поля);
   - `ServicesTable.tsx`, `handleEditSubmit`: убрать `?? 18`;
   - `serviceFields.tsx`: placeholder «без ограничения» в конфиге
     `max_age`;
   - `ServiceModal.tsx`, `FieldRenderer`: проброс `placeholder` в числовой
     инпут (замечание ревьюера: составные ключи ошибок элементов тарифов,
     например `tariffs.0.price`, не чистятся `handleChange`-ом
     верхнеуровневого ключа — очистка ошибки элемента допустима только при
     следующем сабмите; DoD-тесты этого не проверяют).
3. Пустой инпут при открытии: assert на значение поля `''` и на placeholder
   (входит в первый тест сценария 3-блока как pre-check фикстуры).

### DoD

- Component: `npx vitest run ServiceModal ServicesTable` — зелёный;
  сценарии §4.3–4.5 проходят (component-уровень, RED-GREEN-REFACTOR).

## Task 2: E2E дымовая пара (сценарии §4.1–4.2)

### Classification: small

### Required Docs

- `docs/domain-rules/services.md`
- `docs/design-system.md`

### Work

1. Создать `frontend/admin/e2e/services-null-max-age.spec.ts` по образцу
   соседних spec-файлов (авторизация, навигация к справочнику услуг):
   - `edit-save-null-max-age`: открыть seed-услугу с пустым «возраст до» →
     именованный assert: значение инпута `''`; именованный assert:
     placeholder «без ограничения»; поменять название → «Сохранить» →
     успех; GET-ответ содержит `max_age: null`;
   - `clear-max-age-saves-null`: услуга с `max_age = 12` → очистить «до» →
     сохранить → GET-ответ `null`; в расписании у карточки услуги нет
     плашки возраста (assert по расписанию — подтверждённая поверхность
     `buildSchedule`; список услуг для плашки не использовать).
2. Seed-данные не менять: 6 из 7 услуг уже с `max_age: null`, одна с
   `max_age: 12` — ровно то, что нужно тестам.

### DoD

- Scenario 1–2: `npx playwright test services-null-max-age` — оба теста
  зелёные (E2E test for scenarios 1–2 passes).

## Task 3: Правка устаревшего доменного правила services.md

### Classification: trivial

### Required Docs

- `docs/domain-rules/services.md`

### Work

1. `docs/domain-rules/services.md`: строку поля `max_age` в таблице —
   «опционально, `null` = без верхней границы» (сейчас помечен ✅ Required
   с диапазоном 0–18); удалить ссылку на несуществующее zod-правило
   `max_age: min(0).max(18)` (живой zod: `maxAge: z.string().optional()`,
   `packages/domain/src/index.ts:47`); диапазон 0–18 оставить описанным как
   клиентскую валидацию формы. Больше ничего в таблице паритета не трогать
   (замечание план-ревьюера MINOR 3 — узкий DoD).
2. Документ приводится в соответствие с живой схемой БД
   (`max_age` nullable, миграция `275ba490cab8`) — поведение не меняется,
   правка только документационная.

### DoD

- Строка `max_age` и её zod-упоминание в `services.md` согласованы с живым
  деревом (nullable-колонка, опциональный zod); прочие строки таблицы не
  менялись.
