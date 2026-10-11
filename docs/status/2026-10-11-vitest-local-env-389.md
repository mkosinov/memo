# GH #389 — Локальное vitest-окружение admin: TZ=UTC пин + выключение Node-заглушки webstorage + декларативный пин Node 26 (.nvmrc)

- **Date**: 2026-10-11
- **Branch**: `389-vitest-local-env`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager; US-4 — гейт PR CI)
- **Range**: base `b573542c` — 2 коммита (`fa1562a1..4d76f6a2`), 3 файла, +12/−4
- **Issue**: #389 — детерминизм локального vitest-прогона в admin: пин TZ=UTC в
  vitest-конфиге, отключение экспериментальной Node-заглушки webstorage (конфликт
  с jsdom), декларативный пин Node 26 через `.nvmrc`; поглощает TZ-темы #403 и #460
  (их закрытие — пост-мерж, finishing leg)
- **Спека**: `docs/specs/2026-10-10-vitest-local-env-design.md` рев.3
  (на main, unchanged by IMPL)
- **План**: `docs/plans/2026-10-10-vitest-local-env-plan.md` — 3 задачи
  (T1/T2 — done, T3 — DoD in-phase; пост-мерж-хвост T3 на finishing leg)

## Что выполнено

1. **TZ=UTC пин + флаг webstorage в vitest (T1, `fa1562a1`, trivial)** —
   `frontend/admin/vitest.config.ts`: `process.env.TZ = 'UTC'` до `defineConfig`
   (детерминизм date-зависимых тестов) и `test.execArgv:
   ['--no-experimental-webstorage']` — встроенная экспериментальная заглушка
   localStorage в Node конфликтует с jsdom, отключена в пользу jsdom-хранилища.
2. **Декларативный пин Node 26 (T2, `4d76f6a2`, trivial)** — новый `.nvmrc`
   (`26`); четыре CI-работы тестового workflow (`.github/workflows/test.yml`)
   переведены с `node-version: 22` на `node-version-file: .nvmrc` — единый
   декларативный источник версии.
3. **DoD-верификация (T3, small, in-phase)** — полный `npx vitest run` в
   `frontend/admin` зелёный: **3053 pass / 0 fail, 183 файла, exit 0**;
   до-фиксный RED верифицирован — 6 TZ-чувствительных падений.

## Acceptance criteria (спека US-1..US-4)

- **US-1 (TZ=UTC-пин)** — ✅ локально (полный прогон зелёный; до-фиксный RED —
  6 TZ-чувствительных падений).
- **US-3 (флаг `--no-experimental-webstorage`)** — ✅ локально (local DoD,
  полный сьют зелёный).
- **US-2 (.nvmrc в CI)** — ✅ внесён; верификация самого переключения — гейт
  PR CI.
- **US-4 (CI на Node 26)** — PENDING PR CI (finishing leg; не локальный гейт).
- Визуальный гейт G4.5 — N/A (без UI).

## Верификация

| Проверка | Результат |
| --- | --- |
| Admin vitest, полный прогон | **3053 pass / 0 fail**, 183 файла, exit 0 |
| До-фиксный RED | 6 TZ-чувствительных падений |
| Контейнер | Node 24 до пересборки; пост-условия юзера после пересборки — полный прогон на Node 26 + e2e smoke (не блокеры мержа) |

## Тронутые файлы (`git diff --name-only b573542c..4d76f6a2`)

```
.github/workflows/test.yml
.nvmrc
frontend/admin/vitest.config.ts
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-11-vitest-local-env-389.md` — только meta-доки, код/спеки/планы не тронуты.

## Пост-мерж (finishing leg — этим коммитом НЕ выполнялось)

- Закрыть #403 и #460 с комментарием-обоснованием поглощения их TZ-темы этим
  дизайном (спека §Поглощение дублей).
- Пост-условие-комментарий в #389 после пересборки контейнера пользователем:
  полный прогон на Node 26 + e2e smoke (спека §Риски; не блокер мержа PR).

## Scope guards

Спека (рев.3) и план на main — docser их не касался; прод-код/контракты API/БД
не тронуты; GitHub-issues/PR не трогались; push не выполнялся.

## References

- **GitHub Issue**: #389 (поглощает TZ-темы #403, #460)
- **Design Spec**: `docs/specs/2026-10-10-vitest-local-env-design.md` (рев.3)
- **Plan**: `docs/plans/2026-10-10-vitest-local-env-plan.md` (3 задачи)
- **PR**: _(to be added after PR creation)_
