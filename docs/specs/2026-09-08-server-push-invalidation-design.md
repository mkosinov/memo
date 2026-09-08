# GH #239 — Server push channel for cache invalidation (SSE)

- **Issue:** #239 `Server push channel for cache invalidation (WebSocket/SSE eval)`
- **Status:** DESIGN phase, G1a passed 2026-09-08; G1b revision 1 (5-reviewer panel + user decisions D1–D3) same day
- **Scope:** `backend/src` (events hub + SSE endpoint + post-commit emit + FastAPI upgrade ≥0.140) + `frontend/admin` (EventSource provider, shared invalidation map + migration, indicator, tab-origin id) + `packages/api-client` (events URL export + tab header). No schema changes; FastAPI is upgraded, no new packages added.
- **Grounding:** host scout recon 2026-09-08 (three zones: frontend data layer, backend mutation surface, runtime topology) + 5-reviewer panel verification (completeness/consistency/feasibility/simplicity/best-practices); all file:line facts verified against the live tree.

---

## 1. Context & Problem

The admin app has no server→browser channel today. React Query cache invalidation fires **only on the administrator's own mutations** (`onSuccess → qc.invalidateQueries(qk.<entity>)`, scattered across ~12 files). External writers are picked up only when staleTime expires — 30s for lists (default, `frontend/admin/app/providers.tsx:26`), **1 hour for dictionaries** (`DICT_STALE_TIME`, `frontend/admin/lib/queryKeys.ts:19`) — or after the admin's own next mutation / page re-entry. This is the documented #140 tradeoff (`docs/ARCHITECTURE.md:110-118`), and `queryKeys.ts:16-17` explicitly points to #239 as the tracker for re-evaluating it.

**Who the external writers are (product roadmap, user-confirmed 2026-09-08):**

- a second admin on another device — real, near-term;
- client online flow #6 (book / modify / pay) — deferred but planned;
- a future masters app (masters manage their own working days → affects the schedule);
- future system jobs (cron, e.g. salary calc) and external integrations.

All of them write through **the same backend API**, so a single event source at the server's commit point covers every writer, present and future, with zero per-writer work.

**Key live-tree facts (scout- and panel-verified):**

- Every service-layer mutation is wrapped by the `@transactional` decorator (`backend/src/services/decorators.py:41-88`, commit at `:85`) — a single post-commit choke point covering all API writes. Two standalone services write through it WITHOUT being `GenericService` subclasses and without `_model`: `VisitService` (`visit.py:26`) and `UserSettingsService` (`user_settings.py:37`).
- Cross-entity write cascades exist in several places (§3.3 enumerates them bindingly): `ActivityService.delete` (`activity.py:158-194`), `RecordService.delete` raw SQL (`record.py:374-377`), `RecordService.create` nested creates (`record.py:480-608`), the `resolve_delete` dependency matrix (`domain/deletion.py:673-688`), `MasterService.archive/restore` (also writes `user.is_active`, `master.py:50-90`).
- Runtime is single-process by design: uvicorn single worker (`dev.sh:96`, `scripts/e2e-shard-start.sh:100`), no gunicorn, SQLite + aiosqlite with WAL (`backend/src/core/config.py:16`, `backend/src/db/database.py:16-50`) → in-memory pub/sub is valid; no Docker, no proxies — the browser talks to FastAPI directly on `:8000` (CORS, `packages/api-client/src/client.ts:4`).
- FastAPI is currently locked at 0.136.3 (`backend/uv.lock:227`); native SSE support (`fastapi.sse.EventSourceResponse`) ships in ≥0.140 — the upgrade is in scope (decision D2).
- No auth exists anywhere on the API (no tokens, no sessions, no guards; plain fetch without Authorization headers; sqladmin mounted without login). Full-app auth is filed separately as #247.
- Frontend: `qk` factories + entity prefixes (`frontend/admin/lib/queryKeys.ts:21-43`). Prefix families cover parameterized keys (`['activities']` covers `activityRange`/`activitiesForRecords`; `['payments']` covers `recordPayments`/`paymentTotals`; `['visitors']` covers `visitors(clientId)`); **singular point keys** `['record', id]`, `['client', id]`, `['activity', id]` are NOT covered by the plural prefixes.
- No polling / EventSource / WebSocket / BroadcastChannel exists anywhere today.

## 2. Locked decisions (G1a user-approved 2026-09-08; D1–D3 re-decided at G1b revision)

1. **Transport = SSE** (Server-Sent Events). Strictly one-directional "what went stale" hints; all writes stay plain HTTP. EventSource auto-reconnects natively; works with the existing direct-origin CORS setup. WebSocket rejected: nothing on the roadmap streams client→server (even chat #8, the nearest bidirectional candidate, is P5 and buildable as HTTP POST + SSE delivery). **Not a dead end:** the backend hub is transport-agnostic; a future WS endpoint (chat) subscribes to the same hub in parallel. Coordinated polling rejected: latency = poll interval, constant idle traffic, and a version counter still needs the same post-commit hook — half the backend work for a worse result.
2. **Event payload = bare entity names + origin.** `{"entities": ["records", "visits"], "origin": {"type": "tab", "id": "<uuid>"}}`. No data, no ids of changed rows, no diffs — React Query refetches via normal GET. One transaction touching several entities = one event with the full set. The `origin` envelope answers "who caused it" (decision D3, below).
3. **No delivery guarantees, no server-side buffering, no event ids / Last-Event-ID replay.** Missed events are covered by convergence: on SSE reconnect the client blanket-invalidates all active queries and refetches. (`id` fields stay unset deliberately even though the native SSE class supports them — replay is a rejected feature, not a missed one.)
4. **UX = silent refresh + minimal indicator, own vs. external decided by `origin` (D3, user idea — replaces the earlier time-window heuristic).** The indicator is a small non-modal chip («Данные обновлены»), auto-dismiss ~3s, never stacks, shown ONLY when `origin` is not this tab: suppression rule `!(origin.type === "tab" && origin.id === myTabId)`. Deterministic, no magic windows, no MutationCache timestamps. The origin envelope anticipates the writer taxonomy without building it: `tab` today; `user`/`user_id`, `client`/`client_id`, `system`/`task_id`, `external`/`external_id` are documented future types (added by their writers when they appear — no code now). When auth (#247) lands, a second tab of the same admin matches by `user_id` and correctly stays silent.
5. **Auth: auth-ready, but ships unauthenticated** — like the whole API today. Recorded constraints for #247: (a) guard = one `Depends` line on the events router; (b) native EventSource **cannot send Authorization headers** — integration paths are cookie-session (`withCredentials`), short-lived token in query param, or a fetch-based SSE polyfill.
6. **sqladmin writes do not emit events** (separate sync engine, bypasses `@transactional`) — known, accepted gap; sqladmin is a dev/ops tool.
7. **Shared invalidation map of FAMILY rules + migration (D1).** One table `entity → qk prefix families` is the single source of family-level invalidation rules, consumed by BOTH the SSE handler and the own-mutation sites (mechanical migration, ~10 files; existing tests must stay green — that is the DoD of the migration). Hooks keep ONLY what only they can know: point-key invalidation (`qk.record(id)`, `qk.visitors(clientId)`) and conditional extras («invalidate clients only if a new client was created»), layered ON TOP of the table call. Rule for future code: **family cascade → the table; id/condition → the hook.** The earlier "byte-identical everywhere" claim is dropped — the table's sets may be slightly wider for external events (extra refetches are cheap and correct).
8. **Backpressure = drop the slow connection.** Each SSE connection holds a bounded queue (~64 events); overflow closes that connection — the client reconnects and blanket-invalidates.
9. **Heartbeat = native ping, 15s** (built into `EventSourceResponse`, the community-standard interval); **`retry: 5000`** sent at connection start so reconnection timing is server-controlled (browser default is ~3s, too aggressive).
10. **Second tab of the same admin is covered by the same channel** (every tab subscribes; a mutation from tab A publishes to all subscribers including tab B, and tab A's origin makes it silent for itself). No BroadcastChannel / `storage` sync — one mechanism, not two.
11. **SSE implementation = native `fastapi.sse.EventSourceResponse` (D2), FastAPI upgraded 0.136.3 → ≥0.140** as an explicit task in the plan. The class provides headers (`Cache-Control`, `X-Accel-Buffering`), configurable ping, disconnect detection and W3C-compliant framing out of the box (best-practices panel finding). A hand-rolled `StreamingResponse` loop was the rejected alternative — it re-implements what the framework now ships. The upgrade's blast radius (route decorators, middleware, sqladmin compat, uvicorn pin) is the plan's first task with the full backend suite as its gate.

## 3. Backend architecture (binding)

### 3.1 Event hub — `backend/src/events/hub.py`

In-memory fanout, transport-agnostic, **module-level singleton** (services are `@lru_cache` singletons with no app reference — `app.state` is unreachable from the decorator; the lifespan initializes/closes the SAME singleton, the SSE router imports it too):

```python
class EventHub:
    def subscribe(self) -> asyncio.Queue    # bounded(maxsize=64)
    def unsubscribe(self, queue) -> None
    def publish(self, entities: Iterable[str], origin: Origin | None) -> None
    # put_nowait to every subscriber; QueueFull → drop that subscriber
    # (its connection is closed; the client reconnects and blanket-invalidates)
```

`Origin` is a small typed dict `{"type": str, "id": str | None}` (envelope from §2.4; only `"tab"` exists today). The hub knows nothing about SSE — a future WS endpoint subscribes identically.

### 3.2 SSE endpoint — `backend/src/events/router.py`

`GET /api/v1/events` → native `fastapi.sse.EventSourceResponse` (FastAPI ≥0.140):

- The response generator reads the connection's queue and yields `ServerSentEvent(event="invalidate", data=json({"entities": [...], "origin": {...}}))`.
- `ping=15` (native heartbeat), an initial `retry: 5000` frame at connection start.
- Client disconnect → `unsubscribe` in a finally block (native disconnect detection).
- Registered alongside the other routers (`main.py:138-151`); CORS applies as to any route.

### 3.3 Post-commit emit — extension of `@transactional`

The decorator (`decorators.py:41-88`) is the single emit point:

- **Entity name resolution:** every transactional service declares `entity_name` (a `ClassVar`). For `GenericService` subclasses it derives from the model→name map (§3.4); the standalone services (`VisitService` → `visits`, `UserSettingsService` → `user_settings`) declare it explicitly. The decorator auto-marks the service's own `entity_name` — never a raw `self._model` attribute access (two services have none; the panel caught the silent-never-emit trap).
- **Accumulator:** a `contextvars.ContextVar` set (token-based set/reset in the wrapper; reset in `finally`). `mark_changed(entity)` is available to service code for cross-entity cascades; `mark_changed` outside an active transaction is a no-op with a dev-mode log; `asyncio.create_task` does not inherit the accumulator — documented, cascade marking must stay in the transaction's own task.
- **On successful commit** (after `await session.commit()`, `:85`): `hub.publish(accumulated, origin)` — once per transaction, batched. On rollback/exception: discarded, nothing published.
- **Origin propagation:** a small ASGI middleware extracts `X-Memo-Tab-Id` from mutating requests (POST/PUT/PATCH/DELETE) into a request-scoped contextvar; the decorator reads it at publish time.

**Binding cascade enumeration (panel-audited; every cross-entity write gets `mark_changed`):**

| Site | Auto-mark | Explicit `mark_changed` |
|---|---|---|
| `VisitService` hooks (`visit.py:27,79,143` — visit writes recalc the parent record) | `visits` | `records` |
| `ActivityService.delete` (`activity.py:158-194` — bulk-deletes records, their visits/payments/record_tags, activity_tags; photos SET NULL) | `activities` | `records`, `visits`, `payments`, `photos`, `tags` |
| `RecordService.delete` raw SQL (`record.py:374-377`) | `records` | `visits`, `payments` |
| `RecordService.create` nested (`record.py:480-608` — may create visits, clients, visitors) | `records` | conditional: `visits`, `clients`, `visitors` (only when actually created) |
| `ArchiveService.resolve_delete` (`generic.py:311-390` via `deletion.py` handler matrix) | the deleted entity | **the generic executor marks every dispatched dependency's entity** (`deletion.py:673-688`: photos, records, visitors, visits, tags join rows, tariffs, users) — no per-handler manual marks |
| `MasterService.archive/restore` (`master.py:50-90` — also writes `user.is_active`) | `masters` | `users` |

A backend test audits this table against the live service code (the set of `mark_changed` calls per service is asserted, not just the model map).

### 3.4 Canonical entity names — `backend/src/events/entities.py`

One map `model class → entity name` (snake-case plural). Known today: `clients`, `records`, `activities`, `masters`, `services`, `locations`, `materials`, `tags`, `photos`, `visitors`, `visits`, `payments`, `user_settings`, `users` (tariffs etc. join via the completeness test if a service exists for them). **Completeness is tested by iterating ALL classes with `@transactional` write methods** (GenericService/ArchiveService subclasses AND the standalone services) — an unknown entity fails loudly at test time. Entities without a frontend cache (`users`, …) are still emitted; the frontend skips unknown names silently (§5).

## 4. Frontend architecture (binding)

### 4.1 Shared invalidation map — `frontend/admin/lib/invalidate.ts` (new)

```ts
export type EntityName = ...; // mirrors the backend canonical names (subset with caches)
export const INVALIDATION_MAP: Record<EntityName, readonly QueryKey[]>; // family rules
export function invalidateEntities(qc: QueryClient, entities: EntityName[]): void;
```

- **Family rules, single source (D1):** built from a fresh audit of the current `onSuccess` sets (`hooks/use*Mutations.ts` ×9, `LocationsTable.tsx:235`, `MastersTable.tsx:213`, `ServicesTable.tsx:203`, `MaterialsTable.tsx:192`, `ClientTab.tsx:161`, `ClientRecordTab.tsx:173`, `contexts/schedule/ScheduleDataContext.tsx:135,181,188`, `hooks/useDeleteRecord.ts:45-47`). Sets may be slightly WIDER than today's per-site sets where a cascade is conditional today (e.g. `records → ['records', 'visitors']`) — correct for external events, one cheap extra refetch for own mutations.
- **Migration (mechanical, ~10 files):** every family-level `invalidateQueries(qk.X)` call site becomes `invalidateEntities(qc, ['X', …])`. Hooks keep ON TOP their point-key and conditional invalidations (`qk.record(recordId)`, `qk.visitors(clientId)`, "clients only if created" — `useRecordMutations.ts:63-74,154-155,231,246`, `:320`). Existing tests stay green untouched — the migration's DoD.
- **Known limitation, accepted:** singular point keys (`['record', id]`, `['client', id]`, `['activity', id]`) are not prefix-covered, so an external change does not refetch an open detail modal; detail views are short-lived and converge on next open.
- **Drift guard:** a frontend unit test asserts the map's keys mirror the backend entity list (test-mirrored constant) — both sides fail loudly on drift.

### 4.2 Tab identity + SSE provider

- **Tab id:** a per-tab uuid (module-level in the provider — one per browser tab, regenerated on reload). `packages/api-client` attaches it as `X-Memo-Tab-Id` to every mutating request (client.ts is the single fetch choke point; the header is NOT sent on GETs) and gains an exported `eventsUrl` (derived from the existing `API_BASE`, `client.ts:4` — new export created in this issue).
- **`frontend/admin/app/ServerEventsProvider.tsx`** (new), mounted INSIDE the `QueryClientProvider` chain in `providers.tsx` (reaches the client via `useQueryClient()`; the client instance is created in `QueryClientWithErrorReporting`, `providers.tsx:39-58`):
  - opens `EventSource(eventsUrl)` in a `useEffect` (browser-only);
  - `onmessage`: parse `{entities, origin}` → `invalidateEntities(qc, entities)` (always — double invalidation with own mutations is harmless); indicator shown iff **not** `origin.type === "tab" && origin.id === myTabId`;
  - reconnect convergence: on the connection transitioning to OPEN after an error → `qc.invalidateQueries()` (blanket). **No indicator on reconnect** — it is convergence, not a change notification (and dev `--reload` reconnects would be noisy);
  - `onerror`: nothing else — EventSource retries natively (`retry: 5000` from the server).
- `refetchOnWindowFocus` stays `false` (`providers.tsx:28`) — the channel replaces the focus-refresh need.

### 4.3 Indicator — Topbar chip

Small non-modal chip next to the existing «Сохраняем…» chip (`Topbar.tsx:338-363`), text «Данные обновлены», auto-dismiss ~3s, does not stack (a burst of events = one showing). Pure presentational component + local state; unit-tested in isolation.

## 5. Error handling (binding)

| Failure | Behavior |
|---|---|
| SSE connection drops (backend restart, network, dev `--reload`) | EventSource auto-reconnects (server-paced `retry: 5000`); on reconnect → blanket invalidate → data converges. No indicator. |
| Slow consumer / queue overflow | Server closes that one connection (§2.8) → client reconnect path → blanket invalidate. |
| Channel entirely broken/unavailable | App behaves exactly as today: staleTime + own-mutation invalidation. The channel is an accelerator, not a critical dependency — no user-facing error states for channel failures. |
| Transaction rolls back | Nothing published (accumulator discarded). |
| Unknown entity in event (e.g. `users` — no frontend cache) | Frontend skips it silently (dev-mode log); map drift is additionally caught by the §4.1 drift-guard test. |
| Malformed event data / missing origin | Skip the frame; no crash, no indicator. |
| `mark_changed` outside a transaction / from a background task | No-op with dev-mode log (contextvar semantics documented in §3.3). |

## 6. User Scenarios (each maps to an E2E test)

1. **Вторая вкладка видит запись сразу:** admin A has the records table open; admin B (second Playwright browser context) creates a record → A's table shows it within seconds without reload; the indicator fired (B's origin ≠ A's tab).
2. **Словарь без часового лага:** admin B adds a tag → admin A's tag lookup offers it within seconds (not after the 1h `DICT_STALE_TIME`).
3. **Расписание живое + каскад удаления:** admin B deletes an activity on the schedule → admin A's grid refetches silently AND the records family converges (exercises the `ActivityService.delete` cascade marks from §3.3).
4. **«Клиент» пишет через API:** a booking created by a bare API POST (request-level, no tab header — simulating the future #6 client flow; `origin: null`) → admin A's schedule/records update + indicator.
5. **Разрыв канала → сходимость:** `context.setOffline(true)` on A → admin B (or bare API) writes a record while A is offline → `setOffline(false)` → A reconnects → blanket invalidate → the record is visible (convergence proven with a real mid-outage write; `route.abort` is NOT used — it does not reliably intercept EventSource).
6. **Своя мутация не зажигает индикатор:** admin A creates a record → data updates (via own invalidation + the SSE event) → the indicator does NOT appear (origin matches A's tab).

## 7. Out of scope / constraints (binding)

- **No data payloads / row ids / diffs in events** — invalidation hints + origin only.
- **No guaranteed delivery, no replay/buffering, no event ids / Last-Event-ID** (deliberate — reconnect-blanket covers correctness; the native class's `id` support stays unused).
- **No multi-process fanout** (Redis pub/sub etc.) — single-process is a design invariant (SQLite); scaling out swaps the hub implementation only.
- **No auth on the channel** — constraints + integration paths recorded in §2.5; full-app auth is #247.
- **No sqladmin-originated events** (§2.6).
- **No #6 client flow, no masters app, no cron/system writers** — they consume the channel for free (their origin types extend the envelope when they arrive).
- **No chat/presence/WS** — if needed later (chat #8), a parallel WS endpoint subscribes to the same hub.
- **Known SSE constraint, accepted:** one connection per tab, HTTP/1.1 caps ~6 connections per origin — admin realistically runs 1–3 tabs; headroom sufficient; HTTP/2 is the escape hatch if ever needed (recorded so future work knows it was considered).
- `docs/ARCHITECTURE.md:108-118` (the "no push channel" paragraph) is **rewritten** as part of this issue's DoD.

## 8. Definition of Done

- **FastAPI ≥0.140 upgrade task lands first** with the full backend suite (pytest) + e2e smoke green before any SSE code.
- Backend: hub unit tests (fanout, bounded-queue drop, no-publish-on-rollback, origin passthrough); entities completeness test (ALL transactional services); cascade-audit test (per-service `mark_changed` sets match §3.3); integration test — mutate via API (with and without `X-Memo-Tab-Id`) while streaming `/api/v1/events` via `httpx` ASGITransport + background frame reader — assert entity set + origin; ping/retry frames present.
- Frontend: unit tests for `INVALIDATION_MAP` (targets are real `qk` exports; keys mirror the backend list — drift guard), `invalidateEntities`, origin suppression rule, indicator component; all existing tests green through the ~10-file migration.
- E2E: scenarios 1–6 green (two browser contexts; `setOffline` outage simulation; backend from `scripts/e2e-shard-start.sh` supports streaming).
- `docs/ARCHITECTURE.md` cache-freshness section rewritten; no domain-rules changes (no entity semantics touched).
