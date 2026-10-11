# Спека: чистка после контракта удалений — единый тип подтверждения удаления и мёртвая строка теста (#404)

- Дата: 2026-10-11
- Поток: стандартный (спека + панель → план)
- Предыстория: follow-up качества после семейного контракта удалений #345 (PR #401)

## Контекст (самодостаточно)

В админке memo действует семейный контракт удалений (#345): когда администратор удаляет запись, у которой есть зависимые объекты, сервер возвращает 409 со деревом зависимостей, фронт показывает диалог с пометками «будут удалены / будут отвязаны», а подтверждение отправляет на сервер тело вида:

```ts
{ expected: Record<string, string[]>; resolutions?: Record<string, string> }
```

Общее описание этого тела уже экспортировано из api-client: `ResolveDeleteEntityPayload` (`packages/api-client/src/endpoints.ts:158`). Кроме него api-client экспортирует entity-специфичные варианты (`ResolveDeleteTagPayload`, `ResolveDeletePhotoPayload`, `ResolveDeletePositionPayload`, `ResolveDeleteRecordPayload`, `ResolveDeleteVisitorPayload`) — все структурно идентичны общему.

Десять хуков удаления во фронтенде делятся на две группы:

- пять импортируют entity-специфичные типы из пакета `@memo/api-client` (теги, фото, должности, записи, посетители);
- пять держат собственные локальные копии — `frontend/admin/hooks/useClientsMutations.ts:137` (`ResolveDeleteClientPayload`), `useStaffMutations.ts:126` (`ResolveDeleteStaffPayload`), `useLocationsMutations.ts:121` (`ResolveDeleteLocationPayload`), `useMaterialsMutations.ts:123` (`ResolveDeleteMaterialPayload`), `useServicesMutations.ts:132` (`ResolveDeleteServicePayload`).

Все пять локальных форм побайтово совпадают с `ResolveDeleteEntityPayload`. Внешних потребителей локальных имён нет (проверено поиском по всему фронтенду и пакетам — ноль использований вне определяющих хуков).

Отдельно: в `frontend/admin/__tests__/StaffTable.test.tsx:483`, в тесте «Mode A confirm enqueues the deferred delete (resolutions {} + the FULL tree)» (:481), стоит вызов `setupDeleteConflict(DEPS_AUTO)`. Он мёртв: хелпер не настраивает ничего, кроме подмены `mockUseDeleteStaff` (:202), а эта подмена немедленно перезаписывается собственной настройкой теста (:484–488) — её результат компонент никогда не видит. Остальные вызовы `setupDeleteConflict` в файле (:458, :471) живые и не трогаются.

## Проблема

Один и тот же смысл — форма подтверждения отложенного удаления — описан шестью независимыми копиями (одна общая в api-client + пять локальных). Правка формы означает шесть правок; читатель хука не видит, что тип уже общий. Мёртвая строка в тесте StaffTable сбивает с толку: она выглядит значимой настройкой, но на поведение теста не влияет.

## Концепт и границы объёма

Делаем ровно две вещи:

1. В пяти перечисленных хуках удаляем локальные объявления типа (вместе с их JSDoc-комментариями, где есть) и добавляем отдельной строкой `import type { ResolveDeleteEntityPayload } from '@memo/api-client'` — канал импорта тот же, что у остальных пяти хуков; сами они импортируют entity-специфичные типы, для наших пяти тип общий будет новым. Оба использования локального имени в сигнатурах каждого хука переходят на импортированное имя.
2. В `StaffTable.test.tsx` удаляем мёртвый вызов `setupDeleteConflict(DEPS_AUTO)` в Mode-A тесте (строка ~483).

Что мы сознательно НЕ делаем:

- не трогаем entity-специфичные экспорты api-client (`ResolveDeleteTagPayload` и остальные) — они используются хуками напрямую, а их свёртка в общие типы-алиасы сознательно отклонена (решение пользователя 2026-10-11): у каждого эндпоинта остаётся собственный набор типов, зеркало бэкенда остаётся самодостаточным, лишние строки текста приемлемы; новых entity-типов для пяти сущностей задачи тоже не заводим — хуки берут общий `ResolveDeleteEntityPayload`;
- не меняем API-контракт, сетевые запросы и форму тела подтверждения — замена типа внутренняя, формы идентичны;
- не создаём E2E-спеку для удаления локаций (сегодня локации покрыты только юнит-тестами) — закрытие этого пробела отдельная задача, не следующая из #404;
- не трогаем остальные таблицы, хуки и тесты (в т.ч. setupDeleteConflict-вызовы в других тестах StaffTable — там они живые).

## User Scenarios

Фича внутренняя: новых пользовательских задач нет. Сценарии ниже — регрессионные гарантии: существующие потоки семейства удалений обязаны работать после чистки точно так же, как до неё. Каждый привязан к существующему E2E-тесту.

- **US-1.** Администратор удаляет клиента с зависимостями (фото, записи): появляется диалог с пометками, подтверждение отправляет `{resolutions, expected}` и удаляет клиента. — E2E: `frontend/admin/e2e/clients-delete-cascade.spec.ts`, тест «S1 — … dialog one-liners → confirm → ring toast → commit {resolutions, expected} → 204».
- **US-2.** Администратор удаляет сотрудника, все зависимости разрешаются автоматически: подтверждение отправляет `{resolutions: {}, expected: {}}` и каскад удаляет дерево. — E2E: `frontend/admin/e2e/staff-delete-auto-cascade.spec.ts`, тест «confirm → ring toast → commit {resolutions:{}, expected:{}} cascades user, masters row, tags, positions».
- **US-3.** Администратор удаляет материал, использованный в услугах: диалог показывает информационную строку авто-разрешения, подтверждение удаляет материал, услуги остаются. — E2E: `frontend/admin/e2e/materials-delete.spec.ts`, тест «dry-run 409 → informational auto line, confirm → ring toast, commit, service alive».
- **US-4.** Администратор удаляет услугу, на которую ссылаются записи: подтверждение отвязывает тарифную ссылку, записи остаются с ценой. — E2E: `frontend/admin/e2e/services-crud.spec.ts`, тест «US-5: dry-run → confirm → service gone, visits survive with price and null tariff link» (внутренняя метка теста — US-5 из спеки #357; номер не связан с номером сценария здесь).

Локации не имеют отдельного E2E (см. границы объёма): их страховка — юнит-набор `__tests__/useLocationsMutations.test.tsx` (тест «409 + dependency tree rejects upward so the call site opens the dialog», :204) и сюита `__tests__/useDeleteLocation.test.ts`.

## Behavioral Delta

| Поток | До | После |
|---|---|---|
| Все пользовательские потоки удалений (US-1–US-4 и остальные) | Работают как описано в контракте #345 | Без изменений — та же форма тела, те же запросы, тот же UI |

Для пользователя дельта отсутствует. Изменения только внутренние: пять локальных типов заменены импортом общего; из теста удалена мёртвая строка.

## Технические изменения

Во всех пяти файлах одна и та же операция: локальное объявление типа удаляется вместе с его JSDoc-комментарием (где есть), оба использования локального имени в сигнатурах файла переходят на импортированное, добавляется отдельная строка `import type { ResolveDeleteEntityPayload } from '@memo/api-client'`.

1. `frontend/admin/hooks/useClientsMutations.ts` — `ResolveDeleteClientPayload` (:137).
2. `frontend/admin/hooks/useStaffMutations.ts` — `ResolveDeleteStaffPayload` (:126).
3. `frontend/admin/hooks/useLocationsMutations.ts` — `ResolveDeleteLocationPayload` (:121).
4. `frontend/admin/hooks/useMaterialsMutations.ts` — `ResolveDeleteMaterialPayload` (:123).
5. `frontend/admin/hooks/useServicesMutations.ts` — `ResolveDeleteServicePayload` (:132).
6. `frontend/admin/__tests__/StaffTable.test.tsx` — удалить мёртвую строку `setupDeleteConflict(DEPS_AUTO)` (~:483) в Mode-A тесте; всё остальное в файле без изменений.

Формы типов идентичны, внешних потребителей локальных имён нет — замена проверяется компилятором.

## Тестирование

- Компиляция: существующие гейты type-check фронта и api-client в CI.
- Юнит: сюиты `__tests__/useClientsMutations.test.tsx` (единственная с расширением `.tsx`) и `__tests__/use{Staff,Locations,Materials,Services}Mutations.test.ts`, а также `__tests__/useDelete{Client,Staff,Location,Material,Service}.test.ts` проходят без правок тестов.
- Компонентный: `__tests__/StaffTable.test.tsx` проходит после удаления мёртвой строки.
- E2E: US-1–US-4 — регрессия без изменений кода; арбитр — CI.

## Visual Compliance Checks

N/A

## Риски и откат

Замена механическая, формы идентичны — риск нулевой. Откат — revert PR целиком.
