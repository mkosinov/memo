# Server Push Invalidation Channel (#239) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An SSE channel where the backend pushes "which entities changed (and who changed them)" after every commit, and the admin frontend silently refetches affected query families — with a small "Данные обновлены" chip shown only for external changes.

**Architecture:** In-memory `EventHub` (module singleton) fed by the `@transactional` post-commit choke point (contextvars accumulator + explicit `mark_changed` for cross-entity cascades); a native SSE endpoint (`fastapi.sse.EventSourceResponse`, FastAPI upgraded to ≥0.140) fans out `{entities, origin}` frames; the frontend subscribes via `EventSource`, invalidates through ONE shared family-rules map (`INVALIDATION_MAP`, also consumed by own-mutation hooks), and suppresses the indicator when `origin` matches its own tab id (`X-Memo-Tab-Id` header on mutations). No delivery guarantees — reconnect triggers a blanket invalidate.

**Tech Stack:** FastAPI ≥0.140 (`fastapi.sse.EventSourceResponse`), asyncio.Queue fanout, contextvars, TanStack Query v5, EventSource, Playwright (two browser contexts + `setOffline`).

**Spec (binding):** `docs/specs/2026-09-08-server-push-invalidation-design.md` — §2 decisions 1–11 (incl. D1 shared map + migration, D2 native SSE via FastAPI upgrade, D3 origin envelope), §3 backend contract (hub/entities/cascade table), §4 frontend contract, §5 error handling, §6 User Scenarios 1–6, §7 NOT-built, §8 DoD.

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/server-push-invalidation-239`.

**Test commands:**
- Backend: `cd backend && uv run pytest -q` (full suite; fast enough to run per task).
- Frontend unit: `cd frontend/admin && pnpm test`.
- Type-check: `cd frontend/admin && pnpm type-check`.
- api-client unit: `cd packages/api-client && pnpm test` (if configured there — check package.json; schemas tests live beside it).
- E2E: `cd frontend/admin && pnpm test:e2e -- <spec file>` (stack via `scripts/e2e-shard-start.sh`, see `scripts/test-all.sh:213`).

**Commits:** per-task, prefix `feat(#239):`.

---

## Behavioral Delta

How this behaves for the user, mapped to spec User Scenarios:

- **Вторая вкладка/админ создал запись → у первого таблица обновилась сама + мелькнул тост «Данные обновлены» (С1)** — видимые списки тихо перечитываются с сервера в течение секунд, без перезагрузки страницы; уведомление — стандартный тост приложения, не новый UI.
- **Изменение словаря (тег) видно через секунды, а не через час (С2)** — часовой кеш справочников больше не источник протухания: внешние правки приходят push'ем.
- **Расписание живое, включая чужое удаление (С3)** — сетка дня/недели перечитывается при внешнем изменении/удалении activity; связанные записи тоже сходятся.
- **«Клиент» записался напрямую через API (С4)** — расписание и записи админа обновились без всякой адаптации под клиента: любой писатель через API порождает события.
- **Пропал интернет/рестарт бэка → данные сходятся (С5)** — после восстановления соединения всё активное перечитывается; пропущенное während отключения догоняется одной blanket-инвалидацией.
- **Свои сохранения индикатор не зажигают (С6)** — «Данные обновлены» появляется только для чужих правок; вкладка узнаёт свои события по tab-id в origin.
- **Канал — ускоритель, не критическая зависимость** — если SSE недоступен, приложение работает как раньше (staleTime + своя инвалидация), без ошибок на экране.

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `backend/pyproject.toml` | MODIFY (T1) | `fastapi>=0.140.0` |
| `backend/src/events/__init__.py` | CREATE (T2) | package |
| `backend/src/events/hub.py` | CREATE (T2) | `EventHub` singleton: subscribe/unsubscribe/publish(entities, origin) |
| `backend/src/events/entities.py` | CREATE (T2) | `MODEL_ENTITY` map + `entity_name` resolution |
| `backend/src/events/emitter.py` | CREATE (T3) | contextvars accumulator, `mark_changed`, origin contextvar |
| `backend/src/services/decorators.py` | MODIFY (T3) | post-commit publish in `@transactional` |
| `backend/src/services/{activity,record,visit,master}.py`, `backend/src/domain/deletion.py` | MODIFY (T3) | `mark_changed` cascade sites (spec §3.3 table) |
| `backend/src/main.py` | MODIFY (T3, T4) | origin middleware, events router, lifespan hub init/close |
| `backend/src/events/router.py` | CREATE (T4) | `GET /api/v1/events` SSE endpoint |
| `backend/tests/test_events_*.py` | CREATE (T2–T4) | hub/entities/emit/sse tests |
| `frontend/admin/lib/invalidate.ts` | CREATE (T5) | `INVALIDATION_MAP` + `invalidateEntities` (family rules, single source) |
| `frontend/admin/hooks/use*Mutations.ts` + table/tab components (live paths: `app/(main)/locations/components/LocationsTable.tsx`, `app/(main)/masters/components/MastersTable.tsx`, `app/(main)/services/components/ServicesTable.tsx`, `app/(main)/services/components/MaterialsTable.tsx`, `app/components/modal/ActivityDetailsModal/ClientTab.tsx`, `app/(main)/clients/components/ClientRecordTab.tsx`) + `contexts/schedule/ScheduleDataContext.tsx` + `hooks/useDeleteRecord.ts` | MODIFY (T5) | mechanical migration to the shared map |
| `packages/api-client/src/client.ts` | MODIFY (T6) | `eventsUrl` export, tab id, `X-Memo-Tab-Id` on mutations |
| `frontend/admin/app/ServerEventsProvider.tsx` | CREATE (T7) | EventSource lifecycle, origin suppression (existing toast), reconnect blanket |
| `frontend/admin/app/providers.tsx` | MODIFY (T7) | mount provider inside QueryClientProvider (above PendingActionsProvider) |
| `frontend/admin/e2e/server-push-invalidation.spec.ts` | CREATE (T8) | scenarios 1–4 |
| `frontend/admin/e2e/server-push-offline.spec.ts` | CREATE (T9) | scenarios 5–6 |
| `docs/ARCHITECTURE.md`, `frontend/admin/lib/queryKeys.ts` (header comment) | MODIFY (T10) | docs re-sync |

**Ordering invariants:**
- T1 strictly first — the FastAPI upgrade gates all backend work (spec §2.11).
- T2 → T3 → T4 backend chain (emit needs hub; endpoint needs both).
- T5 and T6 are independent of the backend tasks and of each other; T7 needs T5 + T6.
- T8/T9 need T4 + T7 done (live channel end-to-end).
- T10 last.

---

## Task 1: FastAPI upgrade 0.136.3 → ≥0.140

### Classification: standard
### Required Docs
- Spec §2.11 (decision D2: native `fastapi.sse.EventSourceResponse`, upgrade blast radius), §8 first DoD bullet.

### Files
- MODIFY `backend/pyproject.toml` (dependency line)
- MODIFY `backend/uv.lock` (via `uv lock`, not by hand)

### Steps
- [ ] Check the newest FastAPI available to the resolver: `cd backend && uv pip index versions fastapi 2>/dev/null || uv run pip index versions fastapi` (fallback: query PyPI). Pick the latest 0.14x/0.15x stable that satisfies `>=0.140`; pin the lower bound only: `fastapi>=0.140.0`.
- [ ] Edit `backend/pyproject.toml`: `"fastapi>=0.115.0"` → `"fastapi>=0.140.0"`.
- [ ] `cd backend && uv lock && uv sync` — confirm fastapi resolves ≥0.140 in `uv.lock` (grep `"fastapi"` and the version line).
- [ ] Verify native SSE import: `cd backend && uv run python -c "from fastapi.sse import EventSourceResponse, ServerSentEvent; print('sse ok')"`.
- [ ] Full backend suite: `cd backend && uv run pytest -q` — MUST be fully green (sqladmin, CORS, routers, e2e-adjacent tests all exercise FastAPI).
- [ ] App boots: `cd backend && timeout 10 uv run uvicorn src.main:app --port 8000` — expect startup logs, no traceback (alembic lifespan + sqladmin mount under the new version).
- [ ] Commit: `feat(#239): upgrade FastAPI to >=0.140 (native SSE support)`.

### DoD
- `uv.lock` has fastapi ≥0.140; `from fastapi.sse import EventSourceResponse` works; full pytest green; app boots clean.

---

## Task 2: EventHub + entity names

### Classification: standard
### Required Docs
- Spec §3.1 (hub contract, module singleton rationale), §3.4 (entity names, completeness test), §3.3 (entity_name resolution — standalone services trap).

### Files
- CREATE `backend/src/events/__init__.py` (empty)
- CREATE `backend/src/events/hub.py`
- CREATE `backend/src/events/entities.py`
- CREATE `backend/tests/test_events_hub.py`
- CREATE `backend/tests/test_events_entities.py`

### Steps
- [ ] Write RED tests first (`backend/tests/test_events_hub.py`):

```python
import asyncio, pytest
from src.events.hub import EventHub

async def test_publish_fans_out_to_all_subscribers():
    hub = EventHub()
    q1, q2 = hub.subscribe(), hub.subscribe()
    hub.publish(["records"], origin={"type": "tab", "id": "abc"})
    assert await asyncio.wait_for(q1.get(), 1) == ({"records"}, {"type": "tab", "id": "abc"})
    assert await asyncio.wait_for(q2.get(), 1) == ({"records"}, {"type": "tab", "id": "abc"})

async def test_publish_batch_dedupes_entities():
    hub = EventHub()
    q = hub.subscribe()
    hub.publish(["records", "records", "visits"], origin=None)
    entities, origin = await asyncio.wait_for(q.get(), 1)
    assert entities == {"records", "visits"} and origin is None

async def test_overflow_drops_slow_subscriber():
    hub = EventHub(maxsize=2)
    q = hub.subscribe()
    for _ in range(5):
        hub.publish(["records"], origin=None)      # no awaiting consumer
    assert q not in hub._subscribers               # dropped, others survive

async def test_unsubscribe_stops_delivery():
    hub = EventHub()
    q = hub.subscribe(); hub.unsubscribe(q)
    hub.publish(["records"], origin=None)
    assert q.empty()
```

- [ ] Implement `backend/src/events/hub.py`:

```python
import asyncio

class EventHub:
    """In-memory fanout. Module-level singleton (services can't reach app.state)."""
    def __init__(self, maxsize: int = 64):
        self._maxsize = maxsize
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, entities, origin) -> None:
        payload = (set(entities), origin)
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                self._subscribers.discard(q)   # drop slow consumer; it reconnects

hub = EventHub()   # module singleton; lifespan/router/decorator all import THIS object
```

- [ ] Implement `backend/src/events/entities.py`: build `MODEL_ENTITY: dict[type, str]` by importing every module in `backend/src/services/` and mapping each service's `_model` class to `model.__tablename__` (the live tablenames are already canonical snake-case plurals: `activities`, `records`, …). Resulting names today: `clients, records, activities, masters, services, locations, materials, tags, photos, visitors, visits, payments, user_settings, users` (+ `tariffs` if a service exists for it — the import-walk decides, not a hand-typed list). Resolution helper:

```python
def resolve_entity_name(service_cls) -> str | None:
    # declared explicitly (standalone services) …
    if name := getattr(service_cls, "entity_name", None):
        return name
    # … or derived from the model map (GenericService subclasses)
    model = getattr(service_cls, "_model", None)
    return MODEL_ENTITY.get(model)
```

- [ ] Declare `entity_name = "visits"` on `VisitService` (`backend/src/services/visit.py`) and `entity_name = "user_settings"` on `UserSettingsService` (`backend/src/services/user_settings.py`) — they have no `_model` (spec §1 trap).
- [ ] Write `backend/tests/test_events_entities.py` — TWO guards:
  - **completeness:** import every module in `backend/src/services/`, collect classes having any method wrapped by `@transactional` (marker attribute from T3; until then — `GenericService`/`ArchiveService` subclasses PLUS the explicit standalone pair), assert `resolve_entity_name` is not None for each — a new transactional service without an entity name fails here loudly;
  - **backend-side drift mirror** (pairs with the frontend's T5 mirror — one source per side): `assert set(MODEL_ENTITY.values()) == {"clients","records","activities","masters","services","locations","materials","tags","photos","visitors","visits","payments","user_settings","users"}` — adding/removing an entity anywhere breaks exactly one of the two mirrors in CI.
- [ ] `cd backend && uv run pytest -q tests/test_events_hub.py tests/test_events_entities.py` — green.
- [ ] Commit: `feat(#239): event hub + canonical entity names`.

### DoD
- Hub tests green (fanout/dedupe/overflow-drop/unsubscribe); entity-name completeness test covers GenericService subclasses AND standalone transactional services; `activities` present in the map.

---

## Task 3: Post-commit emit — decorator + cascades + origin

### Classification: large
### Required Docs
- Spec §3.3 (binding: accumulator semantics, auto-mark rule, cascade table, origin propagation), §5 (no publish on rollback; mark_changed outside transaction = no-op), §2.4 (origin envelope).

### Files
- CREATE `backend/src/events/emitter.py`
- MODIFY `backend/src/services/decorators.py`
- MODIFY `backend/src/main.py` (origin middleware)
- MODIFY `backend/src/services/visit.py`, `activity.py`, `record.py`, `master.py`, `backend/src/domain/deletion.py` (mark_changed sites)
- CREATE `backend/tests/test_events_emit.py`
- MODIFY `backend/tests/test_events_entities.py` (switch the explicit list to marker-based introspection now that the decorator carries a marker)

### Steps
- [ ] Implement `backend/src/events/emitter.py`:

```python
import contextvars, logging
logger = logging.getLogger("memo.events")

_accumulator: contextvars.ContextVar[set[str] | None] = contextvars.ContextVar("changed_entities", default=None)
_origin: contextvars.ContextVar[dict | None] = contextvars.ContextVar("event_origin", default=None)

def mark_changed(entity: str) -> None:
    acc = _accumulator.get()
    if acc is None:
        logger.debug("mark_changed(%s) outside a transaction — ignored", entity)
        return
    acc.add(entity)

def set_origin(origin: dict | None) -> contextvars.Token: return _origin.set(origin)
def get_origin() -> dict | None: return _origin.get()
def start_accumulation(initial: set[str]) -> contextvars.Token: return _accumulator.set(set(initial))
def reset_accumulation(token: contextvars.Token) -> None: _accumulator.reset(token)
def accumulated() -> set[str] | None: return _accumulator.get()
```

  Contextvar semantics are contractual (spec §3.3): token set/reset in the wrapper (no cross-request bleed), `asyncio.create_task` does NOT inherit — cascade marking must stay in the transaction's own task; document this in the module docstring.
- [ ] Modify `@transactional` (`backend/src/services/decorators.py:41-88`): before calling the wrapped method — `token = start_accumulation({self.entity_name})` (resolve once via `resolve_entity_name(type(self))`; raise a clear error if None — the completeness test should have caught it); after successful `await session.commit()` (line ~:85) — `hub.publish(accumulated() or set(), get_origin())`; in `finally` — `reset_accumulation(token)`. Nothing published on exception/rollback. Add a marker attribute (e.g. `func.__memo_transactional__ = True`) for test introspection.
- [ ] Origin middleware in `backend/src/main.py` — insert at the middleware block (`main.py:45-55` neighborhood, BEFORE the `include_router` calls at `:138-151` so it wraps all routes):

```python
@app.middleware("http")
async def event_origin_middleware(request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        tab_id = request.headers.get("X-Memo-Tab-Id")
        emitter.set_origin({"type": "tab", "id": tab_id} if tab_id else None)
    return await call_next(request)
```

  (GETs carry no origin — spec §4.2: header only on mutating requests.)
- [ ] Add `mark_changed` calls exactly per the spec §3.3 binding table:
  - `visit.py` recompute hooks (`:27,79,143`): `mark_changed("records")`;
  - `activity.py` delete (`:158-194`): `mark_changed("records")`, `"visits"`, `"payments"`, `"photos"`, `"tags"`;
  - `record.py` delete raw-SQL path (`:374-377`): `mark_changed("visits")`, `"payments"`;
  - `record.py` create nested (`:480-608`): conditional marks only when actually created — `mark_changed("visits")` / `"clients"` / `"visitors"`;
  - `deletion.py` resolve_delete executor: mark `dep.entity` for EVERY dispatched handler (one place, not per-handler);
  - `master.py` archive/restore (`:50-90`): `mark_changed("users")`.
- [ ] Tests (`backend/tests/test_events_emit.py`) — use the app's real services against the test DB:
  - rollback: force a failing mutation → assert `hub` got nothing (subscribe and assert empty);
  - own entity: create a tag → subscriber receives `({"tags"}, origin)`;
  - cascade: create a visit for a record → `{"visits", "records"}`; delete an activity with records → `{"activities", "records", "visits", "payments", "photos", "tags"}`;
  - origin: same POST with/without `X-Memo-Tab-Id` header via httpx → `{"type":"tab","id":"x"}` vs `None`;
  - cascade-audit test: for each service in the §3.3 table, assert the `mark_changed` calls exist — behavioural assertions above (exercising each mutation) are primary; additionally a static source-audit test reads the service files and asserts the expected `mark_changed("…")` literals per site (e.g. `activity.py` contains marks for records/visits/payments/photos/tags), so a deleted mark fails CI even if the behavioural test path is skipped.
- [ ] `cd backend && uv run pytest -q` — full suite green (no regressions in the 14 services).
- [ ] Commit: `feat(#239): post-commit emit via @transactional + cascade marks + origin middleware`.

### DoD
- All emit tests green (rollback-silent, own-entity, all cascade sets from §3.3, origin passthrough both ways); full backend suite green; entity completeness test now marker-based.

---

## Task 4: SSE endpoint `/api/v1/events`

### Classification: standard
### Required Docs
- Spec §3.2 (endpoint contract: native EventSourceResponse, ping 15s, retry 5000, unsubscribe on disconnect), §2.3/§2.9 (no ids/replay; retry rationale), §8 (integration test pattern: httpx ASGITransport + background reader).

### Files
- CREATE `backend/src/events/router.py`
- MODIFY `backend/src/main.py` (router registration, lifespan hub wiring)
- CREATE `backend/tests/test_events_sse.py`

### Steps
- [ ] Implement `backend/src/events/router.py`:

```python
import asyncio, json
from fastapi import APIRouter
from fastapi.sse import EventSourceResponse, ServerSentEvent
from .hub import hub

router = APIRouter()

@router.get("/events")
async def events() -> EventSourceResponse:
    queue = hub.subscribe()
    async def gen():
        try:
            # reconnect delay the browser applies after a drop (spec §2.9);
            # native ping=15 keeps the idle connection alive between invalidate frames
            yield ServerSentEvent(event="ready", data="{}", retry=5000)
            while True:
                try:
                    entities, origin = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    continue                      # ping frames come from EventSourceResponse(ping=15)
                yield ServerSentEvent(
                    event="invalidate",
                    data=json.dumps({"entities": sorted(entities), "origin": origin}),
                )
        finally:
            hub.unsubscribe(queue)
    return EventSourceResponse(gen(), ping=15)
```

  (If the installed FastAPI's `ServerSentEvent`/`EventSourceResponse` signature differs — verify in T1 — adapt the call, keep the contract: `ready` frame with `retry=5000`, `invalidate` frames with the JSON payload, ping 15s, unsubscribe in `finally`. Disconnect detection is native.)
- [ ] `backend/src/main.py`: `from src.events.router import router as events_router`; `app.include_router(events_router, prefix="/api/v1")` alongside the other routers (`main.py:138-151`). Lifespan: on shutdown, clear hub subscribers (`hub` is a module singleton — nothing to construct, but drain it so tests don't leak queues).
- [ ] Integration test (`backend/tests/test_events_sse.py`) — non-blocking reader pattern (spec §8):

```python
import asyncio, json, httpx, pytest
from src.main import app

async def _read_frames(frames: list, stop: asyncio.Event):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cl:
        async with cl.stream("GET", "/api/v1/events") as resp:
            assert resp.headers["content-type"].startswith("text/event-stream")
            async for line in resp.aiter_lines():
                frames.append(line)
                if stop.is_set(): break

async def test_mutation_emits_frame_with_origin():
    frames, stop = [], asyncio.Event()
    reader = asyncio.create_task(_read_frames(frames, stop))
    await asyncio.sleep(0.2)                      # let the stream open
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as cl:
        await cl.post("/api/v1/tags", json={"name": "sse-check"},
                      headers={"X-Memo-Tab-Id": "tab-1"})   # adapt to the real create route/payload
    await asyncio.sleep(0.3); stop.set(); await reader
    joined = "\n".join(frames)
    assert "event: ready" in joined and "retry: 5000" in joined
    assert '"entities": ["tags"]' in joined and '"origin": {"type": "tab", "id": "tab-1"}' in joined
```

  Also: a POST without the header → `"origin": null`; a GET request to any endpoint emits nothing.
- [ ] `cd backend && uv run pytest -q tests/test_events_sse.py` — green; then full suite.
- [ ] Commit: `feat(#239): SSE endpoint /api/v1/events (native EventSourceResponse)`.

### DoD
- Streaming integration tests green (ready/retry frame, invalidate payload with entities+origin, null origin without header); ping wired; unsubscribe on disconnect; full backend suite green.

---

## Task 5: Frontend shared invalidation map + migration

### Classification: standard
### Required Docs
- Spec §4.1 (D1: family rules single source, migration rules, point-key limitation, drift guard), §4.1 audit-site list, §2.7.
- `frontend/admin/lib/queryKeys.ts` (header comment — prefix semantics are orthography-locked).

### Files
- CREATE `frontend/admin/lib/invalidate.ts`
- CREATE `frontend/admin/__tests__/invalidate.test.ts`
- MODIFY ~10 files: `hooks/use*Mutations.ts` (tags, photos, masters, services, locations, materials, clients, records families), `hooks/useDeleteRecord.ts`, `app/(main)/locations/components/LocationsTable.tsx`, `app/(main)/masters/components/MastersTable.tsx`, `app/(main)/services/components/ServicesTable.tsx`, `app/(main)/services/components/MaterialsTable.tsx`, `app/components/modal/ActivityDetailsModal/ClientTab.tsx`, `app/(main)/clients/components/ClientRecordTab.tsx`, `contexts/schedule/ScheduleDataContext.tsx`

### Steps
- [ ] Write RED test `frontend/admin/__tests__/invalidate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INVALIDATION_MAP, invalidateEntities } from '@/lib/invalidate';
import { qk } from '@/lib/queryKeys';
import { QueryClient } from '@tanstack/react-query';

describe('INVALIDATION_MAP', () => {
  it('targets are real qk exports', () => {
    for (const keys of Object.values(INVALIDATION_MAP))
      for (const k of keys)
        expect(Object.values(qk)).toContain(k.length === 1 ? qk[k[0] as keyof typeof qk] : k);
  });
  it('mirrors the backend entity list (drift guard)', () => {
    const BACKEND_ENTITIES = ['clients','records','activities','masters','services','locations',
      'materials','tags','photos','visitors','visits','payments','user_settings'];
    for (const e of BACKEND_ENTITIES) expect(INVALIDATION_MAP).toHaveProperty(e);
  });
});

describe('invalidateEntities', () => {
  it('invalidates each family prefix via the query client', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateEntities(qc, ['records', 'visits']);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.records });
    // …one call per distinct family in the union of map entries
  });
});
```

- [ ] Implement `frontend/admin/lib/invalidate.ts`. Seed the family rules from a FRESH AUDIT of the ~16 sites (spec §4.1 list) — read each site's current `invalidateQueries` set and encode the union per entity. Seed values (verify against the audit; wider is allowed per spec §2.7):

```ts
import type { QueryClient } from '@tanstack/react-query';
import { qk } from './queryKeys';

export type EntityName = 'clients' | 'records' | 'activities' | 'masters' | 'services'
  | 'locations' | 'materials' | 'tags' | 'photos' | 'visitors' | 'visits' | 'payments' | 'user_settings';

// FAMILY RULES — single source (spec §2.7/D1). Family cascade → here; id/condition → hook.
export const INVALIDATION_MAP: Record<EntityName, readonly (readonly unknown[])[]> = {
  clients: [qk.clients, qk.records],               // client edits cascade to records (useClientsMutations.ts:27)
  records: [qk.records, qk.visitorsList],          // record delete shrinks visitor lists
  activities: [['activities']],                     // covers activityRange + activitiesForRecords
  masters: [qk.masters, qk.records],                // master edits cascade to records (useMastersMutations.ts:60)
  services: [qk.services, qk.records],              // service edits cascade to records (useServicesMutations.ts:60)
  locations: [qk.locations],
  materials: [qk.materials],
  tags: [qk.tags],
  photos: [qk.photos],
  visitors: [qk.visitorsList],
  visits: [qk.records],                            // no visits prefix; visits recalc the record
  payments: [['payments'], qk.records],            // ['payments'] covers recordPayments + paymentTotals
  user_settings: [],                               // UserSettingsContext syncs itself
};

export function invalidateEntities(qc: QueryClient, entities: readonly string[]): void {
  const seen = new Set<readonly unknown[]>();
  for (const e of entities) {
    const families = INVALIDATION_MAP[e as EntityName];
    if (!families) { if (process.env.NODE_ENV !== 'production') console.warn('[events] unknown entity', e); continue; } // spec §5: backend enumeration is open — runtime names arrive as JSON past the TS union
    for (const k of families) if (!seen.has(k)) { seen.add(k); void qc.invalidateQueries({ queryKey: k }); }
  }
}
```

- [ ] Migrate the sites: replace every pure family-level `qc.invalidateQueries({ queryKey: qk.X })` with `invalidateEntities(qc, ['X', /* + entities whose cascade the site also invalidates */])`. Hooks KEEP their point-key and conditional invalidations ON TOP (e.g. `useRecordMutations` keeps `qk.record(recordId)` / `qk.visitors(clientId)` / the conditional `clients` mark at `useRecordMutations.ts:154-155`; `ScheduleDataContext` switches to the `['activities']` prefix — strictly wider and correct). **Prefix-migration risk, watched:** `['activities']` subsumes every `activityRange(weekStart, weekEnd)` reader (`queryKeys.ts:30`, `ScheduleDataContext.tsx:96`) — the existing cache-sync/reader tests (`recordCacheSync` etc.) are exactly the regression net here; if any goes RED after the switch, the reader-side expectation is the thing to inspect, not the prefix.
- [ ] After EACH file migrated: `cd frontend/admin && pnpm test` — the existing hook/table tests are the migration's safety net (spec §4.1: green untouched is the DoD).
- [ ] Full check: `pnpm test && pnpm type-check` — green.
- [ ] Commit: `feat(#239): shared invalidation map + migrate mutation hooks/tables`.

### DoD
- Map tests green (real qk targets + backend-list drift guard); all pre-existing frontend tests green through the migration; every audited site now routes family rules through the map.

---

## Task 6: api-client — eventsUrl + tab identity

### Classification: small
### Required Docs
- Spec §4.2 (tab uuid per tab, header on mutations only, eventsUrl export), §3.3 (header name `X-Memo-Tab-Id`; NOT "client" — domain collision).

### Files
- MODIFY `packages/api-client/src/client.ts`
- MODIFY/CREATE test beside it (follow the existing test layout, e.g. `client.test.ts`)

### Steps
- [ ] In `client.ts` (single fetch choke point, `:4`):

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:8000`;
export const eventsUrl = `${API_BASE}/api/v1/events`;

// Per-tab identity: one uuid per browser tab (regenerated on reload) —
// the admin compares it against event.origin to keep its own changes silent (spec §2.4).
const tabId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
export const getTabId = () => tabId;

// inside the request function, before fetch():
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (method !== 'GET') headers['X-Memo-Tab-Id'] = tabId;
```

- [ ] Test: mutating requests carry the header; GETs do not; `eventsUrl` ends with `/api/v1/events` (mock fetch, assert call args — follow the existing client test style if present, else create `client.test.ts` next to `schemas.test.ts`).
- [ ] `cd packages/api-client && pnpm test` (its package.json has `"test": "vitest run"`).
- [ ] Commit: `feat(#239): api-client eventsUrl + X-Memo-Tab-Id on mutations`.

### DoD
- Header attached to POST/PUT/PATCH/DELETE only; `eventsUrl` exported; `getTabId` stable within a module instance; tests green.

---

## Task 7: ServerEventsProvider + Topbar indicator

### Classification: standard
### Required Docs
- Spec §4.2 (provider contract: placement, onmessage semantics, origin suppression, reconnect blanket WITHOUT toast, no onerror handling), §4.3 (existing toast system — `UIContext.showToast`, kind `info`, no new UI), §5 error table.
- `frontend/admin/app/providers.tsx:36-51` (provider chain — the mount slot), `frontend/admin/contexts/UIContext.tsx:18,50` (showToast API).

### Files
- CREATE `frontend/admin/app/ServerEventsProvider.tsx`
- MODIFY `frontend/admin/app/providers.tsx` (mount inside the QueryClientProvider chain)
- CREATE `frontend/admin/__tests__/ServerEventsProvider.test.tsx`

### Steps
- [ ] Write RED unit test (`__tests__/ServerEventsProvider.test.tsx`) with a mocked `EventSource` (vi.fn class capturing handlers) and a mocked `useUI`:
  - `event: invalidate` with `origin {type:'tab', id:'me'}` → `invalidateQueries` called, `showToast` NOT called;
  - origin `{'tab','other'}` or `null` → invalidation + `showToast('Данные обновлены', 'info')` called ONCE for a burst of events (burst-collapse);
  - connection transitions to OPEN after an error → blanket `qc.invalidateQueries()` (no args) + NO toast;
  - malformed frame → nothing thrown, no toast.
- [ ] Implement `ServerEventsProvider.tsx`:

```tsx
'use client';
export function ServerEventsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { showToast } = useUI();
  const hadError = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const es = new EventSource(eventsUrl);
    es.onopen = () => {
      if (hadError.current) { hadError.current = false; void qc.invalidateQueries(); } // reconnect → blanket (no toast)
    };
    es.onerror = () => { hadError.current = true; };   // EventSource retries on its own
    es.addEventListener('invalidate', (e) => {
      try {
        const { entities, origin } = JSON.parse((e as MessageEvent).data);
        invalidateEntities(qc, entities);
        if (!(origin?.type === 'tab' && origin?.id === getTabId())) {
          if (!toastTimer.current)                     // burst collapses into one toast (spec §2.4)
            toastTimer.current = setTimeout(() => { toastTimer.current = null; }, 1000);
          showToast('Данные обновлены', 'info');       // auto-dismiss owned by the toast system
        }
      } catch { /* malformed frame — skip (spec §5) */ }
    });
    return () => es.close();
  }, [qc, showToast]);
  return <>{children}</>;
}
```

  (Burst-collapse window is 1000ms — tune to the toast's own auto-dismiss at implementation; the assertion is "one toast per train", not a fixed constant.)
- [ ] Mount it in `frontend/admin/app/providers.tsx` — inside the QueryClientProvider subtree (needs `useQueryClient` AND `useUI` from the UIProvider above it, `providers.tsx:36-51`):

```tsx
// inside QueryClientWithErrorReporting's render:
<QueryClientProvider client={queryClient}>
  <ServerEventsProvider>{children}</ServerEventsProvider>
</QueryClientProvider>
```

- [ ] `cd frontend/admin && pnpm test && pnpm type-check` — green.
- [ ] Commit: `feat(#239): ServerEventsProvider + external-change toast`.

### DoD
- Unit tests green (suppression matrix, burst-collapse to one toast, reconnect blanket without toast, malformed-frame tolerance); provider mounted in `providers.tsx`; no new UI components (toast testid `toast-info` renders via the existing system).

---

## Task 8: E2E — scenarios 1–4 (external updates)

### Classification: large
### Required Docs
- Spec §6 scenarios 1–4 (exact assertions), §8 (two browser contexts; bare-API writes via APIRequestContext — precedent `e2e/combobox-dictionaries.spec.ts:73`).
- `frontend/admin/playwright.config.ts` (API URL baking).

### Files
- CREATE `frontend/admin/e2e/server-push-invalidation.spec.ts`

### Steps
- [ ] RED: write the spec with two contexts:

```ts
// helper: const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
// pageA = await ctxA.newPage(); pageB = await ctxB.newPage(); — both to the admin origin.
// Bare API writes (scenario 4): playwright.request / APIRequestContext to the backend.
```

  - **С1:** pageA on `/records`; pageB creates a record through the UI (or API with pageB's tab header absent — prefer the UI path so the header is real); assert pageA's table shows the new row within ~5s without reload (concrete assertion: `await expect(pageA.getByTestId('records-table')).toContainText(<new record marker>, { timeout: 5000 })` — adapt the testid to the live DataTable markup); assert the toast appeared on pageA (`getByTestId('toast-info')` with text «Данные обновлены»).
  - **С2:** pageB adds a tag (UI); pageA's tag picker offers it within ~5s (not after 1h staleTime).
  - **С3:** pageA on `/schedule`; pageB deletes an activity via the UI; assert pageA's grid updates (activity card gone) AND a records-family view converges (e.g. pageA's records table no longer shows the cascaded record — same `getByTestId('records-table')` assertion).
  - **С4:** bare `request.post('/api/v1/activities', …)` (no tab header → `origin: null`); pageA's schedule/records update + the `toast-info` «Данные обновлены» appears.
- [ ] Run: `cd frontend/admin && pnpm test:e2e -- server-push-invalidation.spec.ts` — RED first. **RED proof (mandatory):** temporarily point the provider at a dead URL (or no-op the `invalidate` listener) for one run and confirm the new specs FAIL — a push-test that passes without the channel is testing staleTime, not the channel (timeouts stay below staleTime thresholds: `{ timeout: 5000 }`).
- [ ] GREEN: fix whatever the channel surfaces (likely none — Tasks 2–7 implement it); REFACTOR: shared helpers (two-context fixture) into the spec file or `e2e/fixtures/` following existing patterns.
- [ ] Commit: `feat(#239): e2e scenarios 1-4 (external updates via SSE)`.

### DoD
- E2E test for scenarios 1, 2, 3, 4 passes (RED-GREEN-REFACTOR); timeouts assert the push window (5s), not staleTime.

---

## Task 9: E2E — scenarios 5–6 (offline convergence + own-mutation silence)

### Classification: standard
### Required Docs
- Spec §6 scenarios 5–6 (setOffline mechanics; mid-outage write REQUIRED; own-mutation origin match), §5 error table row 1.

### Files
- CREATE `frontend/admin/e2e/server-push-offline.spec.ts`

### Steps
- [ ] **С5:** pageA opens `/records`; `await ctxA.setOffline(true)` (context-level network emulation — do NOT use `route.abort`: it does not reliably intercept EventSource, spec §6); pageB (still online) creates a record; `await ctxA.setOffline(false)`; assert pageA reconnects and shows the record within ~10s of going back online (blanket invalidate) — convergence with a real mid-outage write.
- [ ] **С6:** pageA creates a record through its own UI; assert the table updates (own invalidation) and the `toast-info` «Данные обновлены» does NOT appear (origin matches pageA's tab) within the assertion window.
- [ ] Run: `pnpm test:e2e -- server-push-offline.spec.ts` — RED → GREEN → REFACTOR.
- [ ] Full e2e sweep of both new files plus the affected suites: `pnpm test:e2e` (or the shard flow from `scripts/test-all.sh` if running everything).
- [ ] Commit: `feat(#239): e2e scenarios 5-6 (offline convergence, own-mutation silence)`.

### DoD
- E2E test for scenarios 5, 6 passes (RED-GREEN-REFACTOR); no e2e regressions in the full sweep.

---

## Task 10: Docs re-sync + final sweep

### Classification: small
### Required Docs
- Spec §7 last bullet (ARCHITECTURE.md rewrite), §8 DoD (docs line).

### Files
- MODIFY `docs/ARCHITECTURE.md` (section «DICT_STALE_TIME and the no-external-invalidation assumption», `:108-118`)
- MODIFY `frontend/admin/lib/queryKeys.ts` (header comment `:15-17` — #239 is no longer "tracks eval", the channel exists)

### Steps
- [ ] Rewrite the ARCHITECTURE.md section: dictionaries keep `DICT_STALE_TIME = 1h` as a load-reduction default, but correctness now rests on the SSE invalidation channel (`/api/v1/events`, `{entities, origin}`, reconnect blanket-invalidate; single-process in-memory hub; sqladmin writes exempt; auth to come with #247 — EventSource headerless constraint recorded).
- [ ] Update the `queryKeys.ts` header comment: replace "#239 tracks server-push eval" with a pointer to the channel + `lib/invalidate.ts` as the family-rules single source.
- [ ] Final sweep (the spec §8 DoD): `cd backend && uv run pytest -q`; `cd frontend/admin && pnpm test && pnpm type-check && pnpm test:e2e -- server-push-invalidation.spec.ts server-push-offline.spec.ts`.
- [ ] Commit: `feat(#239): docs re-sync (ARCHITECTURE.md channel section, queryKeys header)`.

### DoD
- Docs describe the shipped channel; full fast suite + both e2e specs green.

---

## Self-Review (folded at write time)

- **Spec coverage:** §2.11/D2 → T1; §3.1 → T2; §3.4 → T2; §3.3 → T3; §3.2 → T4; §4.1/D1 → T5; §4.2 (api-client half) → T6; §4.2–4.3 → T7; §6 С1–С6 → T8 (1–4) / T9 (5–6); §7 docs bullet → T10. §5 error rows are covered by T3 (rollback, mark_changed no-op), T4 (unsubscribe), T7 (malformed, reconnect) tests.
- **Placeholders:** none — every step carries concrete code or an exact audit instruction with seed values.
- **Ordering:** T1 first; T2→T3→T4; T5‖T6; T7 after both; T8/T9 after T4+T7; T10 last.
