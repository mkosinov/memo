# GH #375 — Метка `visits` в событийной сетке удалений (каскад клиента + одиночное удаление посетителя)

- **Date**: 2026-10-10
- **Branch**: `375-visits-event-mark`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `9071fd7c` — 3 коммита (`71b1c870..62526072`), 8 файлов, +551/−50
- **Issue**: #375 — два пути удаления стирают посещения, но не называют их в событийном
  пакете: сетки не содержат метки `visits`, открытые экраны «Записи»/карточка клиента
  при одиночном удалении посетителя не обновляются сами
- **Спека**: `docs/specs/2026-10-10-visits-event-mark-design.md` (N/A Visual Compliance —
  backend-only behavior)
- **План**: `docs/plans/2026-10-10-visits-event-mark-375-plan.md` — 3/3 задач, все done
- **Характер**: backend behavior fix — фронт/контракты API/БД/миграции не тронуты
  (карта инвалидаций фронта уже вела `visits` в семейство записей)

## Что выполнено

1. **T1 — снятие подавления метки (backend)** — `71b1c870`:
   - сценарий `delete_client` (фаза 7, пакетное удаление посещений посетителей):
     `mark_visits=False` (паритет #327 §8) снят — execute-пакет
     `{clients, records, photos, visitors, client_tags, visits}`; метка безусловна
     (mark by dispatch fact — ставится и при нуле строк, «чистый» клиент включён);
   - `VisitorService.delete`: сетка `{visitors, visits}` (+ `records`, когда сработал
     пересчёт родителей); докстринг больше не заявляет отсутствия метки; сопутствующие
     тексты подавления (докстринг сценария, инлайн-комментарий фазы 7) обновлены;
   - сам параметр `mark_visits` и его контракт сохранены — подавление снято только в двух
     точках вызова (тест подавления у пакетного метода не тронут, зелёный);
   - domain-rules синхронизированы: `clients.md` (состав execute-пакета), `deletion.md`
     (новый пункт #375 в журнале), `visits.md` (батч-блок: обе сетки, снятие подавления).
2. **T2 — e2e US-1–US-3** — `ea0bc73d` + ревью-фиксы `62526072` (дедуп сетап-хелпера
   US-1/US-2, warmup-бюджет, читаемый nullify-ассерт): новый
   `frontend/admin/e2e/visitor-delete-invalidation.spec.ts` — две страницы, удаление в
   одной, наблюдение самообновления в другой (US-1 таблица «Записи», US-2 карточка
   клиента на вкладке записей, US-3 каскад клиента с резолюциями).
3. **T3 — регрессионный прогон семейства удалений** (run-only): visitors-deferred-delete,
   clients-delete-cascade, visitor-delete-invalidation — зелёные.

## Верификация

| Проверка | Результат |
| --- | --- |
| Backend event-family юниты | **59/59** (сетки: `{clients, records, photos, visitors, client_tags, visits}` / `{visitors, visits}`) |
| Backend usecases+services (шире) | **537p / 0f / 12s** |
| e2e новый спек | **3/3** (US-1 соло 17,5–26 с, стабильно) |
| e2e семейство удалений | зелёное (3 спека, см. T3) |
| Тест подавления `mark_visits=False` | не тронут, зелёный (контракт параметра сохранён) |
| Visual Compliance | N/A (backend-only, спека §Visual Compliance Checks) |

US-1 toast 10s PUSH_WINDOW — load-флейк-класс: 2/2 красных под посторонней нагрузкой
(box load avg 14,9 от параллельной сессии), стабильный зелёный 2/2 соло; инфраструктурные
page-load таймауты на повторе зелёные. Дефектом ветки не является.

## Follow-up кандидаты (НЕ поданы — на решение архитектора)

1. US-1 toast PUSH_WINDOW 10s бюджет vs box load — flake-класс (см. выше).
2. `data-testid` для статистики ClientQuickCard (US-2 сейчас пиннит Tailwind-классы).
3. Канонический e2e-инвок (`BACKEND_URL`/`NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`)
   worth документирования в `docs/tests_workflow.md` (также отмечено #359).

## Тронутые файлы (`git diff --name-only 9071fd7c..HEAD`)

```
backend/src/services/visitor.py
backend/src/usecases/clients.py
backend/tests/test_events_emit.py
backend/tests/usecases/test_clients_delete.py
docs/domain-rules/clients.md
docs/domain-rules/deletion.md
docs/domain-rules/visits.md
frontend/admin/e2e/visitor-delete-invalidation.spec.ts
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-10-visits-event-mark-375.md` —
только meta-доки, код/тесты/спека/план не тронуты.

## References

- **GitHub Issue**: #375
- **Design Spec**: `docs/specs/2026-10-10-visits-event-mark-design.md`
- **Plan**: `docs/plans/2026-10-10-visits-event-mark-375-plan.md` (3/3)
- **PR**: _(to be added after PR creation)_
