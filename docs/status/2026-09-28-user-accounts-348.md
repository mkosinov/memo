# GH #348 — Управление учётками пользователей: телефон, сброс пароля по одноразовой ссылке, создание учётки без пароля

- **Date**: 2026-09-28
- **Branch**: `348-user-accounts`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `5a96d01a` — 18 commits (`75d06221..b1a424ed`), 69 files, +6686 / −293
- **Issue**: #348 — управление учётками пользователей (выделено из #319)
- **Spec**: `docs/specs/2026-09-27-user-accounts-348-design.md` (rev2, on main — unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-27-user-accounts-348-plan.md` (9/9 задач T1–T9, on main)
- **Canon**: `docs/domain-rules/auth.md` (обновлён спека-коммитом `73399f2d` на main)

## Goal

Админ управляет учётками сотрудников, не зная их паролей: учётка создаётся без пароля (только
телефон), пароль владелец задаёт сам по одноразовой ссылке, которую система показывает админу
для ручной передачи; той же ссылкой работает сброс пароля; телефон существующей учётки
редактируется. Роль учётки редактируется как было (задача 263, D10) — не тронута.

## Summary of Changes (per task)

- **T1 — модель и миграция (standard, `75d06221`):** `PasswordSetupToken` — PK = SHA-256
  дайджест токена (сырой токен живёт только в ссылке), `user_id` FK каскад + индекс,
  `expires_at` (UTC), `used_at`, частичный уникальный индекс «один живой токен на учётку»
  (`user_id` среди `used_at IS NULL`); `users.password_hash` → nullable (существующие строки
  не тронуты); миграция `d7f9b1e3a5c7`, upgrade/downgrade симметричны.
- **T2 — сценарии токенов (standard, `c74c7d56`):** `usecases/password_setup.py` —
  `issue_password_link` (отказ деактивированной 422 `ACCOUNT_DEACTIVATED`; в одной транзакции
  удаляет ВСЕ прежние токены пользователя и создаёт новый; срок жизни — параметр, по умолчанию
  24 ч; аудит «password_link_issued», автор — админ) и `set_password_by_link` (валидация
  политики и хэширование до транзакции; условное поглощение токена — 0 строк → отказ; проверка
  активности учётки; сброс всей лестницы блокировок — три поля; отзыв всех сессий; записи аудита
  нет — публичный вызов); все отказные пути — одинаковый 422 `PASSWORD_LINK_INVALID` с фиктивной
  работой в дешёвых ветках (тайминговая чёткость).
- **T3 — учётка без пароля + телефон (standard, `aad4c6c4`):** `create_staff_account` строит
  учётку с NULL-хэшем (гарантия строки `UserSettings` #319 в той же транзакции сохранена;
  `CreateUserSection` без поля пароля — breaking; CLI-сценарий `create_user` остался с паролем);
  единый валидатор телефона (`PHONE_INVALID`, 20 символов после трима, уникальность «по точной
  строке» без нормализации); сценарий `update_user_phone` с аудитом (телефон в снимке
  маскируется), сессии не отзываются.
- **T4 — API-вертикаль users (small, `c38a2aa5` + `2fb44180`):** `PATCH /api/v1/users/{id}`
  (тело `{phone}`, лишние ключи → 422) и `POST /api/v1/users/{id}/password-link` — обе под
  `require_admin`; вертикаль зарегистрирована в allowlist master-scope контракта.
- **T5 — публичные эндпоинты (standard, `1ea6d3d7`):** validate/setup в auth-роутере, оба в
  анонимном allowlist; null-guard логина — учётка с NULL-хэшем отвечает обычным отказом вместо
  500 на аргон-проверке. Arch decision: null-guard **401, не 422** — паритет перечисления с
  обычным отказом.
- **T6 — контракт карточки (small, `541d0079`, `57c08bcc`):** `StaffResponse.account`
  `{id, phone, role, password_is_set, is_active, link_expires_at | null}` (NULL = нет живого
  токена); api-client `patchUser`/`issuePasswordLink` + zod-схемы.
- **T7 — фронт: блок «Учётка», диалог ссылки, словарь (standard, `503f414e`, `f11ecddc`,
  `74689477`, `551c87bb`):** StaffModal — блок «Учётка»: телефон редактируемый (сохранение
  отдельным `patchUser`, inline-ошибка «Этот телефон уже занят» по `PHONE_TAKEN`,
  `PHONE_INVALID` — inline у поля, прочие ошибки — тост), роль и флажок архивирования как были;
  `account.is_active = false` → блок read-only; `account = null` → скрыт. Кнопка «Сбросить
  пароль»/«Выдать ссылку» по `password_is_set`, статус «Ссылка выдана, действует до …» при
  живом токене; диалог ссылки («Скопировать», срок, подсказка; неудача выдачи после создания →
  ошибка + «Повторить»). Ссылка = `window.location.origin` + `/password-setup#token=…`.
  Словарь `auditLabels` — подпись «password_link_issued».
- **T8 — публичная страница (standard, `730fb0b4`, `e213358c`):** `/password-setup` вне
  защищённой группы маршрутов — токен из `#token=`-фрагмента (очищается после чтения), проверка
  при открытии выбирает форму или экран «Ссылка недействительна или истекла»; inline-ошибка
  политики (одно сообщение, 422 `PASSWORD_POLICY`); успех → `/password-setup/success`
  (обновление страницы не повторяет запрос); StrictMode-стойкая инициализация.
- **T9 — e2e (standard, `fd8de883`, `16f15526`, `b1a424ed`):** S1–S6 —
  `staff-s7-create-composite.spec.ts` (форма без поля пароля, диалог ссылки после создания),
  `password-setup-link.spec.ts` (установка по ссылке и вход, перевыпуск гасит прежнюю ссылку,
  повторное использование → экран отказа), `account-management.spec.ts` (правка телефона и вход
  по новому, занятый телефон, состояния блока «Учётка», вход без пароля отказывает).
- **Bugfix попутный (`ab0eff00`):** startup migration bootstrap штамповал пустую/полую БД
  головой, ломая следующую миграцию — починено (fix старта), +2 теста в `test_migrate.py`.

## Acceptance (spec §2 S1–S8)

- **S1–S6** — e2e-покрытие (см. T9).
- **S7** (только админ: мастеру 403 на выдачу ссылки и правку телефона) — API-тесты T4.
- **S8** (отзыв сессий после установки) — юнит-тесты T2; аудит выдачи есть / установки нет —
  юнит-тесты T2/T3.

## Test Results

- **Backend (новые наборы):** password_setup_tokens **17**, usecases/password_setup **14+7**,
  user_phone **23** (386-строчный набор), api_users **18**, auth_password_setup_api **25**,
  staff_account **7**, test_migrate **+2**.
- **api-client:** **436 pass** (эндпоинты/схемы выросли под users-вертикаль).
- **Admin vitest:** 132 точечных (StaffAccountBlock/StaffModal/StaffTable/useStaffMutations/
  auditLabels/parseApiError) + PasswordSetup pages **21**; полный прогон **2561 passed / 3
  failed** — все 3 pre-existing TZ-locale артефакты, зелёные при TZ=UTC.
- **E2E #348:** 6 спеков S1–S6 зелёные standalone + затронутые (collateral) **15/15**.
- **Visual gate:** PASS **22/22** autonomous drill (скриншоты `/tmp/opencode/vc348/` —
  эфемерное свидетельство, не коммитится).

## Reviews

- Каждая задача — двухстадийное ревью; T4/T6 — compliance-only (классификация small).
- Все блокеры ревью закрыты: T7 — инвалидация ссылки (`551c87bb`), T8 — StrictMode-стойкая
  инициализация (`e213358c`).

## Docs Impact

- Спека и план живут на main и веткой не менялись.
- Канон `docs/domain-rules/auth.md` обновлён спека-коммитом `73399f2d` на main — веткой
  канона не трогали.
- Этот файл + CHANGELOG + баннер PLAN — единственные артефакты docs-коммита.

## Deviations from the plan

- Попутный багфикс `ab0eff00` (bootstrap-классификация пустой БД) не был предусмотрен планом —
  вскрыт тестами миграций; починен в этой ветке, т.к. без него следующая миграция после
  свежего сида падала на старте.
- Прочих отклонений нет: 9/9 задач по плану.

## References

- **GitHub Issue**: #348
- **Channels follow-up**: #398 (Max/Telegram/email/SMS — шов для них подготовлен, origin пока
  `window.location.origin`)
- **Design Spec**: `docs/specs/2026-09-27-user-accounts-348-design.md` (rev2, on main)
- **Plan**: `docs/plans/2026-09-27-user-accounts-348-plan.md` (on main, T1–T9)
- **Canon**: `docs/domain-rules/auth.md` («Одноразовая ссылка установки пароля»)
- **PR**: _(to be added after PR creation)_
