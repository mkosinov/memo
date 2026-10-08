# План: очистка debounce-таймера RemoteSearchSelect при размонтировании (#296)

- **Issue:** #296
- **Спека:** `docs/specs/2026-10-07-remote-search-select-debounce-cleanup-296-design.md` (rev3, гейт B пройден 2026-10-08)
- **Дата:** 2026-10-08

## Goal

Реализовать спеку #296 rev3: отложенный таймер поиска в `RemoteSearchSelect` отменяется при размонтировании виджета. Отдельный регрессионный тест НЕ пишется (решение юзера на гейте B); приёмка — ревью правки + зелёный полный прогон.

## Architecture

Точечная правка одного клиентского компонента админки (`frontend/admin/app/components/shared/RemoteSearchSelect.tsx`): новый `useEffect` с пустым массивом зависимостей, чей cleanup сбрасывает `debounceRef` через `clearTimeout` (с обнулением ref). Механика дебаунса, пропсы и все консюмеры не меняются. Слой — только UI-виджет; сервисный слой и слой данных не затронуты.

## Tech Stack

React 18 hooks (`useEffect`, `useRef`), TypeScript; верификация — vitest (jsdom, существующие сьюты), CI-шарды GitHub Actions.

## Task 1 — cleanup-эффект в RemoteSearchSelect

- **Классификация:** trivial
- **Покрывает сценарии:** S1 (ввод оборван закрытием окна), S4 (поведение то же)
- **Required Docs:** спека §«Техническое решение» п.1 (код эффекта дословно), §«Концепт» (прецеденты паттерна)

В `frontend/admin/app/components/shared/RemoteSearchSelect.tsx`, рядом с существующим эффектом закрытия по клику вне (блок `:126-134`), добавить:

```tsx
// Cancel the pending debounced search when the widget unmounts.
useEffect(() => {
  return () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
  };
}, []);
```

Требования:

1. Ровно этот код: пустой массив зависимостей (ref стабилен), сброс `debounceRef` после `clearTimeout` (прецедент репо — комментарий «fired id must not linger» на `ClientsFilters.tsx:20`, сброс в `cancel` — `:26-31`; в спеке цитата строк чуть смещена — `:27-29`, смысл верен).
2. Ничего больше в компоненте не менять: `handleInputChange`, `search`, пропсы `minChars`/`canSearch`/`buildParams`, существующие эффекты — как есть.
3. Тесты не добавлять и не править (решение юзера, гейт B; спека §«Техническое решение» п.2).

## Task 2 — верификация полным прогоном

- **Классификация:** small
- **Покрывает сценарии:** S2 (дебаунс при живом вводе не меняется — существующие тесты), S3 (полный прогон без класса флейка)
- **Required Docs:** спека §«Техническое решение» п.3, §«User Scenarios» S2/S3

1. Полный локальный прогон vitest админки — зелёный (существующие сьюты компонента и консюмеров проходят без правок).
2. CI PR — зелёные все шарды.
3. В PR-описании сослаться на спеку; закрывающее слово `Closes #296` — только в описании PR (канон репо: AGENTS.md, закрывающие слова принадлежат IMPL-PR).
