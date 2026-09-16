# Единая модель посетителей: аноним как визит (#257) — план IMPL

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удалить dual-модель «счётчик `anonym_visits` + строки визитов»: каждое место записи = визит, аноним = визит с `visitor_id = NULL` (тариф/цена/статус настоящие), поле/колонка `anonym_visits` удаляются целиком (чистый разрыв, без слоя совместимости).

**Architecture:** Backend — первая дата-миграция проекта (разворачивание счётчика в визиты с наследованием статуса записи → пересчёт seats → drop column), затем удаление поля из модели/схем/сервисов; «guests»-сортировка становится коррелированным подзапросом по визитам. Frontend — степпер шапки создаёт/удаляет анонимные визиты через `POST/DELETE /visits`, конвертация анонима = `createVisitor` + точечный `PATCH /visits/{id} {visitor_id}`, все счётчики в UI — производные от `record.visits`.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest (backend); React + TanStack Query + zod (`packages/api-client`) + Vitest + Playwright (frontend admin). Домен статусов — канон `backend/src/domain/visit_status.py` (#134, уже смержен — порядок D10 выполнен, отдельного гейта нет).

Спека: `docs/specs/2026-09-16-anonymous-visits-unified-design.md`.

---

## Behavioral Delta

Как behaves для юзера (по критериям спеки):

- **Баг #257 (пустое состояние)** → «Нет посетителей» появляется только при истинном нуле мест (`visits=[]`). Запись со счётчиком «3 анонимных» теперь показывает 3 строки «Аноним» с настоящими полями.
- **US1/US2 (бронирование)** → В форме бронирования N «мест» + именованные строки: заполненные строки сохраняются именованными визитами, незаполненный хвост — анонимными визитами с тарифом по умолчанию (первый тариф услуги).
- **US3 (конвертация)** → В строке «Аноним» вписываешь имя (+возраст) → визит становится именованным одним действием, даже когда занятие заполнено до предела; места и «к оплате» не меняются, 409 не возникает. При ошибке строка возвращается в «Аноним».
- **US4 (деньги)** → Тариф/цена анонимной строки редактируются как у именованной; «Стоимость» и «к оплате» начинают включать цены анонимов (намеренное изменение).
- **US5 (удаление)** → Удаление строки «Аноним» освобождает место; seats и шапка пересчитываются.
- **US6 (статус)** → Анонимной строке можно поставить «пришёл» — запись честно станет «Пришли»; смена статуса записи через пикер в шапке гасит ВСЕ её визиты, включая анонимные (каскад).
- **Степпер шапки** → +1/−1 = создание/удаление одного анонимного визита (поштучно), с дефолтным тарифом услуги и ценой из тарифа — та же логика, что в форме бронирования; +1 на полном занятии — штатный 409-тост.
- **US7 (миграция)** → У записи со счётчиком `anonym_visits = N` после миграции N анонимных визитов со статусом, унаследованным от записи; статус и занятость мест не меняются.
- **API (breaking)** → Поле `anonym_visits` исчезает из RecordCreate/Update/Patch/Response; клиенты считают места из `visits`.

## Уточнения якорей спеки (факты ревизии 16.09, читать вместе со спекой)

- Сборщик ответа — `map_record` (`backend/src/services/record.py:67-107`), поле на **:101** (спека называла `_to_response`/:100).
- «guests»-сортировка — **:352** (спека: :351), SQL-выражение в ORDER BY.
- Хелперы пересчёта живут в **`backend/src/domain/record_visits.py`** (спека писала `services/`): `recompute_record_seats` :25-46 (счётчик на :43), `recompute_record_status` :49-73, `check_activity_capacity` :90-120.
- «Отмена записи» как отдельного бэкенд-действия не существует: статус записи всегда derived; единственный record-level путь смены статуса — coarse-обработчик `ClientTab.handleStatusChange` (`frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx:170-187`): PUT записи массивом всех визитов с новым статусом. После унификации он автоматически накрывает анонимные визиты (они в `record.visits`) — каскад D4 падает бесплатно; adjacent-фикс: карта в coarse-обработчике теряет `tariff_id/custom_price` — дополнить (см. Task 8).
- #134 (дедуп VisitStatus) уже в main (`69b8c93`) — канон `src/domain/visit_status.py`; отдельного гейта порядка нет.

---

## Task 1: Инвентарь потребителей + чистка артефакта БД
### Classification: small
### Required Docs
- `docs/specs/2026-09-16-anonymous-visits-unified-design.md` — раздел D2 (чек-лист потребителей) и «Хвосты».

### Task Description
Регенерировать строгий инвентарь потребителей поля и удалить осиротевший артефакт (юзер-решение G1b).

### Steps
- [ ] Прогнать `grep -rn "anonym_visits\|anonymVisits" backend/ frontend/ packages/` и сверить список с D2 спеки (ожидание: `models/record.py:25`; `schemas/record.py:54,74,87,98`; `services/record.py:101,352,466,501,605,623,675-679,693-699`; `domain/record_visits.py:28,43`; alembic `3c3317f0c759`; api-client `schemas.ts:391,500`, `endpoints.ts:585`; ~21 frontend-файл из инвентаря скаута в Task 9; ~7 backend-тестов + conftest). Расхождения записать в IMPL-лог issue и двигаться по факту.
- [ ] Проверить `.gitignore` репо содержит `*.db` (артефакт не должен попадать в git). Если нет — добавить строку `*.db` в Task 3 коммит.
- [ ] **Чистка артефакта (контейнер-side):** удалить `~/dev/opencode/workspace/memo/memo.db` (пустая БД старой схемы, вне git, вне сид-конвейера). Guard перед удалением: `grep -rn "memo.db" ~/dev/opencode/workspace/memo --include="*.json" --include="*.jsonc" --include="*.env*" --include="*.sh" 2>/dev/null` — если какая-то живая конфигурация/скрипт ссылается на файл — НЕ удалять, записать находку в IMPL-лог и спросить юзера. Schema старая, данных 0, alembic её не поднимал.
- [ ] Commit: `chore(#257): grep-инвентарь потребителей anonym_visits + чистка артефакта workspace-БД` (без Closes — закроется PR'ом IMPL).

### DoD
- Grep-инвентарь сверен со спекой, расхождения зафиксированы в IMPL-логе.
- Артефакт удалён (или блокер задокументирован), `.gitignore` проверен.

---

## Task 2: Backend — удаление счётчика + дата-миграция
### Classification: large
### Required Docs
- `docs/domain-rules/records.md` — формула seats (:116), устаревшие capacity-строки (:118-128) — правки лягут в Task 3, но при правке кода сверяться с правилами.
- `docs/domain-rules/visits.md`, `docs/domain-rules/visitors.md` — lifecycle визита/посетителя.
- Спека D1–D5, D10.
- `backend/src/domain/visit_status.py` — канон статуса после #134 (правило не меняется, состав входа — все визиты).

### Task Description
Единый атомарный backend-коммит: миграция (разворачивание счётчика в анонимные визиты с наследованием статуса → пересчёт seats → drop column) + удаление поля из модели/схем/сервисов. Атомарно, потому что ORM-модель без колонки и колонка в БД (или наоборот) ломают `_to_response`/selects сразу после любого промежуточного коммита — чистый разрыв здесь = один коммит.

### Steps

**Миграция (сначала schema-change, чтобы conftest-апгрейд шёл от новой головы):**

- [ ] `cd backend && uv run alembic revision -m "expand anonym_visits into anonymous visits and drop column"` — revision на голове `b8c9d0e1f2a3`.
- [ ] Написать upgrade (строгий порядок D5: визиты → seats → drop):
```python
def upgrade():
    conn = op.get_bind()
    records = conn.execute(sa.text(
        "SELECT id, status, anonym_visits FROM records WHERE anonym_visits > 0"
    )).fetchall()
    now = datetime.utcnow()
    rows = [
        {"id": str(uuid.uuid4()), "record_id": rid, "visitor_id": None,
         "tariff_id": None, "price": 0, "custom_price": None,
         "status": status,              # наследование статуса записи (D5) — не waiting!
         "created_at": now, "updated_at": now}
        for rid, status, counter in records
        for _ in range(counter)
    ]
    if rows:
        visits_t = sa.Table("visits", sa.MetaData(),
            sa.Column("id", sa.String(36)), sa.Column("record_id", sa.String(36)),
            sa.Column("visitor_id", sa.String(36)), sa.Column("tariff_id", sa.String(36)),
            sa.Column("price", sa.Integer), sa.Column("custom_price", sa.Integer),
            sa.Column("status", sa.String(20)), sa.Column("created_at", sa.DateTime),
            sa.Column("updated_at", sa.DateTime))
        conn.execute(visits_t.insert(), rows)
    conn.execute(sa.text(
        "UPDATE records SET seats = (SELECT COUNT(*) FROM visits WHERE visits.record_id = records.id)"
    ))
    with op.batch_alter_table("records") as batch:
        batch.drop_column("anonym_visits")
```
- [ ] Downgrade — колонка возвращается пустой (данные не восстанавливаются; осознанно, тестовые базы): `batch.add_column(sa.Column("anonym_visits", sa.Integer(), nullable=False, server_default="0"))`.
- [ ] Сверка скелета INSERT с фактической схемой (проверено ревизией 16.09, подтвердить при правке): `backend/src/models/visit.py` — `visitor_id/tariff_id/custom_price` nullable, `record_id/price/status` NOT NULL (price шлём 0, status наследуем); состав колонок visits = модель + `id/created_at/updated_at` из AbstractModel.
- [ ] Unit-тест наследования статуса (US7) — `backend/tests/test_migration_anonym_unfold.py`: функция `_expand_anonym_visits(conn)` вынесена из upgrade в module-level и вызывается оттуда; тест строит in-memory sqlite со старой схемой рукописным DDL (`records(id, status, seats, anonym_visits, ...)`, `visits(id, record_id, visitor_id, tariff_id, price, custom_price, status, created_at, updated_at)`, FK-прагма не нужна — sqlite по умолчанию FK off), вставляет запись `status='visited', anonym_visits=2` + именованный визит `status='visited'`, вызывает `_expand_anonym_visits(conn)` и asserts: 2 новых визита `visitor_id IS NULL`, `price=0`, `status='visited'`, `seats` записи = 3, id уникальны. Отдельный кейс: `status='cancelled'` → визиты не «воскрешают» запись (наследование, не waiting).
- [ ] Прогнать: `uv run --extra dev pytest tests/test_migration_anonym_unfold.py -x` — зелёный. (Session-апгрейд conftest'а на пустой базе — штатный smoke миграции.)

**Удаление поля (радиус compile-errors, гасим весь в этом же коммите):**

- [ ] `backend/src/models/record.py:25` — удалить колонку `anonym_visits`.
- [ ] `backend/src/schemas/record.py` — удалить поле из 4 схем: RecordBase :54, RecordCreate :74, RecordUpdate :87, RecordPatch :98; поправить комментарий `# seats = len(visits) + anonym_visits` (:77) → `# seats = len(visits)`.
- [ ] `backend/src/services/record.py`:
  - `map_record` :101 — удалить строку `anonym_visits=record.anonym_visits`.
  - «guests» :352 — заменить SQL-выражение (после drop колонки оно падает при построении запроса):
```python
named_visits_count = (
    select(func.count()).select_from(Visit)
    .where(Visit.record_id == Record.id, Visit.visitor_id.is_not(None))
    .correlate(Record).scalar_subquery()
)
"guests": [Record.seats - named_visits_count],
```
  (решение: подзапрос, не питонья сортировка — список пагинирован, сортировка обязана жить в SQL; масштаб админки делает коррелированный count дешёвым).
  - create :466-467 — `effective_seats = len(data.visits)`; :501 — убрать `anonym_visits=...` из конструктора `Record(...)`.
  - update :605 — удалить `record.anonym_visits = ...`; :623 — `effective_seats = len(data.visits)`.
  - patch :675-676 — удалить потребление поля; :679 — guard `seats_changed = "visits" in update_data`; :693-699 — `effective_seats = len(update_data["visits"]) if "visits" in update_data else len(record.visits)`.
- [ ] `backend/src/domain/record_visits.py:43` — `record.seats = visit_count` (член `+ record.anonym_visits` исчезает).
- [ ] `backend/tests/conftest.py:604,646-649` — fixture `sample_record`: убрать `UPDATE records SET anonym_visits = 1`, вместо этого вставить один визит `visitor_id = NULL, price = 0, status = 'waiting'` raw-SQL'ом (семантика «2 именованных + 1 аноним» сохраняется); поправить docstring.
- [ ] Обновить существующие тесты (инвентарь Task 1): `test_record_visits.py:30,34` (seats == len(visits)); `test_api_records.py` класс #82 :458-543 (payload'ы счётчика → элементы visits без visitor_id), :830-878 фикстуры, :882-889 guests-sort guard — переписать на анонимные ВИЗИТЫ с тем же направлением сортировки, что в исходном ассерте (asc: меньше именованных — выше): A = 2 именованных + 3 анонимных (live=2) раньше B = 4 именованных (live=4); направление перепроверить по исходному тесту при правке; `test_record_seats_dedup.py` (везде `anonym_visits: 1` → анонимный элемент); `test_api_records_view.py:174,569` (фикстуры «anonym_visits=3/2» → 3/2 анонимных визита); `test_edge_cases.py:423-510` (capacity-payload'ы → анонимные визиты).
- [ ] Новые тесты (US6-участие + D4-каскад + D3-инвариант) — `backend/tests/test_anonymous_visits.py`:
  - участie в статусе: запись [именованный missed, аноним waiting] → waiting; анониму `PATCH /visits/{id} {status: 'visited'}` → запись VISITED;
  - каскад отмены (D4): PUT записи массивом «все визиты cancelled» (включая анонимный элемент) → все визиты cancelled, запись CANCELLED, место освобождено (на том же занятии создаётся новая запись без 409);
  - инвариант (D3): после create → PUT → PATCH → `POST /visits` → `DELETE /visits` всегда `record.seats == len(record.visits)` (цикл по точкам мутации);
  - конвертация (D7-бэкенд): `PATCH /visits/{id} {visitor_id}` на полном занятии → 200, seats не изменился, «guests»-сортировка видит визит как именованный.
- [ ] Полный backend-прогон: `uv run --extra dev pytest -x -q`.
- [ ] Commit: `refactor(#257): единая модель посетителей — счётчик anonym_visits развёрнут в визиты, поле удалено (backend + миграция)` (без Closes).

### DoD
- Unit-тест разворачивания проходит (наследование статуса — US7; E2E на сид-копии не нужен — базы пусты, решение спеки).
- `pytest -x -q` зелёный; grep `anonym` по `backend/src` возвращает только упоминания в новой alembic-версии (drop/insert) и слово «anonymous» в auth/deletion.
- E2E-заготовки US6 приходятся бэкенд-тестами; e2e-сценарии — Task 10.

---

## Task 3: Domain-rules records.md — каскад, seats, устаревший текст
### Classification: small
### Required Docs
- `docs/domain-rules/records.md` — сам правится; `docs/domain-rules/_overview.md` — конвенции.

### Steps
- [ ] `docs/domain-rules/records.md`:
  - :116 — формула «Seats = len(visits) + anonym_visits» → «Seats = len(visits): всегда пересчитывается `recompute_record_seats()`; меняется ТОЛЬКО через точки пересчёта (create/update/patch записи, `VisitService.create/delete`), никогда напрямую»;
  - :118-128 — убрать устаревшие «NO capacity re-check» (код перепроверку делает: PUT `services/record.py` после замены визитов, PATCH при замене визитов — переформулировать как «Update (PUT): полная замена визитов, seats пересчитан, capacity перепроверяется (409 при переполнении)»; то же для Patch);
  - секция про статус записи (…:70-80) — дописать: «отмена записи (смена статуса пикером на record-level) — это работа на уровне визитов: coarse-обработчик выставляет статус всем визитам записи, включая анонимные; статус записи никогда не ставится независимо (каскад, D4)»;
  - вырезать все упоминания `anonym_visits` (слоты счётчика) — заменить на «анонимный визит = визит с `visitor_id = NULL`, у него настоящие тариф/цена/статус».
- [ ] Сверка с `_overview.md`-конвенциями naming (аноним = «визит без посетителя»).
- [ ] Commit: `docs(#257): domain-rules records.md — seats = len(visits), каскад отмены, capacity re-check актуализирован` (без Closes).

### DoD
- В `records.md` нет ни одного упоминания счётчика; правило каскада и инвариант seats записаны.

---

## Task 4: packages/api-client — удаление поля
### Classification: small
### Required Docs
- Спека D2/D10; `packages/api-client/src/schemas.ts` (контекст).

### Steps
- [ ] `packages/api-client/src/schemas.ts:391` — удалить `anonym_visits: z.number()` из RecordResponseSchema.
- [ ] `:500` — удалить `anonym_visits: ...` из RecordCreateSchema.
- [ ] `packages/api-client/src/endpoints.ts:585` — убрать `'anonym_visits'` из Pick в типе `patchRecord`.
- [ ] `packages/api-client/src/schemas.test.ts:949,1008` — убрать поле из фикстур.
- [ ] Компиляция пакета: `pnpm --filter @memo/api-client exec tsc --noEmit` (пакет должен собраться; ошибки frontend-потребителей допустимы ДО Task 5-8 и гасятся там — это и есть compile-error радиус; сам пакет не импортирует проблемные файлы). Если tsc тянет admin — использовать `pnpm --filter @memo/api-client build` и смотреть только ошибки пакета.
- [ ] Commit: `refactor(#257): api-client — поле anonym_visits удалено из схем/типов (breaking)` (без Closes).

### DoD
- Пакет собирается; `anonym_visits` в `packages/` отсутствует.

---

## Task 5: useRecordMutations — создание хвостом анонимов + хук степпера
### Classification: standard
### Required Docs
- `docs/domain-rules/records.md` (формулы), `docs/domain-rules/visitors.md` (createVisitor), спека D6/D7/D10, US1/US2.

### Task Description
Путь создания записи шлёт незаполненные места анонимными элементами массива `visits`; добавляются мутации степпера и конвертации; `updateAnonymVisits` удаляется.

### Steps
- [ ] `frontend/admin/hooks/useRecordMutations.ts:168-183` — в `createRecord`: убрать `anonym_visits: input.seats`; хвост добавить к `visits` (тариф по умолчанию = первый тариф услуги — семантика US1):
```ts
const firstTariff = serviceTariffs[0];
await createRecord({
  activity_id: activityId,
  client_id: clientId,
  visits: [
    ...visitData.map((vd) => {
      const tariff = vd.tariffId ? serviceTariffs.find((t) => t.id === vd.tariffId) : firstTariff;
      return { visitor_id: vd.visitorId, tariff_id: vd.tariffId || undefined, price: tariff?.price ?? 0 };
    }),
    ...Array.from({ length: input.seats }, () => ({
      // незаполненный хвост — анонимные визиты: visitor_id отсутствует,
      // тариф/цена дефолтные (US1); бэкенд резолвит отсутствие как anonymous
      tariff_id: firstTariff?.id || undefined,
      price: firstTariff?.price ?? 0,
    })),
  ],
});
```
- [ ] Новый хук `addAnonymousVisit` (степпер +1; capacity-проверка — штатная внутри `VisitService.create` бэкенда). **Reuse, не новый паттерн:** дефолт тарифа/цены — та же логика, что у черновой строки «+ Добавить» (`makeEmptyVisitRow`, `RecordVisitsTable.tsx:77-87`: `tariff_id = tariffs[0].id`, `price = tariffs[0].price`, waiting) и у формы бронирования (`serviceTariffs[0]`) — три места, один дефолт «первый тариф услуги»; форма хука зеркалит существующий `addVisit` (:347-374, двухшаговый createVisitor→createVisit с `upsertVisit` + invalidate `['visitors']`), минус шаг createVisitor:
```ts
const addAnonymousVisit = useCallback(async (defaultTariff?: Tariff) => {
  const visit = await apiCreateVisit({
    record_id: recordId,
    visitor_id: null,
    tariff_id: defaultTariff?.id || undefined,
    price: defaultTariff?.price ?? 0,
  });
  upsertVisit(queryClient, recordId, visit);
  invalidateRecordAndLists();
}, [recordId, queryClient]);
```
- [ ] Степпер −1 = существующий `deleteVisit(visitId)` (оптимистичный, БЕЗ undo-тоста — поштучное удаление из шапки; deferred-вариант с 5-секундным окном остаётся у строк таблицы) — новые мутации не нужны, родитель передаёт id последнего анонимного визита.
- [ ] Новый хук `convertAnonymousVisit` (D7: один точечный вызов PATCH, без пересоздания массива — 409 невозможен даже на полном занятии). **Reuse:** форма = существующий `addVisitorToRecord` (:299-328 — `fetchQuery` записи, guard client_id с тем же текстом ошибки, `createVisitor`), отличается только финалом — `patchVisit` вместо `patchRecord` (пересоздание массива запрещено D7); инвалидация `['visitors']` — паттерн `addVisit`:
```ts
const convertAnonymousVisit = useCallback(async (visitId: string, name: string, age: number | null) => {
  const record = await queryClient.fetchQuery({
    queryKey: qk.record(recordId),
    queryFn: () => import('@memo/api-client').then((m) => m.getRecord(recordId)),
  });
  const clientId = record.client_id;
  if (!clientId) throw new Error('Record has no client'); // тот же guard, что addVisitorToRecord
  const visitor = await createVisitor({ client_id: clientId, name, age: age ?? undefined });
  try {
    return await patchVisit(visitId, { visitor_id: visitor.id });
  } catch (e) {
    await apiDeleteVisitor(visitor.id); // откат: не оставлять сироту-visitor
    queryClient.invalidateQueries({ queryKey: qk.visitors(clientId) });
    throw e;
  }
}, [recordId, queryClient, patchVisit]);
```
(возраст: `age ?? undefined` — null возраста = «взрослый» по `docs/domain-rules/visitors.md:11`, дефолт совпадает с черновиками; допущение отката проверено: между `createVisitor` и PATCH связь visitor↔visit создаёт только этот PATCH — зависимых визитов у сироты нет, удаление безопасно).
(`patchVisit` :372-381 уже делает `upsertVisit`; добавит недостающее — инвалидацию `['visitors']` внутри convert, т.к. список посетителей клиента меняется.)
- [ ] Удалить `updateAnonymVisits` (:328-335) и его экспорт (:485-502).
- [ ] Unit-тесты новых мутаций (по образцу существующих тестов хука): create отправляет хвост анонимов и не шлёт `anonym_visits`; convert при ошибке PATCH удаляет созданного visitor.
- [ ] Прогон: `pnpm --filter admin test -- --run` (vitest).
- [ ] Commit: `feat(#257): create-путь шлёт анонимный хвост визитами; мутации степпера и конвертации` (без Closes).

### DoD
- `anonym_visits` не уходит на бэкенд ни из одного фронта; степпер и конвертация имеют хуки с тестами.

---

## Task 6: RecordHeader — степпер создаёт/удаляет анонимный визит
### Classification: standard
### Required Docs
- `docs/design-system.md` (поля/кнопки), спека D6/D9.

### Steps
- [ ] `frontend/admin/app/components/shared/records/RecordHeader.tsx` — заменить счётчик-инпут:
  - props: убрать `onAnonymVisitsChange?: (value: number) => void`; добавить `onAddAnonymousVisit?: () => Promise<void>; onDeleteAnonymousVisit?: () => Promise<void>;`
  - состояние и debounce (:16-24) удалить; производный счётчик: `const anonymousCount = visits.filter((v) => v.visitor_id == null).length;` (визиты карточки уже загружены — отдельных запросов нет);
  - `totalSeats = visits.length` (:26);
  - UI: отображение «{anonymousCount} анонимных» + кнопки `+`/`−` (testid `anonym-visits-inc` / `anonym-visits-dec`, `−` disabled при 0), вся зона под `!isReadOnly` (как прежний инпут). При `onAddAnonymousVisit` — короткое `pending`-состояние кнопки (повторный клик до ответа игнорируется).
- [ ] Обновить единственного потребителя `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx:215`:
```tsx
const lastAnonymousVisit = useMemo(
  () => [...(record?.visits ?? [])].reverse().find((v) => v.visitor_id == null),
  [record?.visits],
);
<RecordHeader
  data={headerData}
  onAddAnonymousVisit={() => addAnonymousVisit(tariffs[0])}
  onDeleteAnonymousVisit={lastAnonymousVisit ? () => deleteVisit(lastAnonymousVisit.id) : undefined}
/>
```
(`tariffs` из `useRecordData` — тарифы услуги записи, `useRecordData.ts:55-59`; `tariffs[0]` — тот же дефолт, что в `makeEmptyVisitRow` черновой строки; при пустом списке тарифов услуги `addAnonymousVisit(undefined)` даёт цену 0).
- [ ] `RecordHeader.test.tsx` — переписать debounce-тест (:81) на степпер: клик `anonym-visits-inc` вызывает `onAddAnonymousVisit`; `dec` disabled при `visits=[]`; фикстура :36 без поля.
- [ ] Прогон vitest + `pnpm --filter admin exec tsc --noEmit`.
- [ ] Commit: `feat(#257): степпер шапки создаёт/удаляет анонимные визиты (RecordHeader)` (без Closes).

### DoD
- Степпер поштучно добавляет/удаляет реальные визиты; счётчик — производный; тесты зелёные.

---

## Task 7: RecordVisitsTable — снятие пропов счётчика + конвертация анонима
### Classification: standard
### Required Docs
- `docs/design-system.md` (InlineEditCell/InlineEditRow), `docs/domain-rules/visitors.md`, спека D7/D9, US3.

### Steps
- [ ] Props (:113-132): убрать `anonymVisits: number` и `onAnonymVisitsChange`; добавить `onConvertAnonymousVisit: (visitId: string, name: string, age: number | null) => Promise<void>;`
- [ ] Удалить мёртвое состояние `anonymInput`/`handleAnonymChange` (:235-241 — объявлено, но нигде не рендерится).
- [ ] Ячейки имени и возраста сохранённой анонимной строки (`renderCell`, :353-373 имя, :385-399 возраст): обе редактируемы — анонимная строка повторяет все 6 элементов именованной (имя, возраст, тариф, цена, статус, удаление). Порядок веток в каждом `onCommit` строгий: (1) черновик (`isNew`) — как сейчас; (2) сохранённая строка `r.id && r.visitor_id == null` → конвертация; (3) `r.visitor_id` truthy → существующий `onChangeVisitor`.
  - Коммит имени: `onConvertAnonymousVisit(r.id, value, formState.age ?? null)`.
  - Коммит возраста: если `formState.name` пуст — тост «Введите имя посетителя», строка остаётся анонимной (visitor без имени невозможен); иначе `onConvertAnonymousVisit(r.id, formState.name, age)`.
  - Read-only — как сейчас: курсив «Аноним», возраст-плейсхолдер по текущей логике. `AgeSelect` (:135-165) работает на анонимной строке без правок; если возраст не тронули, visitor создаётся с `age = null` = «Взрослый» (`docs/domain-rules/visitors.md:11`, тот же дефолт, что у черновиков `makeEmptyVisitRow`). Плейсхолдер «Аноним» (D9) — уже работают, не трогать.
- [ ] Пустое состояние (:479-483) не трогать — после снятия счётчика «Нет посетителей» возникает только при истинном нуле (баг #257 исчезает структурно).
- [ ] Потребители:
  - `ClientTab.tsx:264` — убрать `anonymVisits={...}`; передать `onConvertAnonymousVisit={handleConvert}` (обёртка хука с try/catch → тост `showToast(parseApiError(err).message, 'error')`; при ошибке строка остаётся анонимной — кэш не тронут, т.к. `upsertVisit` только после успешного PATCH);
  - `ClientRecordTab.tsx:273` — то же; `:281` убрать `onAnonymVisitsChange`.
- [ ] `RecordVisitsTable.test.tsx` — render-хелперы (:111,140) без снятых пропов; существующий тест «saves anonymous visit (blank name) on Enter» (:157) остаётся; новые: конвертация сохранённой анонимной строки вызывает `onConvertAnonymousVisit` с именем и возрастом из строки; коммит возраста при пустом имени → тост, строка остаётся анонимной; reject колбэка → строка возвращается к «Аноним».
- [ ] Прогон vitest.
- [ ] Commit: `feat(#257): конвертация анонимной строки в именованную одним PATCH (RecordVisitsTable)` (без Closes).

### DoD
- Таблица рендерит анонимные строки из `visits`, конвертация работает на полном занятии (unit-покрытие; e2e — Task 10).

---

## Task 8: Разводка карточки — derived-места, coarse-статус, деньги
### Classification: standard
### Required Docs
- `docs/domain-rules/records.md` (новая запись про каскад), спека D3/D4/D8/D9.

### Steps
- [ ] `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx:160` — `const totalSeats = record.visits.length;` (лейбл таба «x{totalSeats}»).
- [ ] `ClientTab.tsx`:
  - удалить `handleAnonymChange` (:190-197) и передачу `onAnonymVisitsChange` (:272);
  - `:251` — `seats={visits.length}` на RecordSummary (канон — `record.seats` равен ему после пересчёта; берем len от загруженных визитов, как сегодня, но без слагаемого);
  - `:264` — убрано в Task 7;
  - **coarse-статус (каскад D4)**: `handleStatusChange` (:170-187) сегодня маппит `record.visits` → после унификации анонимные визиты в массиве и гасятся автоматически; adjacent-фикс — карта должна сохранять деньги (иначе record-level смена статуса стирает тарифы, обнуляя D8):
```ts
const updatedVisits = visits.map((v) => ({
  visitor_id: v.visitor_id,
  tariff_id: v.tariff_id,        // + было потеряно
  price: v.price,
  custom_price: v.custom_price,  // + было потеряно
  status: newStatus,
}));
```
- [ ] `ClientRecordTab.tsx` — удалить `handleAnonymChange` (:182-184) и её передачи (:215 обновлено в Task 6, :273/:281 в Task 7); добавить `onConvertAnonymousVisit`-обёртку с тостом.
- [ ] Деньги (D8) — проверка без правок: `ClientTab.tsx:222` `totalCost = visits.reduce(...)` и «к оплате» автоматически включают цены анонимов, как только они стали визитами; цены мигрированных анонимов = 0 (миграция), пользователь может задать тариф/цену инлайн (Task 7). Комментарий у `RecordSummary` prop `seats` (:9) поправить: «Total seats (all visits)».
- [ ] `ClientTab.integration.test.tsx:311-320` — тест «seats display reads anonym_visits from canonical record» переписать: seats = `visits.length` из канонической записи (name/test обновить).
- [ ] Прогон vitest + tsc.
- [ ] Commit: `feat(#257): derived-места и каскад coarse-статуса в карточке записи` (без Closes).

### DoD
- Ни один production-файл admin не читает `anonym_visits`; coarse-статус гасит анонимов и сохраняет тарифы; unit-тесты зелёные.

---

## Task 9: Frontend unit-тесты — свип фикстур и поведенческие перезаписи
### Classification: standard
### Required Docs
- Спека «План тестов»; инвентарь Task 1.

### Steps
- [ ] Свип фикстур (поле `anonym_visits: 0` вырезать, без изменения логики тестов): `__tests__/helpers/mockData.ts:155`, `__tests__/helpers/clientRecordTabSetup.ts:20`, `RecordsContext.test.tsx:81`, `ActivityDetailsModal.test.tsx:511`, `useReactQueryHooks.test.tsx:182`, `RecordsTable.test.tsx:24`, `useDeleteRecord.test.ts:50`, `ClientQuickCard.test.tsx:116`, `ClientsIntegration.test.tsx:137`, `recordsColumns.test.tsx:26`, `recordsTimeParity.test.ts:81`, `recordCacheSync.test.ts:77`.
- [ ] Поведенческие перезаписи:
  - `ClientRecordTab.interactions.test.tsx:146` — тест «Нет посетителей» остаётся валидным при `visits: []` (истинный ноль), добавить зеркальный кейс: `visits: [анонимный визит]` → строка «Аноним» видима, «Нет посетителей» НЕ показан (регресс #257);
  - `ClientTab.integration.test.tsx` — см. Task 8.
- [ ] Полный прогон: `pnpm --filter admin test -- --run` и `pnpm --filter admin exec tsc --noEmit`.
- [ ] Commit: `test(#257): свип фикстур anonym_visits; перезаписи пустого состояния и seats` (без Closes).

### DoD
- `grep -rn "anonymVisits\|anonym_visits" frontend/admin/app frontend/admin/hooks frontend/admin/__tests__` пуст (остаётся только e2e-слово «Аноним»); vitest + tsc зелёные.

---

## Task 10: E2E — anonymous-visits.spec.ts (US1–US6) + волна 6
### Classification: large
### Required Docs
- `docs/tests_workflow.md` (запуск/сид/RESET_SQL), спека `## User Scenarios`; паттерны — существующие спеки `unified-rows.spec.ts` (сценарий 11 :453-505), `wave6-record-status-derived.spec.ts`.

### Task Description
Новая спека `frontend/admin/e2e/anonymous-visits.spec.ts` + переписать scenario 3 в wave6. Сценарий 11 `unified-rows.spec.ts` остаётся зелёным без правок (механизм черновиков не меняется) — только прогон.

### Steps
- [ ] **RED**: написать кейсы, запустить `pnpm --filter admin test:e2e -- anonymous-visits` — убедиться в ожидаемых падениях (конвертации/степпера нет).
- [ ] С Cases (каждый — отдельный `test()`; сид через существующие request-хелперы, `visits`-элементы без `visitor_id` = анонимы):
  - **US1/US2 (бронирование)**: через `NewBookingTab` создать запись: 1 именованный посетитель + «Количество мест» = 2 → в карточке 3 строки, хвост — 2 строки «Аноним» с тарифом по умолчанию; шапка показывает места = 3.
  - **US3 (конвертация на полном занятии)**: активность capacity=1, запись с 1 анонимным визитом; вписать имя и возраст в строке «Аноним» → строка становится именованной, «Мест» не меняется, 409 не возникает.
  - **US4 (деньги)**: у строки «Аноним» сменить тариф/цену → «Стоимость» и «к оплате» в RecordSummary пересчитались.
  - **US5 (удаление)**: удалить строку «Аноним» → строка исчезает оптимистично и «Мест» уменьшился; **учёт undo-окна** (`deleteVisitDeferred`, 5с): (а) в течение тоста клик «Отменить» → строка вернулась; (б) без отмены — дождаться авто-коммита (тост исчез, таймаут >5с, паттерн #261 с хелпером задержки), перезагрузить данные → строка по-прежнему удалена, на освободившееся место запись создаётся.
  - **US6 (статус/каскад)**: анониму «пришёл» → запись «Пришли»; сменой статуса записи (RecordSummary пикер) на «Отменили» — все строки гасятся, запись CANCELLED, место освобождено.
- [ ] `wave6-record-status-derived.spec.ts:89-113` — scenario 3 переписать: клик `anonym-visits-inc` → счётчик в шапке +1 и в таблице появилась строка «Аноним»; `anonym-visits-dec` → исчезла (замена теста-заглушки «may not be visible»).
- [ ] Прогон: `pnpm --filter admin test:e2e -- anonymous-visits wave6-record-status-derived unified-rows` (scenario 11 :453-505 зелёный без правок).
- [ ] Refactor: вынести повторяющийся сетап в хелпер `e2e/helpers/`, если >2 дублирования.
- [ ] Commit: `test(#257): e2e единой модели — бронирование с хвостом, конвертация, деньги, удаление, статус-каскад` (без Closes).

### DoD
- E2E test for scenario 1 passes (RED-GREEN-REFACTOR) — хвост уходит в анонимов с дефолтным тарифом.
- E2E test for scenario 2 passes (RED-GREEN-REFACTOR) — выбор сохранённых + хвост.
- E2E test for scenario 3 passes (RED-GREEN-REFACTOR) — конвертация на полном занятии без 409.
- E2E test for scenario 4 passes (RED-GREEN-REFACTOR) — деньги анонима в итогах.
- E2E test for scenario 5 passes (RED-GREEN-REFACTOR) — удаление освобождает место (с учётом undo-окна deferred-удаления).
- E2E test for scenario 6 passes (RED-GREEN-REFACTOR) — участие в статусе + каскад отмены.
- `unified-rows` scenario 11 зелёный; подтверждено grep'ом: `grep -n "anonym_visits\|anonymVisits" frontend/admin/e2e/unified-rows.spec.ts` — 0 попаданий (правки не нужны).

---

## Task 11: Финал — grep-свип, полные прогоны, CHANGELOG, PR
### Classification: small
### Required Docs
- Спека «Что сознательно НЕ строим» (контроль скоупа); конвенции design-phase §6 (без Closes в коммитах, Closes — в теле PR).

### Steps
- [ ] Финальный grep: `grep -rn "anonym_visits\|anonymVisits" backend/src backend/tests frontend packages` — пусто; в репо остаются только: новая alembic-версия (drop_column), docs/specs+plans (история решений).
- [ ] Полные прогоны: `uv run --extra dev pytest -x -q` (backend), `pnpm --filter admin test -- --run` + `tsc --noEmit` (frontend), `pnpm --filter admin test:e2e` (e2e целиком).
- [ ] CHANGELOG.md — строка релиза: единая модель посетителей (аноним = визит `visitor_id=null`), breaking-удаление `anonym_visits` из API.
- [ ] PR: ветка `feat/257-anonymous-visits-unified`, тело с `Closes #257` (закрытие — только здесь); борд переведёт контейнер-менеджер по гейтам.
- [ ] Commit: `docs(#257): CHANGELOG` (без Closes).

### DoD
- Все три прогона зелёные; grep чист; PR открыт с `Closes #257`.
