## Описание
<!-- Что меняется и зачем. Ссылка на issue/spec. -->

## User Scenarios (из спеки)
<!-- Какие User Scenarios из спеки затронуты? E2E добавлены/обновлены? -->
- [ ] Scenario X: E2E `path/to/test.spec.ts` added/updated
- [ ] Scenario Y: covered by existing E2E `path/to/test.spec.ts`
- [ ] Если добавил новый feature: добавлен scenario в `docs/specs/2026-06-19-current-user-scenarios.md`

## Manual smoke — автор (обязательно)
- [ ] `pnpm test:all` прошёл локально
- [ ] `cd backend && uv run pytest` прошёл локально
- [ ] Visual regression прошёл (или baseline обновлён **отдельным** commit, см. ниже)
- [ ] Если менял UI: ключевые state'ы проверены в браузере

## Manual smoke — ревьюер (обязательно)
- [ ] Все User Scenarios из спеки покрыты E2E
- [ ] E2E проходят (видно в pre-push логе)
- [ ] Визуальных регрессий нет (или baseline обновлён обоснованно)
- [ ] Acceptance criteria спеки выполнены

## Visual changes
- [ ] UI не менялся
- [ ] UI менялся — diff в скриншотах, baseline обновлён **отдельным** commit с обоснованием
