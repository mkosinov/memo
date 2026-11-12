# GH #593 — Вход по звонку (sms.ru callcheck) + «Связаться» — метод авторизации «звонок» в дополнение к SMS-коду

- **Date**: 2026-11-12
- **Branch**: `593-auth-callcheck` (HEAD `ef9afa79`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `27fcde93` — 7 задач + доки спеки/плана рев.8 + мерж main (`805b810f`), 68 файлов, +7629/−273
- **Issue**: #593 — второй метод авторизации клиента «звонок»: клиент звонит (и сразу сбрасывает) на выданный провайдером номер — sms.ru callcheck подтверждает владение телефоном. Реестр методов авторизации с честной доступностью, initiate/status/dev-done эндпоинты, хранение `auth_calls` + `auth_call_attempts`, единый экран авторизации web (пикер методов, экран звонка, панель «Связаться»), e2e на дев-транспорте.
- **Спека**: `docs/specs/2026-11-11-auth-callcheck-design.md` (рев.8 — `03890cf0`, блокер G4.5 разобран вариантом (b): 1 машинная проверка + 4 manual, покрытых web-e2e)
- **План**: `docs/plans/2026-11-11-auth-callcheck-plan.md` (рев.8) — 7/7 задач, все done
- **Research**: `docs/research/2026-11-11-smsru-callcheck-api.md` (`345a04d2`, `bc8a37b5` — уточнения из ЛК sms.ru)
- **Domain rules**: `docs/domain-rules/auth.md` «Методы авторизации клиента (#593)» — рев.7-правка вошла в main (`2f72a381`, гейт B), рев.8-правки — через main; docser-коммит — только строка `POST /auth/call/dev-done` в таблице эндпоинтов (проза её описывала, таблица — нет; замечено на ревью Task 4)

## Что выполнено

1. **Провайдер-клиент + реестр + конфиг (T1, `8d10668c` standard)** —
   `SmsRuClient` — единственный sms.ru-осведомлённый класс
   (`callcheck/add` + `callcheck/status`, `https://sms.ru/callcheck/`) на
   `MockTransport`; шов `CallcheckProvider` + резолвер транспорта
   `get_callcheck_transport()` в `callcheck_provider.py`:
   `CALLCHECK_TRANSPORT` пуст → метод выключен (fail-closed: в реестре
   недоступен, initiate 503), `dev` — дев-транспорт, `smsru` — с
   `SMSRU_CALLCHECK_API_KEY` (SecretStr, не в логах); валидатор конфига:
   `smsru` с пустым ключом или `dev` при `ENV=production` — ошибка
   старта; честный реестр методов `GET /api/v1/auth/methods` —
   `available` = резолвер вернул объект (не «переменная непуста»);
   слот для будущих методов-мессенджеров (Telegram/Max).
2. **Хранение (T2, `2b64241e` standard)** — миграция
   `b9e1d3f5a7c2`: `auth_calls` (строка одна на телефон, новая заменяет
   старую — как `otp_codes`) + `auth_call_attempts` (append-only журнал
   исходов для инцидент-анализа); `CallcheckStore` (`callcheck_store.py`)
   — find-by-handle (в БД хэш), TTL-чистка; хэширование хэндла/телефона/
   IP (`callcheck.py`); окно проверки 5 минут — константа клиента.
3. **Initiate (T3, `8dd4f4a7` standard)** —
   `POST /api/v1/auth/call/initiate` (`callcheck_login.py`): телефон
   канонический `+7…`, иначе 422; стафф-номера — молчаливый 202 без
   проверки (как у `otp/request`, без оракула перечисления); гейты
   15-минутного окна: 5/телефон, 20/IP, 5 разных номеров/IP + глобальный
   потолок 100/15 мин на процесс (fail-closed 503); IP клиента
   валидируется и передаётся провайдеру (роуминг-подмена 8-800);
   регистрация лимитов и запись в журнал — только на успех провайдера.
4. **Status + финализатор + dev-done (T4, `8ee79564` + `2ee128ca`
   standard)** — `POST /api/v1/auth/call/status`: опрос по одноразовому
   хэндлу; маппинг исходов провайдера — 100/400 → waiting, 401 →
   confirmed (погашение хэндла + финализация клиентского входа — одна
   транзакция; параллельные опросы дают ровно одну сессию), 402 →
   expired, прочее → waiting без смены состояния; статус провайдера
   проверяется раньше локальной экспирации; `POST
   /api/v1/auth/call/dev-done` — дев-имитация звонка: двойной гейт
   `dev_code` (дев-транспорт И точное `ENV=development`), иначе
   неотличимый 404; имитация живёт в транспорте (flip на RESOLVED
   синглтоне), следующий status-полл финализирует обычным потоком;
   `2ee128ca` — wiring: маршруты, poll-usecase, дебаунс, делегирование
   финализации в клиентский логин (сессии клиента не ротируются —
   решение владельца 2026-11-11).
5. **Единый экран авторизации web (T5, `ee63d5b3` + polish `c8bad4c3` +
   рев.8 `ef9afa79`, standard)** — `AuthScreen`: пикер методов из
   реестра (`AuthMethodPicker`, честная доступность — выключенный метод
   не показывается); на `/cabinet` пикер рендерится при загрузке, до
   ввода телефона (рев.8 — достижимость визуального гейта); экран
   звонка `AuthCallScreen` (`tel:` href с номером строго `+7…`, таймер,
   подсказка «звонок бесплатен, сбросьте после гудка»); панель
   «Связаться» `AuthContactChannels` (Telegram/WhatsApp из
   `NEXT_PUBLIC_CONTACT_*`, скрытие при пустых контактах, копирование с
   честным фидбэком); SMS-ветка кода сохранена рабочей (dev).
6. **Web-e2e (T6, `c33038f0` + review `5378b089`, standard)** —
   дев-транспорт в e2e-окружении (`CALLCHECK_TRANSPORT=dev`):
   `booking-callcheck.spec.ts` (US-1: анонимный контекст → форма записи
   → пикер → initiate → dev-done → poll confirmed → запись под сессией
   → «Вы записаны!») и `cabinet-callcheck.spec.ts` (US-2: вход в
   кабинет → «Мои записи»; US-3 ассерты пикера; US-4 «Связаться»;
   US-5 экран истечения + повторный initiate); фикстуры `callcheck.ts`,
   admin-activity.ts; review-фиксы: live-row assert до backdate, общий
   initiate-валидатор, escSql в спек-SQL, хвост бэкоффа.
7. **Примеры окружения (T7, `6bbc12fb` small)** — `backend/.env.example`:
   `CALLCHECK_TRANSPORT` (пусто = метод выключен) +
   `SMSRU_CALLCHECK_API_KEY`; `frontend/web/.env.example` +
   `.env.test`: `NEXT_PUBLIC_CONTACT_TELEGRAM`/`WHATSAPP` (пусто =
   кнопка скрыта).

## Отклонения и фикс-циклы

- **T4:** wiring-коммит `2ee128ca` — маршруты + poll-usecase + дебаунс +
  делегирование финализатора (двухчастный standard).
- **T5:** polish ревью `c8bad4c3` (честный фидбэк копирования, без
  aria-live на тикающем таймере, named phase mapping); mid-phase рев.8
  спеки/плана (`03890cf0`) — предвыбор пикера на `/cabinet` при загрузке
  (`ef9afa79`, HEAD).
- **T6:** review-фиксы `5378b089` (сложены в ветку).
- Девиаций от спеки нет; спека рев.8 и план — коммиты самой ветки
  (рев.7 базовой спеки — `2f72a381` на main), docser их не касался.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Новые backend-сьюты (smsru-client, initiate, status, dev-done, хранение+гейты, миграция/методы/wiring) | **59+17+10+35+34+3** тестов — зелёные + смежные регрессии |
| Полный backend pytest (exit 0) | **4097 passed / 0 failed** (после фиксации 2 контрактов — все зелёные) |
| web vitest | **571/571** |
| api-client vitest | **575/575** |
| e2e callcheck (дев-транспорт, 3 прогона) | **4/4 ×3** |
| e2e SMS-регрессия (кабинет, брутфорс-фикстура) | **4/4** |
| mypy / ruff / tsc | чистые |
| Visual compliance gate G4.5 (рев.8) | **exit 0** — 1 машинная проверка (пикер на `/cabinet` при загрузке) + 4 manual-пункта покрыты web-e2e US-1…US-5; отчёт `/tmp/visual-compliance/visual-compliance-report.md` |

## Ревью

- T1–T6 — standard (two-stage), T7 — small (1-stage); все ревью
  пройдены (compliance ✅, quality ✅ где применимо), финальный статус —
  review-green; фикс-раунды T4/T5/T6 сложены в ветку (см. выше).

## Behavioral Delta

Новая пользовательская возможность — метод входа «звонок»: на экранах
авторизации веба (форма записи + `/cabinet`) рядом с SMS-кодом
появляется «Звонок», когда транспорт настроен; подтверждение телефонной
карточки — тем же финализатором, что SMS-OTP (найди-или-создай учётки и
`UserSettings`, `phone_is_confirmed=true`, cookie `memo_client_session`;
сессии не ротируются). Поведение по умолчанию не меняется:
`CALLCHECK_TRANSPORT` пуст → метод выключен целиком (не в реестре,
initiate 503), SMS-ветка и существующие поверхности байт-нетронуты.
Новые таблицы `auth_calls`/`auth_call_attempts` — не ломающие
миграции (`b9e1d3f5a7c2`). Панель «Связаться» — только при заполненных
`NEXT_PUBLIC_CONTACT_*`.

## PR-заметки

- `Closes #593` — только в описании PR (канон репо), в коммиты не пишется.
- Спека (рев.7 `2f72a381` на main; рев.8 `03890cf0`) и план (рев.8) —
  коммиты самой ветки; исследование — `345a04d2`/`bc8a37b5`.
- Domain-rules `auth.md`: секция «Методы авторизации клиента (#593)»
  вошла в main (`2f72a381`, гейт B); docs-коммит docser — только
  отсутствовавшая строка `POST /auth/call/dev-done` в таблице эндпоинтов
  + мета-доки (PLAN.md, CHANGELOG.md, этот файл).
- Merge origin/main `805b810f` — авто-мерж без конфликтов (общие файлы
  — `packages/api-client`, `docs/specs|plans`, env-примеры).

## Тронутые файлы (`git diff --name-only 27fcde93..ef9afa79`)

```
backend/.env.example
backend/alembic/versions/b9e1d3f5a7c2_auth_calls_auth_call_attempts.py
backend/pyproject.toml
backend/src/auth/callcheck.py
backend/src/auth/callcheck_gates.py
backend/src/auth/callcheck_provider.py
backend/src/auth/callcheck_store.py
backend/src/auth/public.py
backend/src/auth/router.py
backend/src/auth/smsru_client.py
backend/src/core/config.py
backend/src/domain/phones.py
backend/src/models/__init__.py
backend/src/schemas/auth.py
backend/src/usecases/callcheck_login.py
backend/src/usecases/client_login.py
backend/src/usecases/otp_login.py
backend/tests/test_auth_call_dev_done.py
backend/tests/test_auth_call_initiate.py
backend/tests/test_auth_call_status.py
backend/tests/test_auth_callcheck.py
backend/tests/test_auth_callcheck_migration.py
backend/tests/test_auth_methods_api.py
backend/tests/test_auth_permissions.py
backend/tests/test_callcheck_wiring.py
backend/tests/test_master_scope_contract.py
backend/tests/test_models.py
backend/tests/test_smsru_client.py
backend/uv.lock
docs/plans/2026-11-11-auth-callcheck-plan.md
docs/research/2026-11-11-smsru-callcheck-api.md
docs/specs/2026-11-11-auth-callcheck-design.md
frontend/web/.env.example
frontend/web/.env.test
frontend/web/app/__tests__/cabinet-payments.test.tsx
frontend/web/app/__tests__/cabinet-photos.test.tsx
frontend/web/app/__tests__/cabinet-records.test.tsx
frontend/web/app/__tests__/cabinet.test.tsx
frontend/web/app/__tests__/fixtures/cabinet.tsx
frontend/web/app/hooks/__tests__/useAuthMethods.test.tsx
frontend/web/app/hooks/__tests__/useCallAuth.test.tsx
frontend/web/app/hooks/useAuthMethods.ts
frontend/web/app/hooks/useCabinetAuth.ts
frontend/web/app/hooks/useCallAuth.ts
frontend/web/app/hooks/useOtpLogin.ts
frontend/web/app/lib/__tests__/contacts.test.ts
frontend/web/app/lib/contacts.ts
frontend/web/app/lib/model/domain/__tests__/phones.test.ts
frontend/web/app/lib/model/domain/phones.ts
frontend/web/app/ui/AuthCallScreen.tsx
frontend/web/app/ui/AuthContactChannels.tsx
frontend/web/app/ui/AuthMethodPicker.tsx
frontend/web/app/ui/AuthScreen.tsx
frontend/web/app/ui/BookingActivityOverlay.tsx
frontend/web/app/ui/CabinetLogin.tsx
frontend/web/app/ui/__tests__/AuthCallScreen.test.tsx
frontend/web/app/ui/__tests__/AuthContactChannels.test.tsx
frontend/web/app/ui/__tests__/AuthMethodPicker.test.tsx
frontend/web/app/ui/__tests__/AuthScreen.test.tsx
frontend/web/app/ui/__tests__/BookingOverlay.test.tsx
frontend/web/e2e/booking-callcheck.spec.ts
frontend/web/e2e/cabinet-callcheck.spec.ts
frontend/web/e2e/fixtures/admin-activity.ts
frontend/web/e2e/fixtures/callcheck.ts
frontend/web/scripts/e2e-stack.sh
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.ts
```

## References

- **GitHub Issue**: #593
- **Design Spec**: `docs/specs/2026-11-11-auth-callcheck-design.md` (рев.8)
- **Plan**: `docs/plans/2026-11-11-auth-callcheck-plan.md` (рев.8, 7/7)
- **Research**: `docs/research/2026-11-11-smsru-callcheck-api.md`
- **Domain rules**: `docs/domain-rules/auth.md` «Методы авторизации клиента (#593)»
- **Смежные**: #499 (клиентские учётки + OTP — финализатор и `memo_client_session` наследуются), #586 (SMS-транспорт OTP — соседний метод реестра), #513 (кабинет — экраны, куда ведёт вход)
- **PR**: _(to be added after PR creation)_
