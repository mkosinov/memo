# План #330: Индикатор потери связи с сервером + таймауты запросов

Спека: `docs/specs/2026-09-19-connection-loss-indicator-330-design.md` (Behavioral Delta — там, здесь не дублируется).

## Goal

Пользователь админки всегда видит, когда связь с сервером потеряна: один персистентный тост
«Нет соединения с сервером. Обновления приостановлены» через 5 с устойчивой потери, без шквала
одинаковых «Ошибка сети» от каждой загрузки. Зависшие запросы обрываются клиентом за 30 с
(загрузка файлов — 120 с) без повторных попыток, с понятным сообщением. Источник истины о связи —
SSE-канал #239; тихий реконнект и серверный контракт не меняются.

## Architecture

```
SSE-канал #239 (EventSource, ServerEventsProvider)
   ↓ onerror при CONNECTING — восстановимый сбой · onopen — связь есть
   ↓ onerror при CLOSED — фатальное закрытие (401/прокси): НЕ потеря сети, индикатор сбрасывается
connectionHealth (новый модуль-флаг «канал в сбое») + локальные в провайдере: таймер 5 с, id тоста
   ↓                                          ↓
QueryCache.onError: гейт дедупа         персистентный тост (UIContext + ToastContainer):
транспортных тостов (isNetworkError,    без авто-таймера, без ×, не вытесняется очередью из 5
после console.error)                    + retry-предикат: TimeoutError/AbortError не ретраятся
   ↓
api-client (общий для admin и web — решение A): AbortSignal.timeout 30с/120с
   ↓ TimeoutError (не AbortError!) → parseApiError: «Превышено время ожидания запроса»
```

Серверных правок нет. Осознанные остаточные ограничения R1–R4 (тихая смерть канала, прокси-502,
один просочившийся тост, позиция контейнера) — в спеке §6, отдельными задачами не покрываются.

## Tech Stack

Frontend admin: Next.js · vitest (`frontend/admin/__tests__/`) · Playwright
(`frontend/admin/e2e/`). Общий клиент: `packages/api-client` (используется и web-витриной —
наследование таймаутов одобрено пользователем, вариант A).

---

## Task 1 — parseApiError: ветки прерываний + классификаторы

**Классификация:** small
**Сценарии:** S4 (сообщение о таймауте), S3/S6 (транспортный класс для дедупа)
**Required Docs:** спека §5.6; `docs/design-system.md` (раздел Toast — только контекст сообщений)

- `frontend/admin/app/lib/api/parseApiError.ts`:
  - ветка `err.name === 'TimeoutError'` → `{ message: 'Превышено время ожидания запроса' }`
    (сейчас попадает в «Неизвестная ошибка»); классификация строго по `err.name`, не по
    `instanceof DOMException` (jsdom/полифилы);
  - ветка `err.name === 'AbortError'` → `{ message: 'Запрос отменён' }` (явная отмена
    caller-сигналом; сегодня недостижимо, страховка контракта);
  - экспорт `isNetworkError(err)`: `TypeError` или имя `TimeoutError`/`AbortError` — транспортный
    класс; `ApiError` не входит никогда (значит 401/403 гейт дедупа заглушить не может);
  - экспорт `isAbortClass(err)`: имя `TimeoutError`/`AbortError` — для retry-предиката Task 5.
- Юнит `frontend/admin/__tests__/parseApiError.test.ts` (файл существует — расширить):
  TimeoutError → сообщение о таймауте; AbortError → «Запрос отменён»; TypeError → «Ошибка сети»
  (существующие проверки не трогать); `isNetworkError` — три транспортных да, `ApiError` нет;
  `isAbortClass` — только TimeoutError/AbortError.

## Task 2 — api-client: таймауты запросов

**Классификация:** small
**Сценарии:** S4 (обрыв зависшего запроса)
**Required Docs:** спека §5.5

- `packages/api-client/src/client.ts`:
  - константы `REQUEST_TIMEOUT_MS = 30_000`, `UPLOAD_TIMEOUT_MS = 120_000`;
  - в `api()`: `signal: options?.signal ?? AbortSignal.timeout(body instanceof FormData ?
    UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS)` — ключ строго ПОСЛЕ разворота `...options`
    (явный caller-signal не перекрывается; детект FormData — по образцу строки 48);
  - без изоляции web-витрины (решение пользователя, вариант A): общий клиент — единая точка.
- Юнит `packages/api-client/src/client.test.ts` (существует — расширить), без fake timers
  (внутренний таймер `AbortSignal.timeout` ими не управляется):
  - spy на `AbortSignal.timeout`: JSON-запрос запрашивает порог 30 000, FormData-запрос — 120 000;
  - прерывание реальным коротким caller-signal (~10 мс) доходит до fetch (passthrough).
- Проверить, что сборки admin и web проходят с изменённым пакетом (API уже используется в
  `e2e/globalSetup.ts` — Node-сторона доказана).

## Task 3 — Персистентный тост: UIContext + ToastContainer

**Классификация:** small
**Сценарии:** S1 (тост не исчезает сам, не закрывается, не вытесняется)
**Required Docs:** спека §5.3; `docs/design-system.md` (раздел Toast — заметка о persistent-варианте уже записана, реализация обязана ей соответствовать)

- `frontend/admin/contexts/UIContext.tsx`:
  - 6-й опциональный позиционный параметр `persistent?: boolean` у `showToast` (по образцу 5-го
    `action` из #285); поле `persistent?: boolean` в типе `Toast`;
  - блок авто-таймера: `if (kind !== 'loading' && !persistent)`; существующие вызовы совместимы
    без правок (параметр последний и опциональный).
- `frontend/admin/app/components/toast/ToastContainer.tsx`:
  - крестик «Закрыть» (сейчас у всех тостов кроме `loading`) не рендерится для
    `toast.persistent`;
  - обрезка очереди до последних 5 (строка 13): persistent-тост в срез не входит и не
    вытесняется — рендерится поверх очереди (максимум 5 + 1 persistent).

## Task 4 — connectionHealth + машина состояний в ServerEventsProvider

**Классификация:** standard
**Сценарии:** S1 (тост ≤ 8 с после обрыва), S2 (скрытие и конвергенция на восстановлении), S5 (дрожь ниже 5 с — ничего), S1-частный (открытие при мёртвой сети)
**Required Docs:** спека §5.1, §5.2, §4 (переходы, фатальное закрытие)

- Новый `frontend/admin/app/lib/connectionHealth.ts`: модуль-флаг
  `let channelDown = false` + `setChannelDown(v)` / `isChannelDown()`; начальное значение —
  «связь есть»; без React-реактивности (читатель — синхронный колбэк QueryCache.onError; в
  будущем — ветка «ответа не было» контракта удаления, `docs/domain-rules/deletion.md:23`);
  отдельного юнит-файла нет (тривиальный seam, покрывается e2e Task 6).
- `frontend/admin/app/ServerEventsProvider.tsx`:
  - при монтировании: `setChannelDown(false)` (StrictMode-перемонтирование не оставляет
    протухший флаг; реальный сбой переустановится первым `onerror`);
  - `onerror`: при `es.readyState === EventSource.CLOSED` — фатальное закрытие (401/прокси —
    сервер доступен): отменить таймер, `setChannelDown(false)`, скрыть тост если показан, выйти;
    иначе — `setChannelDown(true)` и запуск таймера `LOST_DEBOUNCE_MS = 5000`, если не запущен
    (повторные `onerror` при устойчивой потере состояние не меняют, таймер не перезапускают);
  - таймер сработал: если тост не показан — `showToast('Нет соединения с сервером. Обновления
    приостановлены.', 'error', undefined, undefined, undefined, true)`, id в ref (строго один);
  - `onopen`: отмена таймера, `setChannelDown(false)`, `hideToast(id)` если показан; существующая
    blanket-инвалидация и «тихий реконнект» #239 не меняются;
  - unmount: очистка таймера и тоста (гигиена по образцу существующего таймера батча);
  - `showToast`/`hideToast` стабильны (`useCallback`, пустые зависимости) — добавление
    `hideToast` в зависимости эффекта не пересоздаёт EventSource;
  - комментарий на вызов-точке персистентного тоста с расшифровкой шестого позиционного
    параметра (сигнатура из Task 3).

## Task 5 — providers.tsx: гейт дедупа + retry-предикат

**Классификация:** small
**Сценарии:** S3 (не более одного транспортного тоста), S4 (честные ~30 с без ретраев), S6 (per-action тосты действий не глушатся)
**Required Docs:** спека §5.4, §5.7

- `frontend/admin/app/providers.tsx`, порядок в `QueryCache.onError`:
  `meta.silent` → `console.error('[Query]', ...)` → гейт
  `if (isNetworkError(err) && isChannelDown()) return;` → тост. Гейт ПОСЛЕ `console.error` —
  диагностика в консоли не глушится; ApiError (4xx/5xx, включая 401/403) гейт не трогает.
- `retry: (failureCount, error) => failureCount < 2 && !isAbortClass(error)` — прерванные по
  таймауту/отмене запросы не ретраятся (иначе тост уезжал бы на ~90–95 с); `TypeError`
  ретраится как раньше (миг сети + задержка закрывает окно гонки дедупа, R3).
- Мутации не затрагиваются (MutationCache в файле отсутствует — per-action ошибки остаются).

## Task 6 — E2E: расширение server-push-спеков

**Классификация:** standard
**Сценарии:** S1, S2, S3, S6 (offline-спек), S5 (invalidation-спек, отрицательная проверка)
**Required Docs:** спека §2, §8; существующие `frontend/admin/e2e/server-push-offline.spec.ts` (С5), `frontend/admin/e2e/server-push-invalidation.spec.ts`

- `server-push-offline.spec.ts` (расширить, существующие проверки С5 сохранить):
  - S1: `setOffline(true)` → персистентный тост «Нет соединения с сервером» виден ≤ 8 с
    (5 с дебаунс + нативный onError);
  - S1: у персистентного тоста нет крестика (assert по `aria-label="Закрыть"` внутри этого тоста);
  - S3: offline + несколько переходов по разделам → не более 1 тоста «Ошибка сети» (потолок,
    не ноль — остаточное R3);
  - S6: после навигации (0 тостов) — действие с ошибкой → ровно +1 тост ошибки действия;
  - S2: `setOffline(false)` → тост скрыт, данные сошлись (существующие проверки конвергенции
    остаются, дополняются проверкой скрытия тоста).
- `server-push-invalidation.spec.ts` (дополнить): на здоровом прогоне с реконнектами тост
  «Нет соединения» не появляется (S5 — дрожь ниже порога молчит).
- Тайминги: 8 с — потолок; между offline и подсчётом тостов — пауза не меньше цикла ретраев
  React Query (~4 с), чтобы не ловить до-гейтовые срабатывания.

## Task 7 — Полная верификация (DoD)

**Классификация:** small
**Сценарии:** все (S1–S6 сквозным прогоном)
**Required Docs:** спека §8

- `vitest` по admin и `packages/api-client` — зелёные; новый/расширенные юнит-файлы из Task 1–2
  входят в прогон.
- `eslint` + `typecheck` (tsc) по изменённым пакетам — чисто.
- Точечный Playwright-прогон двух server-push-спеков — зелёный; затем полный e2e-прогон по
  нормам репозитория (`test-all.sh` / шардирование) — без новых красных.
- Ручная проверка S4 (30-секундное ожидание в e2e не переносится — спека §8): поднять дев-стек,
  заблокировать ответ запроса, убедиться в обрыве за ~30 с и сообщении.
