# Спека: standalone PATCH mini-contract для Visits и UserSettings (#179)

- **Issue:** #179 «Дедуп generic PATCH-тестов Visits/UserSettings (standalone-сервисы)» (app:core)
- **Дата:** 2026-09-18 · **Ревизия:** rev3
- **Предыстория:** #175 (контракт-тест GenericService.patch, PR #181, смержен 2026-07-28); §8 спеки `docs/specs/2026-07-28-generic-service-patch-contract-design.md` (открытый вопрос 3: «Visits/UserSettings — не трогаем, отдельный issue») закрывается этой спекой.
- **Что изменилось в rev2:** добавлен прод-фикс B (стрип null в `VisitService.patch`); семантика `updated_at` сужена до «реальный patch обновляет» (блокер панели); API-тесты сохранены как HTTP-якоря (MAJOR панели); зафиксированы фикс-требования, not-found сценарии, sentinel-гарантии; сценарий S5; расширен список «не трогаем».
- **Что изменилось в rev3 (решение юзера):** no-op-странность визитов чинится здесь же — пустой PATCH визита становится полным no-op (ранний выход: без записи `updated_at`, без каскада, без события); открытый вопрос о создании строки настроек закрыт фактом (создаётся лениво фронтом при первом заходе); вопрос о «где ещё встречается проблема» закрыт скаутом: больше нигде (§2.3).

## 1. Контекст и проблема

GenericService-сущности покрыты одним параметризованным контракт-тестом
(`backend/tests/services/test_generic_service_contract.py`, 6 patch-семантик),
но Visits и UserSettings — **standalone-сервисы**
(`backend/src/services/visit.py`, `backend/src/services/user_settings.py`,
маркер «GH #239: standalone transactional service»), которые в контракт не
входят (`backend/tests/generic_contract.py` их не импортирует и не
параметризует).

Следствие: общие PATCH-семантики (partial update, empty body, null-handling,
404) для этих двух сервисов продублированы руками в их личных тест-файлах,
часть семантик вовсе не покрыта, а null-поведение визитов расходится с
общим доменным правилом (§2.2).

## 2. Текущее состояние (факты, подтверждены скаутами)

### 2.1 Дубли и пробелы по сервисам

| Семантика | Visits | UserSettings |
|---|---|---|
| partial update | `test_api_visits.py::test_patch_visit_partial`; ещё копия на сервис-уровне `tests/services/test_visit_service.py::test_visit_service_patch_partial` | `test_api_user_settings.py` (theme-only, language-only); ещё копия `test_user_settings_patch.py::TestUserSettingsPatchSemantic` (single, multiple) |
| empty body | **НЕ покрыт** (пробел) | `test_api_user_settings.py::test_patch_empty_body_noop`; ещё копия в `TestUserSettingsPatchSemantic` |
| 404 | `test_api_visits.py::test_patch_visit_not_found_404` | `test_api_user_settings.py::test_patch_not_found_404`; на сервис-уровне — нет |
| null-handling | nullable-поля — «очистка» работает; `price`/`status` — **нарушение** (§2.2), не ассерчено | strip по всем 6 NOT NULL полям не ассерчен явно |
| service-specific | каскад в `record.status`; неизменность `seats` | `TestUserSettingsPatchArchivedVisibility`; own-only — `test_user_settings_auth.py` |

### 2.2 Единое null-правило и где визиты его нарушают

Канон проекта: `docs/domain-rules/_overview.md` (таблица PATCH Contract,
«Источник истины: test_generic_service_contract.py»):

> `null` для NOT NULL поля → стрипится («не менять»); `null` для nullable
> поля → применяется (значение очищается).

Механизм: GenericService-подклассы объявляют `NOT_NULL_FIELDS`
(`backend/src/services/generic.py:57`), общий `_patch_payload` снимает null
по этому множеству (`generic.py:182-193`). UserSettingsService повторяет тот
же приём вручную (`user_settings.py`, локальный set `_not_null_fields`,
все 6 полей `UserSettingsPatch` — NOT NULL в модели). **VisitService strip'а
не имеет** (`visit.py:188-209` — «голый» `model_dump(exclude_unset=True)` +
setattr): явный `null` на NOT NULL колонки `price` и `status` доезжает до
flush, БД отвечает `IntegrityError`, глобальный обработчик
(`backend/src/main.py`) отдаёт HTTP 422 `INTEGRITY_VIOLATION` — падает весь
запрос, включая изменения по остальным полям. Явный `null` на nullable-поля
(`visitor_id`, `tariff_id`, `custom_price`) применяется — эта часть
соответствует канону и используется UI для «очистить поле».

Формулировка в `docs/domain-rules/visits.md` («None means 'don't change'»)
неточна в обе стороны: для nullable-полей null как раз меняет значение.
После фикса B она выравнивается на общий контракт (§3.1).

### 2.3 Где ещё встречается проблема (скаут, rev3) — больше нигде

Реестр всех PATCH-эндпоинтов бэкенда (13 штук) проверен по живому коду:

- Все обычные сущности идут через общий `_patch_payload` + `NOT_NULL_FIELDS`
  — strip встроен в механизм.
- Сервисы с собственным переопределением `patch()` повторяют strip вручную:
  `ServiceService`, `PhotoService`, `StaffService`, `UserSettingsService`.
- `RecordService.patch` переопределён без strip, но patchable-колонок
  обязательного уровня у записей нет (`comment`/`custom_price` — nullable)
  — падать нечему.
- Единственная дыра — `VisitService` (§2.2). Двунаправленный тест
  `NOT_NULL_FIELDS ↔ модель` (`test_generic_service_contract.py`) ловит
  и лишние, и пропущенные объявления — у покрытых контрактом сущностей
  регресс не пройдёт тихо.

## 3. Решение (ревизия rev2)

### 3.1 Прод-фикс B (решение юзера, 2026-09-18)

Две правки в `VisitService.patch`:

- **(a) Стрип явного `null` для обязательных полей** `price` и `status` —
  тем же приёмом, что у UserSettingsService (локальное объявление NOT NULL
  набора перед setattr; перенос на GenericService-наследование по-прежнему
  запрещён). После фикса визиты соблюдают единое null-правило канона.
- **(b) Пустой PATCH = полный no-op** (решение юзера «чиню тут же», rev3):
  если после разбора запроса не пришло ни одного поля — ранний выход без
  записи. Было: `updated_at` двигался безусловно, выполнялись каскад
  `recompute_record_status` и SSE-событие `records`. Стало: пустой запрос
  ничего не меняет — как у всех остальных сущностей.

Одновременно выравнивается формулировка в `docs/domain-rules/visits.md`
(одна-две строки): «null на NOT NULL полях (`price`, `status`) игнорируется;
null на nullable полях (`visitor_id`, `tariff_id`, `custom_price`) очищает
их» — вместо неточного «None means 'don't change'».

### 3.2 Standalone PATCH mini-contract

Новый файл `backend/tests/services/test_standalone_patch_contract.py` —
параметризованный контракт-тест по образцу паттерна #175, без наследования
и без авто-обнаружения:

- Явный список из двух конфигов (проще `EntityConfig` из
  `generic_contract.py`): `service_factory`, `patch_schema`
  (**`UserSettingsPatch` для settings — именно PATCH-схема, PUT не участвует**),
  `not_null_fields` (обязательные), `nullable_field` (пример очищаемого),
  sentinel-пары (original + sentinel с гарантией различия — аналог
  `_ensure_different` из generic-контракта), сценарий not-found,
  фабрики строки/владельца.
- Контракт-семантики (каждая — async-тест, параметризованный по двум
  конфигам; уровень — **сервис**, как в generic-контракте):
  1. **partial update**: sentinel применяется; **все** прочие поля схемы
     равны pre-state (не только один sibling).
  2. **empty body = полный no-op**: значения полей И `updated_at` не
     меняются (после фикса §3.1b — единообразно для обоих сервисов).
  3. **реальный patch обновляет `updated_at`** (сравнение `>=` либо явный
     сдвиг времени перед patch — защита от совпадения тиков SQLite).
  4. **null-policy — единая формула канона**, конфиг задаёт списки:
     `null` на поле из `not_null_fields` → игнор (значение прежнее);
     `null` на `nullable_field` → применяется (очистка). Для list-полей:
     `null` → игнор, `[]` → применяется как значение. Конфиги: Visits —
     not_null `{price, status}`, nullable-пример `custom_price`;
     UserSettings — not_null = все 6, nullable в схеме нет.
  5. **not-found** (сценарии зафиксированы явно): Visits — patch по
     несуществующему `visit_id` → сервис возвращает None; UserSettings —
     patch для `user_id`, у которого нет строки настроек → None.
     Реалистичность сценария подтверждена (rev3): строка настроек создаётся
     лениво фронтом при первом заходе (POST после GET-404 в
     `UserSettingsContext`); бэкенд её не создаёт никогда, поэтому «пользователь
     без строки» возможен (прямые вызовы API, после `DELETE /user-settings`)
     и сегодня отвечает 404 `SETTINGS_NOT_FOUND`.
     HTTP-маппинг в 404 остаётся в api-тестах (по одному на сервис).

### 3.3 Фикстуры и подготовка данных

- Уровень контракта — сервисный (`db_session` + direct service call);
  HTTP-фикстуры не используются.
- UserSettings требует **async-фабрику владельца**: вставка пользователя
  через async-сессию + создание строки настроек сервисным вызовом.
  Существующая синхронная `_user`-фикстура из conftest (отдельный коннект,
  commit, возвращает dict) **как есть не переиспользуется** — порядок
  вставки/видимость в `db_session` решается на плане.
- Для Visits строка-владелец (record) строится существующими async-фикстурами
  conftest (`sample_visit` и родня) — на плане выбрать сервис-уровневый
  вариант без HTTP.
- Конфиг обязан валидировать `not_null_fields`/`nullable_field` против
  фактических колонок модели (`nullable=False`) на этапе RED-прогона.

### 3.4 Что происходит с личными тест-файлами (пересмотрено в rev2)

API-тесты — это проверка «сервер отвечает 200 и корректным телом» + маппинг
роутера на схему; контракт их не заменяет. Удаляются **только чистые дубли**:

| Файл | Действие |
|---|---|
| `backend/tests/test_api_visits.py` | **не трогаем** (`test_patch_visit_partial` — HTTP-якорь 200; каскад; `seats`; 404 — остаются) |
| `backend/tests/services/test_visit_service.py` | удалить `test_visit_service_patch_partial` (сервис-уровневый дубль partial, покрыт контрактом) |
| `backend/tests/test_api_user_settings.py` | удалить `test_patch_language_only` (чистый дубль theme-only); `test_patch_theme_only` — HTTP-якорь 200 (упражняет PATCH-роут с `UserSettingsPatch`); empty-body и 404 остаются |
| `backend/tests/test_user_settings_patch.py` | удалить класс `TestUserSettingsPatchSemantic` (дубль generic-семантик); `TestUserSettingsPatchArchivedVisibility` остаётся; перемещений кода нет |

## 4. Границы скоупа (что сознательно НЕ строим)

- Никаких новых базовых классов / ABC / авто-обнаружения для standalone:
  два явных конфига. Другие standalone-сервисы без PATCH-эндпоинтов
  (Files, Profile, MasterView, Health — по данным скаута) — вне контракта.
  Проблема «null роняет PATCH» больше нигде не встречается (§2.3) —
  расширять фикс не на кого.
- PUT-семантики UserSettings не трогаем: `UserSettingsUpdate`, общий
  сервисный метод `update_by_user_id`, TODO «PUT → strict full-replace» —
  вне скоупа. Контракт якорится строго на `UserSettingsPatch`.
- `backend/tests/test_user_settings_auth.py` (own-only гарантии: чужая
  строка не доступна, stale `?user_id=` игнорируется) — **не трогаем**,
  покрытие сохраняется.
- Rollback-при-ошибке (`@transactional`) не покрываем — не входит в
  generic PATCH-семантики контракта #175.
- Остальной прод-код не трогаем: правки ограничены стрипом в
  `VisitService.patch` + docs-строкой в `visits.md` (§3.1).
- `backend/tests/services/test_generic_service_patch.py` (dead-code
  проверка из #207, НЕ контракт-тест) не трогаем.

## 5. User Scenarios (задачи разработчика)

Задача меняет backend-тесты + точечный стрип в `VisitService.patch`;
Playwright-E2E не применим — сценарные проверки это pytest.

1. **S1. Меняю общее правило PATCH-семантики** (например, обработку пустого
   тела или null) — правлю одно место: параметризованный контракт-тест
   (`test_standalone_patch_contract.py`), а не копии в личных файлах.
   Проверка: контракт параметризован на оба сервиса (2 конфига × 5 семантик).
2. **S2. Пробелы визитов закрыты** — empty body (включая `updated_at`) и
   null-handling покрыты.
   Проверка: намеренная поломка strip'а или раннего выхода в
   `VisitService.patch` роняет контракт (RED), починка — зелёный.
3. **S3. Дубли убраны** — перечень §3.4 применён; личные файлы содержат
   только service-specific и HTTP-якоря.
   Проверка: suite зелёный, удалённые имена тестов отсутствуют.
4. **S4. Service-specific поведение не потеряно** — каскад `record.status`,
   неизменность `seats`, archived-переключатели, own-only (`test_user_settings_auth.py`).
   Проверка: эти тесты на месте и зелёные.
5. **S5. Покрытие не деградировало** — каждое из пяти правил для каждого из
   двух сервисов ассерчено хотя бы одним тестом (контрактом или HTTP-якорем);
   два бывших пробела визитов закрыты контрактом.
   Проверка: список семантик × сервисов закрыт (простая инвентаризация имён
   тестов в PR).

## 6. Behavioral Delta

**Продукт — два изменения, оба в визитах:**

1. PATCH визита с явным `null` в `price` или `status` — было: ошибка 422
   `INTEGRITY_VIOLATION`, весь запрос падает (ни одно поле не применяется);
   стало: эти поля игнорируются как «не менять», остальные переданные
   изменения применяются, ответ успешный.
2. Пустой PATCH визита (ни одного поля) — было: двигался `updated_at`,
   гонялся каскад статуса, другие экраны получали событие «records изменились»;
   стало: полный no-op, как у всех остальных сущностей.

Всё остальное — без изменений: «очистка» nullable-полей (`custom_price`,
`visitor_id`, `tariff_id`), PUT, ответы форм, интеграции. Для UI-сценариев
оба изменения невидимы: интерфейс не шлёт ни `null` в обязательные поля, ни
пустых запросов.

**Дев-контур:** одно место правды по общим PATCH-семантикам для обоих
standalone-сервисов; дубли удалены (§3.4); два пробела визитов закрыты;
домен-правило визитов выровнено с фактическим поведением и каноном `_overview.md`.

## 7. Открытые вопросы (к Gate B)

1. **Sentinel-пары** (original/sentinel с гарантией различия) и сверка
   `nullable=False` по моделям — точный выбор на плане, RED-GREEN поймает
   ошибку.
2. **Docs-правка `visits.md`** (§3.1): включена в скоуп B как одна-две
   строки — показана здесь для полноты, отдельного решения не требует.

Вопросы rev2, закрытые в rev3: no-op-странность — чинится в этой задаче
(§3.1b, решение юзера); создание строки настроек — закрыто фактом (ленивое
создание фронтом, §3.2 п.5).
