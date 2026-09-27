# План: мёртвые props — mode в модалках, value/onChange в RemoteSearchSelect (#368)

- Дата: 2026-09-27
- Спека: `docs/specs/2026-09-27-dead-props-368-design.md` (rev2, Gate B пройден) — Behavioral Delta и User Scenarios (US-1…US-6) там, здесь не дублируются.

## Goal

Контракты фронтовых компонентов перестают лгать: `mode` вычеркнут из пяти модалок справочников, `value` вычеркнут из контракта `RemoteSearchSelect`, его `onChange` становится опциональным (пикеры тегов перестают передавать no-op). Поведение пользователя не меняется ни в одном сценарии.

## Architecture

```
RemoteSearchSelect (shared) — честный контракт: без value, onChange?, onSelectItem?
  ↓ вызывают (7 мест рендера, 5 файлов)
PhoneInput · PhotosFilters (2 поисковых + пикер тега) · ServiceModal (пикер) · PhotoModal (пикер + динамические поля)
  ↓ внешний сброс/подмена значения
пересоздание по ключу (resetKey / fieldRemount) — штатный механизм, канон design-system
```

- Пять модалок справочников (`LocationModal`, `PositionModal`, `MaterialModal`, `ServiceModal`, `TagModal`) — `mode` снят; модалки с живым `mode` (`PhotoModal`, `StaffModal`, `ClientCardModal`, `ActivityDetailsModal`) сознательно не трогаются.
- Задача 1 самодостаточна по тип-чеку: контракт и все вызовы снимаются одним шагом (передача несуществующего пропа = ошибка TS — встроенный страж).
- Канон-заметка в `design-system.md` (спека §5.5) уже внесена и запушена коммитом спеки (`d8109a23`) — IMPL design-system.md не правит.
- Backend не меняется.

## Tech Stack

React 18 + TypeScript (Next.js 14 admin), vitest, Playwright (существующие e2e). Новых зависимостей нет.

## Task 1. Селект: `value` из контракта, `onChange` опциональный, все вызовы

Классификация: small. Required Docs: спека §2, §5.2, §5.3.

- `RemoteSearchSelect`: убрать `value` из props-интерфейса и деструктуризации (снять `_value`); `onChange` → `onChange?:`; внутренние вызовы (обработчик выбора, очистка крестиком) — через `onChange?.(...)`.
- Вызовы: `PhoneInput` — снять `value`, `onChange` остаётся; `PhotosFilters` — два поисковых списка снять `value` (их `onChange` живые), пикер тега снять `value` и no-op `onChange` (реакция через `onSelectItem`); `ServiceModal` пикер тега — снять оба; `PhotoModal` — пикер тега снять оба, динамические поисковые поля (клиент/услуга/занятие — в спеке §5.3 названы неточно «локация/занятие») снять `value` (`onChange` остаётся).
- Ключи пересоздания не трогаются: `resetKey` в фильтрах, `fieldRemount` в модалке; отсутствие ключа у пикера тега — зафиксированное поведение спеки §3.
- Сценарии: US-3, US-4, US-5, US-6.
- DoD: type-check зелёный; grep передач в `RemoteSearchSelect` внутри его JSX-блоков в пяти файлах пуст (наивный grep по слову `value` задевает другие компоненты, например `Combobox`); зафиксированное «пустое поле при предзаполненном id» воспроизводится как раньше.

## Task 2. Пять модалок: снять `mode`

Классификация: small. Required Docs: спека §5.1.

- `LocationModal`, `PositionModal`, `MaterialModal`, `ServiceModal`, `TagModal`: убрать `mode` из props-типа, деструктуризации (снять `_mode`) и вызовов.
- Поиск вызовов: `mode="create"`, `mode="edit"`, `mode: 'create'` + развороты `{...props}` в местах рендера этих пяти модалок.
- Исключены сознательно (`mode` живой, не трогать): `PhotoModal`, `StaffModal`, `ClientCardModal`, `ActivityDetailsModal`.
- Сценарии: US-1, US-2.
- DoD: grep пуст по пяти файлам и их вызовам; у четырёх исключённых модалок `mode` на месте; `npm run type-check` зелёный.

## Task 3. Тесты

Классификация: small. Required Docs: спека §5.4.

- Пути от `frontend/admin`: `__tests__/RemoteSearchSelect.test.tsx` (включая `value: null` в `defaultProps` и render-вызовы), `app/components/shared/__tests__/PhoneInput.test.tsx` (в спеке §5.4 путь этого теста неточен — авторитетен этот список), `__tests__/ServiceModal.test.tsx` (`mode="edit"` / `mode="create"` в нескольких describe-блоках), `__tests__/photos/PhotosFilters.test.tsx`, `PhotoModal.test.tsx`.
- Снапшоты, рендерящие `mode`/`value`, — перегенерировать.
- Сценарии: US-1–US-6 (регрессионный каркас).
- DoD: `npm test` зелёный.

## Task 4. Сквозная верификация + артефакты

Классификация: small. Required Docs: спека §5.5 (выполнено коммитом спеки), §5.6, §7.

- Per-component проверка шести компонентов (5 модалок + селект): props-тип не объявляет поле **и** тело не читает его (grep `mode`/`value` по файлу) — линт этого класса лжи не ловит, шаг обязателен.
- `npm run lint` — 0 предупреждений, `_mode` / `_value` отсутствуют.
- Существующие e2e зелёные (модалки справочников, фото).
- Ручной прогон сценариев US-1–US-6 (каждый — «как раньше», включая пустое поле при предзаполненном id из спеки §2).
- `CHANGELOG.md`: новый препенденный датированный блок `## [Unreleased] — 2026-09-27` (домашняя конвенция Keep a Changelog).
- `docs/status/2026-09-27-dead-props-368.md`: что выполнено, команды, тронутые файлы.
- Сценарии: US-1–US-6.
- DoD: всё перечисленное выполнено и зафиксировано; PR в main.

## DoD общий

Все задачи в main; статус-запись и CHANGELOG отражают фактический срез; карточка #368 → In-main после мержа.
