# GH #414 — Поле телефона: селектор кода страны + ввод остатка номера (IMPL)

- **Date**: 2026-10-08
- **Branch**: `414-phone-field-country-selector`
- **Status**: Completed (PR pending — finishing handles push/PR/CI; issue closure via the IMPL PR description)
- **Range**: base `5d90a560` — 14 commits (`cb65e310..48295aba`), 61 files, +4373/−442
- **Issue**: #414 — поле телефона: селектор кода страны + ввод остатка номера
- **Spec**: `docs/specs/2026-10-07-phone-field-country-selector-414-design.md` (rev3, на main — IMPL не менял)
- **Plan**: `docs/plans/2026-10-07-phone-field-country-selector-414-plan.md` (11 задач T1–T11, на main — IMPL не менял)

## Goal

Ввод телефона во всех точках админки пересобран на составной виджет «селектор кода страны +
остаток номера» (`PhoneField`): форма записи с типахедом, карточка клиента, оба поля сотрудника,
экран входа. При вводе наружу поднимается компакт (`+<код><нац.цифры>`) — то, что уходит в базу;
хранение не менялось (`clients.phone`/`User.phone` остаются `String(20)`, без миграций). Показ
телефонов везде — единый форматтер `formatPhoneDisplay` (международная группировка); поиск аккаунта
при входе понимает старые написания через уникальную редукцию `to_national_digits`.

## Summary of Changes (per task)

- **T1 — phone-модуль (standard, `cb65e310`):** новый изолированный модуль
  `frontend/admin/app/components/shared/phone/` — `countries.ts` (кураторский словарь 9 стран:
  код, код вызова, русское название, шаблон плейсхолдера; RU первым) и `format.ts` —
  `toNationalDigits` (переезд из `useRecordMutations.ts`, единый TS-дом правила), `compact`,
  `parseStoredPhone` (страна списка / «без страны» / мусор), `formatPhoneDisplay` (мусор → как
  есть; пустое → пусто). Юнит-тесты `format`/`countries` + перенос редукционных кейсов из
  `useRecordMutations.test.ts` (RU/KZ общий +7 — один ключ, «8…», «999…», «+375…», «+1…»).
- **T2 — виджет PhoneField (large, `fa41ba1f`):** составное контролируемое поле — селектор кода
  страны (кнопка «+7 Россия ⌄», listbox на `--z-popover`, отметка выбранной, клик-вне/ESC,
  `data-testid="phone-country-select"`) + инпут остатка (`AsYouType(страна)`, не-цифры
  игнорируются, вставка «+…» парсится: страна списка выбирается / вне списка → состояние «без
  страны») + × (очистка со сбросом к RU). Controlled-значение `{country, national, pristine}` +
  производные `visible`/`compact`/`isComplete` (`isPossiblePhoneNumber`), `type="tel"`,
  `dir="ltr"`, placeholder из словаря.
- **T3 — RemoteSearchSelect prefix-слот (small, `39fb527f`):** опциональный `prefix?: ReactNode`
  внутри рамки перед инпутом; клик по префиксу не открывает подсказки (стоп клика); без пропа —
  поведение и вёрстка прежние (регрессионный юнит-тест).
- **T4 — PhoneInput записи на новом движке (standard, `afe2466c`):** типахед
  `RemoteSearchSelect` с селектором страны в prefix-слоте; порог поиска (4 нац. цифры) и
  `buildParams` (`?phone=` нац. цифры) — от выбранной страны; `onInputValueChange` поднимает
  компакт; read-only «Имя · телефон» (через `formatPhoneDisplay`) с неактивным селектором + ×;
  якорь `input-phone` остался на инпуте остатка.
- **T5 — useRecordMutations: компакт и сверка-инвариант (small, `81a19429`):** непикнутый путь —
  введённая сторона сверки = компакт (`toNationalDigits(compact) === toNationalDigits(c.phone)`),
  создание клиента с компактом; защитная проверка длины (≤ `String(20)`) блокирует сохранение с
  понятным сообщением.
- **T6 — карточка клиента (standard, `8bd890dd`):** телефон `ClientInfoTab` — PhoneField;
  изменённый номер валидируется (без страны → «Выберите страну из списка», неполный → текст
  #221); pristine-значение уходит в базу как лежало; пустое допустимо (nullable).
- **T7 — сотрудник, StaffModal (standard, `935f443d`):** оба телефонных поля — PhoneField;
  валидатор полноты входит в общий `validate()` и тем самым гейтит PATCH аккаунтного телефона
  (#348, уходит до PUT карточки) и создание аккаунта; в базу — компакт.
- **T8 — вход + бэкенд (large; 8a backend `358c3c1c` / 8b frontend `e3200e7d`):** поиск аккаунта
  при входе — точная строка (существующий индексный путь) → при нуле линейный поиск по активным
  пользователям с редукцией `to_national_digits` обеих сторон: ровно одно совпадение = вход,
  ноль/несколько (включая коллизию RU/KZ +7) = единый отказ «Неверный телефон или пароль»;
  лестница защиты (блокировка, пер-IP счётчик, тайминг-паритет) и ключевание счётчиков по
  набранной строке не менялись. Экран входа — PhoneField без валидатора полноты (только
  required-пустота); отправка компакта при привязанной стране, иначе только цифры.
- **T9 — показ: форматтер в пяти точках (standard, `ede5b658`):** `formatPhoneDisplay` в
  `clientColumns.tsx` (колонка «Телефон»), `RecordHeader.tsx`, `ClientLabelById.tsx`,
  `ClientCardModal.tsx` (оба места), `ClientQuickCard.tsx`; аудит не тронут.
- **T10 — разовый аудит сохранённых логинов (план: trivial → фактически small, `e95a1bc6`):**
  `backend/scripts/audit_user_phones.py` — классификация `users.phone` по четырём корзинам
  (OK / OUT_OF_LIST / NOT_DIGITS / EMPTY), read-only подключение; результаты dev-БД и
  прод-команда — `docs/status/2026-10-08-user-phones-audit-414.md`.
- **T11 — E2E-волна и якоря (standard, `a4595b70`):** новые спеки сценариев 1–3 (`record-phone-field.spec.ts`) + якоря составного поля в существующих спеках (`client-phone-typeahead`,
  `activity-details-modal`, `clients`, `master-role-record-create`, `server-push-offline`,
  `anonymous-visits`); далее в фиксе — спеки сценариев 4–7: `phone-country-switch.spec.ts`,
  `client-card-phone-field.spec.ts`, `staff-phone-field.spec.ts`, `login-phone-field.spec.ts`.
- **Фикс-раунд:** блокер — форма записи блокирует сохранение вставки «+…» вне списка с видимыми
  цифрами («Выберите страну из списка», `94787778`); визуал — телефонное поле карточки клиента
  занимает полную строку (16px → 324px, `48295aba`).

## Отклонения и решения (для протокола)

1. **`displayQuery` в RemoteSearchSelect** — дополнительный к `prefix` опциональный проп
   (generic, по умолчанию identity): сценарий 4 (мгновенная перегруппировка подсказок при смене
   страны) потребовал другой ключ типахеда; спека §Интеграция называла только `prefix`.
   Санкционировано архитектором.
2. **`CountrySelect` вынесен из PhoneField** в `phone/CountrySelect.tsx` (переиспользуется
   PhoneField + PhoneInput). Санкционировано архитектором.
3. **Форма записи: вставка «+…» вне списка с видимыми цифрами блокирует сохранение**
   («Выберите страну из списка») — решение архитектора, закрывающее пробел спеки (§Граничные
   случаи перечислял только карточку/сотрудника/вход); консистентно с правилом карточки и
   сотрудника.
4. **PNG-базлайны таблицы клиентов (группированный показ) не в ветке** — регенерация только
   через `update-snapshots.yml` в CI на finishing (канон `docs/tests_workflow.md`).
5. **Аудит логинов** — dev-БД 2/2 OK (0 нецифровых, правка данных не требуется);
   прод-перепроверка перед приёмкой — команда задокументирована в
   `docs/status/2026-10-08-user-phones-audit-414.md`.

## Test Results

- **vitest (admin):** **3015 / 3015 passed** (182 файла, TZ=UTC), `tsc --noEmit` clean. Новые
  семейства: phone-модуль (редукция/компакт/парс/формат, уникальность кодов), PhoneField (выбор
  страны, формат RU/BY/LV, плейсхолдеры, × и сброс, «без страны», pristine, вставка «+» в
  списке, смена страны с сохранением цифр, валидатор полноты, компакт), prefix/displayQuery
  RemoteSearchSelect, PhoneInput (порог от страны, источник цифр `getNationalNumber`, read-only,
  подъём компакта), сверка-инвариант + гейт длины, карточка/сотрудник/вход/показ.
- **backend:** auth-поверхности точечно **25/25** (новый `test_auth_login_phone_reduction.py`:
  точная строка → уникальная редукция → отказ; коллизия, включая RU/KZ +7); auth-wide регресс
  **261/261** на момент реализации.
- **e2e:** shard1 (schedule) **123/124** — 1 подтверждённый флейк вне #414 (`records.spec`
  пагинация, зелёный на повторе); shard2 (rest) — функциональные спеки зелёные, включая новые
  спеки сценариев 1–7. **46 локальных пиксель-диффов** в `visual-regression`/`wave6` —
  документированный контейнерный фонт-дрифт (`docs/tests_workflow.md` §Known caveats),
  авторитетный гейт — CI.
- Полный e2e-гейт — PR CI.

## Acceptance Criteria

| Критерий | Статус |
|---|---|
| Все 11 задач плана (T1–T11) выполнены, DoD каждой закрыт | ✅ |
| PhoneField во всех точках ввода (запись, карточка, сотрудник ×2, вход) | ✅ (T4/T6/T7/T8b) |
| Компакт в базу при изменении; pristine уходит как лежал; String(20) без миграций | ✅ (T5/T6/T7) |
| Единый показ `formatPhoneDisplay` в пяти точках | ✅ (T9) |
| Вход: точная строка → уникальная редукция → единый отказ; лестница защиты не тронута | ✅ (T8a) |
| Сценарии 1–7 спеки покрыты e2e | ✅ (новые спеки + якоря существующих) |
| Аудит нецифровых логинов: отчёт приложен, нецифровых нет (dev) | ✅ (T10, прод-перепроверка перед приёмкой) |
| Девиации/решения зафиксированы для протокола | ✅ (5 пунктов выше) |

## Key Files Changed

- `frontend/admin/app/components/shared/phone/` — **новый модуль**: `countries.ts`,
  `format.ts`, `PhoneField.tsx`, `CountrySelect.tsx` (+ юнит-тесты)
- `frontend/admin/app/components/shared/PhoneInput.tsx` — пересобран на движке селектора страны
- `frontend/admin/app/components/shared/RemoteSearchSelect.tsx` — опциональные `prefix` +
  `displayQuery` (backward-compatible)
- `frontend/admin/hooks/useRecordMutations.ts` — компакт + сверка-инвариант + гейт длины
- `ClientInfoTab.tsx`, `StaffModal.tsx`, `login/page.tsx` — PhoneField в точках ввода
- Показ: `clientColumns.tsx`, `RecordHeader.tsx`, `ClientLabelById.tsx`, `ClientCardModal.tsx`,
  `ClientQuickCard.tsx`
- Backend: `src/auth/service.py` (редукционный поиск), `scripts/audit_user_phones.py` (**новый**),
  `tests/test_auth_login_phone_reduction.py` (**новый**)
- e2e: **5 новых спек** (`record-phone-field`, `client-card-phone-field`, `staff-phone-field`,
  `login-phone-field`, `phone-country-switch`) + якоря составного поля в ~10 существующих
- Обновлено ~18 юнит-тест-файлов затронутых поверхностей

## Follow-up Candidates (не заведено — список на будущее)

- Дедупликация фикстуры `LEGACY_SEED_SPELLINGS` across 5 тест-файлов.
- Дедупликация хелпера `groupedRu()` в e2e-спеках.
- Асимметрия теста null-телефона `ClientQuickCard`.
- Сырой показ телефона в `ClientTab.tsx:257` и `StaffModal.tsx:718` (вне скоупа плана).
- e2e: заменить `getByLabel('clear')` на предпочтительный `data-testid="phone-clear"`.
- Лишний `waitForTimeout(1500)` в `record-phone-field.spec.ts`.

## Docs Impact

- `PLAN.md` — completion-баннер в шапке (этот docs-коммит).
- `CHANGELOG.md` — новая секция `[Unreleased] — 2026-10-08` → `### Added` (этот docs-коммит).
- Спека (rev3), план и правка канона `clients.md` — на main с Gate B/C, IMPL-веткой не менялись.
- `docs/status/2026-10-08-user-phones-audit-414.md` — вошёл в ветку с T10.

## References

- **GitHub Issue**: #414
- **Design Spec**: `docs/specs/2026-10-07-phone-field-country-selector-414-design.md` (rev3)
- **Plan**: `docs/plans/2026-10-07-phone-field-country-selector-414-plan.md` (T1–T11, 11/11)
- **Аудит логинов**: `docs/status/2026-10-08-user-phones-audit-414.md`
- **PR**: _(to be added after PR creation)_
