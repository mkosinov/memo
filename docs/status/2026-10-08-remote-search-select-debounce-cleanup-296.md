# GH #296 — Отмена отложенного поиска при размонтировании RemoteSearchSelect

- **Date**: 2026-10-08
- **Branch**: `296-remote-search-select-debounce-cleanup`
- **Status**: Completed (CI-шарды + PR — finishing/architect)
- **Base**: `9659785f` (main)
- **Commits**: `cb1a15f2` (Task 1 — cleanup-эффект) + этот docs-коммит (Task 2 — верификация и артефакты)
- **Issue**: #296 — debounce teardown race (issue заведён 2026-09-17 из IMPL #257)
- **Спека**: `docs/specs/2026-10-07-remote-search-select-debounce-cleanup-296-design.md` rev3 (Gate B — решение юзера 2026-10-08), план `docs/plans/2026-10-08-remote-search-select-debounce-cleanup-296-plan.md` — оба на main, unchanged by IMPL

## Что выполнено

1. **Task 1 (`cb1a15f2`)** — `frontend/admin/app/components/shared/RemoteSearchSelect.tsx`:
   новый `useEffect` с пустым массивом зависимостей рядом с эффектом закрытия по клику
   вне; cleanup при размонтировании делает `clearTimeout(debounceRef.current)` и обнуляет
   ref (прецедент репо — «fired id must not linger» на `ClientsFilters.tsx`). Диф
   байт-в-байт с код-блоком плана (спот-чек архитектора пройден).
2. **Механика закрытого дефекта** — отложенный таймер поиска (дебаунс 300 мс) переживал
   размонтирование виджета (закрытие окна/смена страницы) и срабатывал после: сетевой
   запрос без наблюдателя + обновления состояния размонтированного компонента; класс
   стохастических падений полных прогонов (спека §«User Scenarios» S1/S3) закрыт.
3. **Артефакты**: секция `## [Unreleased] — 2026-10-08` в `CHANGELOG.md`, статус-строка
   в `PLAN.md`, эта запись.

## Behavioral Delta

Закрытие окна отменяет отложенный поиск целиком (ни запроса, ни обновлений состояния);
остальное поведение виджета идентично (S4 спеки). Контракт держится ревью правки —
отдельного регрессионного теста нет (решение юзера на гейте B).

## Верификация (Task 2)

| Проверка | Результат |
| --- | --- |
| Полный локальный vitest admin | **2885 passed / 0 failed** (178 файлов, ~641 s) |
| `pnpm type-check` | exit 0 |
| Тесты | не добавлялись и не правились (решение юзера на гейте B) |
| CI-шарды (vitest + e2e) | гейт PR CI — на finishing |

## Тронутые файлы (`git diff --name-only 9659785f..cb1a15f2`)

```
frontend/admin/app/components/shared/RemoteSearchSelect.tsx
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-08-remote-search-select-debounce-cleanup-296.md` — только meta-доки, код не тронут.

## Scope guards

`handleInputChange`/`search`/пропсы/существующие эффекты не тронуты; спека и план на main
не дублируются; `docs/design-system.md` не редактировался (контракт виджета не менялся);
закрывающее слово `Closes #296` — только в описании PR (канон репо).
