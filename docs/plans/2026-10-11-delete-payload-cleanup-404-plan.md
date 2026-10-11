# План: чистка контракта удалений после #345 — единый тип на фронте (#404)

- **Спека:** `docs/specs/2026-10-11-delete-payload-cleanup-404-design.md` — единственный источник поведения; план не пересказывает её, задачи ссылаются на секции.
- **Goal:** пять хуков удаления админки перестают держать локальные копии типа подтверждения и берут общий `ResolveDeleteEntityPayload` из `@memo/api-client`; из теста StaffTable удаляется мёртвая строка настройки подмены. Пользовательского поведения это не меняет (Behavioral Delta — в спеке).
- **Architecture:** одна зона правок — `frontend/admin`: пять файлов хуков (удаление локального объявления с JSDoc, `import type`, переход двух сигнатур файла на импортированное имя) и одна строка в тесте. api-client, бэкенд, прочий фронт не меняются; новых деклараций типов не заводится; entity-семейства api-client не трогаются (решение пользователя 2026-10-11).
- **Tech Stack:** TypeScript (`import type` из `@memo/api-client`), tsc-гейты CI как основная проверка замены, vitest (юнит/компонентные сюиты без правок тестов), Playwright E2E как регрессия (спеки не меняются).

## Task 1 — пять хуков: локальные типы → импорт общего из api-client

- **Классификация:** trivial
- **Файлы:** `frontend/admin/hooks/useClientsMutations.ts` (`ResolveDeleteClientPayload`, ~:137), `useStaffMutations.ts` (`ResolveDeleteStaffPayload`, ~:126), `useLocationsMutations.ts` (`ResolveDeleteLocationPayload`, ~:121), `useMaterialsMutations.ts` (`ResolveDeleteMaterialPayload`, ~:123), `useServicesMutations.ts` (`ResolveDeleteServicePayload`, ~:132).
- **Работа:** в каждом файле одно и то же (спека §Технические изменения, вводный абзац + п.1–5): удалить локальное объявление типа вместе с его JSDoc-комментарием (где есть); добавить отдельной строкой `import type { ResolveDeleteEntityPayload } from '@memo/api-client'` (канал импорта — как у хуков, уже берущих типы из api-client); оба использования локального имени в сигнатурах файла перевести на импортированное. Больше в файлах ничего не менять; других потребителей локальных имён нет (проверено разведкой и панелью).
- **Проверка:** type-check фронта и api-client зелёный; юнит-сюиты `__tests__/useClientsMutations.test.tsx`, `__tests__/use{Staff,Locations,Materials,Services}Mutations.test.ts`, `__tests__/useDelete{Client,Staff,Location,Material,Service}.test.ts` зелёные без единой правки тестов. E2E-тест для сценариев US-1–US-4 проходит (регрессия без RED-фазы — поведение по спеке не меняется); арбитр — CI.
- **Required Docs:** спека §Технические изменения (п.1–5), §Тестирование, §Границы объёма (что НЕ делаем).
- **Соответствие сценариям:** US-1, US-2, US-3, US-4 (локации — юнит-страховка, спека §User Scenarios).

## Task 2 — StaffTable-тест: удалить мёртвую строку

- **Классификация:** trivial
- **Файлы:** `frontend/admin/__tests__/StaffTable.test.tsx`.
- **Работа:** в тесте «Mode A confirm enqueues the deferred delete (resolutions {} + the FULL tree)» (~:481) удалить вызов `setupDeleteConflict(DEPS_AUTO)` (~:483) — его подмена немедленно перезаписывается собственной настройкой теста (~:484–488). Живые вызовы `setupDeleteConflict` в других тестах файла (~:458, ~:471) не трогать; всё остальное в файле без изменений (спека §Технические изменения, п.6).
- **Проверка:** `StaffTable.test.tsx` целиком зелёный (мёртвость строки подтверждена независимо дважды — разведкой и панелью completeness по телу хелпера :202).
- **Required Docs:** спека §Технические изменения (п.6), §Контекст (доказательство мёртвости).
- **Соответствие сценариям:** US-2.
