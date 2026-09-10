"""GH #239 — SSE endpoint /api/v1/events integration tests (spec §3.2, §2.3, §2.9, §8).

Streams the REAL endpoint through the REAL app (middleware + routes + services
+ post-commit hub publish) using a raw-ASGI harness:

* ready frame — ``event: ready`` / ``data: {}`` / ``retry: 5000`` wire format
  (retry paces the browser's reconnect delay, spec §2.9);
* invalidate frames — JSON payload ``{"entities": [...], "origin": ...}`` with
  the entity set from a REAL API mutation and the origin envelope from
  ``X-Memo-Tab-Id`` (spec §2.4/§3.3);
* no ids / no replay — frames carry names only (spec §2.3);
* reads emit nothing — a GET mid-stream produces no invalidate frame;
* disconnect → unsubscribe (finally block, spec §3.2);
* SSE response headers — ``text/event-stream``, ``Cache-Control: no-cache``,
  ``X-Accel-Buffering: no`` (routing-native);
* lifespan shutdown drains the module-singleton hub (no leaked queues).

Why raw ASGI and NOT ``httpx.ASGITransport`` + ``client.stream()`` (spec §8
pattern): httpx 0.28.1's ``ASGITransport.handle_async_request`` awaits the
ASGI app call to COMPLETION before returning the ``Response`` — an infinite
SSE generator therefore deadlocks the reader and not a single byte surfaces.
The harness below drives the same ASGI interface (scope/receive/send) directly,
which streams incrementally; the mutation requests are plain bounded requests
and are awaited through the app as usual.
"""

import asyncio
import contextlib
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth.passwords import hash_password
from src.events.hub import hub
from tests.conftest import insert_user

pytestmark = pytest.mark.integration

_SSE_TIMEOUT = 5.0  # seconds — generous ceiling for frame delivery
_QUIET_WINDOW = 0.3  # seconds — no-frame observation window

# GH #247 T7: the SSE endpoint and the tag mutations it observes are now
# session-guarded — the raw-ASGI harness carries an admin cookie. Reported
# adaptation: fresh admin row + login per test (reset_db truncates users/
# sessions), Argon2 hash amortized at module scope.
_PASSWORD = "sse-admin-pass-1"


@pytest.fixture(scope="module")
def _admin_hash() -> str:
    return hash_password(_PASSWORD)


@pytest.fixture
def _sse_cookie(app, db_engine, _admin_hash) -> str:
    """``memo_session=<token>`` header value for a fresh admin login."""
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    insert_user(phone, _admin_hash, role="admin")

    client = TestClient(app)
    resp = client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": _PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    token = client.cookies.get("memo_session")
    assert token, "no memo_session cookie after login"
    client.close()
    return f"memo_session={token}"


def _http_scope(
    method: str,
    path: str,
    headers: list[tuple[bytes, bytes]],
    cookie: str | None = None,
) -> dict[str, Any]:
    extra = [(b"cookie", cookie.encode())] if cookie else []
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "scheme": "http",
        "query_string": b"",
        "headers": [(b"host", b"test"), *extra, *headers],
        "client": ("127.0.0.1", 123),
        "server": ("test", 80),
    }


async def _asgi_request(
    app: FastAPI,
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    headers: list[tuple[bytes, bytes]] | None = None,
    cookie: str | None = None,
) -> tuple[int, dict[bytes, bytes], bytes]:
    """Run ONE bounded request through the app (raw ASGI, httpx-transport style).

    Returns ``(status, headers, body)``. Safe to await directly — bounded
    responses complete on their own, unlike the SSE stream.
    """
    payload = json.dumps(json_body).encode() if json_body is not None else b""
    if json_body is not None:
        headers = [*(headers or []), (b"content-type", b"application/json")]
    else:
        headers = headers or []
    request_complete = False
    response_complete = asyncio.Event()
    status: int | None = None
    raw_headers: list[tuple[bytes, bytes]] = []
    body_parts: list[bytes] = []

    async def receive() -> dict[str, Any]:
        nonlocal request_complete
        if request_complete:
            await response_complete.wait()
            return {"type": "http.disconnect"}
        request_complete = True
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = message["status"]
            raw_headers.extend(message.get("headers", []))
        elif message["type"] == "http.response.body":
            body_parts.append(message.get("body", b""))
            if not message.get("more_body", False):
                response_complete.set()

    await app(_http_scope(method, path, headers, cookie), receive, send)
    assert status is not None
    return status, dict(raw_headers), b"".join(body_parts)


class SSEStream:
    """Background reader for the infinite SSE endpoint (raw-ASGI harness).

    Opens ``GET /api/v1/events`` as a concurrent task; ``bodies`` accumulates
    every response-body chunk as it is flushed. ``close()`` simulates a client
    disconnect (``http.disconnect``) and cancels the app task.
    """

    def __init__(self, app: FastAPI, cookie: str | None = None) -> None:
        self._app = app
        self._cookie = cookie
        self.bodies: list[bytes] = []
        self.status: int | None = None
        self.headers: dict[bytes, bytes] = {}
        self._started = asyncio.Event()
        self._disconnect = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> "SSEStream":
        self._task = asyncio.create_task(self._run())
        await asyncio.wait_for(self._started.wait(), timeout=_SSE_TIMEOUT)
        return self

    async def _run(self) -> None:
        request_complete = False

        async def receive() -> dict[str, Any]:
            nonlocal request_complete
            if request_complete:
                await self._disconnect.wait()
                return {"type": "http.disconnect"}
            request_complete = True
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                self.status = message["status"]
                self.headers = dict(message.get("headers", []))
                self._started.set()
            elif message["type"] == "http.response.body":
                if message.get("body"):
                    self.bodies.append(message["body"])

        await self._app(
            _http_scope("GET", "/api/v1/events", [], self._cookie), receive, send
        )

    def text(self) -> str:
        return b"".join(self.bodies).decode()

    async def wait_frame(self, needle: str, timeout: float = _SSE_TIMEOUT) -> None:
        """Poll until ``needle`` appears in the stream text (frame delivered)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if needle in self.text():
                return
            await asyncio.sleep(0.01)
        raise AssertionError(
            f"frame {needle!r} not delivered within {timeout}s; stream so far: {self.text()!r}"
        )

    async def assert_no_frame(self, needle: str, quiet: float = _QUIET_WINDOW) -> None:
        """Assert ``needle`` does NOT appear within the quiet window."""
        await asyncio.sleep(quiet)
        assert needle not in self.text(), f"unexpected frame {needle!r}; stream: {self.text()!r}"

    async def __aexit__(self, *exc_info: object) -> None:
        self._disconnect.set()
        assert self._task is not None
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task


async def _wait_subscribers_drop(baseline: int, timeout: float = _SSE_TIMEOUT) -> None:
    """Poll until the hub's subscriber count returns to ``baseline``."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if len(hub._subscribers) <= baseline:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"hub subscribers not drained: {len(hub._subscribers)} > {baseline}")


# ─── ready frame + response headers (spec §3.2, §2.9) ─────────────────────────


class TestReadyFrame:
    async def test_ready_frame_wire_format(self, app, _sse_cookie) -> None:
        """First frame: event ready, empty JSON object data, retry 5000."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            await stream.wait_frame("data: {}")
            await stream.wait_frame("retry: 5000")

    async def test_sse_response_headers(self, app, _sse_cookie) -> None:
        """Routing-native SSE headers on the wire."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            assert stream.status == 200
            content_type = stream.headers.get(b"content-type", b"").decode()
            assert content_type.startswith("text/event-stream")
            assert stream.headers.get(b"cache-control") == b"no-cache"
            assert stream.headers.get(b"x-accel-buffering") == b"no"


# ─── invalidate frames from real mutations (spec §3.3, §2.4) ──────────────────


class TestInvalidateFrames:
    async def test_mutation_emits_frame_with_origin(self, app, _sse_cookie) -> None:
        """POST with X-Memo-Tab-Id → invalidate frame with entities + origin."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            status, _, _ = await _asgi_request(
                app,
                "POST",
                "/api/v1/tags",
                json_body={"tag": f"sse-{uuid.uuid4().hex[:8]}"},
                headers=[(b"x-memo-tab-id", b"tab-1")],
                cookie=_sse_cookie,
            )
            assert status == 201
            await stream.wait_frame("event: invalidate")
            await stream.wait_frame('"entities": ["tags"]')
            await stream.wait_frame('"origin": {"type": "tab", "id": "tab-1"}')

    async def test_mutation_without_header_emits_null_origin(self, app, _sse_cookie) -> None:
        """POST without the tab header → external writer → origin null."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            status, _, _ = await _asgi_request(
                app,
                "POST",
                "/api/v1/tags",
                json_body={"tag": f"sse-{uuid.uuid4().hex[:8]}"},
                cookie=_sse_cookie,
            )
            assert status == 201
            await stream.wait_frame("event: invalidate")
            await stream.wait_frame('"entities": ["tags"]')
            await stream.wait_frame('"origin": null')

    async def test_no_event_id_no_replay_field(self, app, _sse_cookie) -> None:
        """Deliberately no event ids (spec §2.3): frames carry no ``id:`` line."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            status, _, _ = await _asgi_request(
                app,
                "POST",
                "/api/v1/tags",
                json_body={"tag": f"sse-{uuid.uuid4().hex[:8]}"},
                cookie=_sse_cookie,
            )
            assert status == 201
            await stream.wait_frame("event: invalidate")
            assert "\nid: " not in stream.text()


class TestReadsEmitNothing:
    async def test_get_requests_emit_no_invalidate_frame(self, app, _sse_cookie) -> None:
        """GETs never write — no invalidate frame, even with a tab header."""
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            status, _, _ = await _asgi_request(app, "GET", "/api/v1/tags", cookie=_sse_cookie)
            assert status == 200
            status, _, _ = await _asgi_request(
                app,
                "GET",
                "/api/v1/tags",
                headers=[(b"x-memo-tab-id", b"tab-9")],
                cookie=_sse_cookie,
            )
            assert status == 200
            await stream.assert_no_frame("event: invalidate")


# ─── disconnect → unsubscribe (spec §3.2) ──────────────────────────────────────


class TestDisconnectUnsubscribes:
    async def test_disconnect_removes_hub_subscriber(self, app, _sse_cookie) -> None:
        """Client disconnect → generator finally → hub.unsubscribe."""
        baseline = len(hub._subscribers)
        async with SSEStream(app, _sse_cookie) as stream:
            await stream.wait_frame("event: ready")
            assert len(hub._subscribers) == baseline + 1
        await _wait_subscribers_drop(baseline)


# ─── lifespan shutdown drains the hub (no leaked queues across tests) ─────────


class TestLifespanDrainsHub:
    async def test_shutdown_clears_subscribers(self, app) -> None:
        """Lifespan exit drains the module-singleton hub."""
        from src.main import lifespan

        q = hub.subscribe()
        try:
            async with lifespan(app):
                assert q in hub._subscribers
            assert q not in hub._subscribers
        finally:
            hub.unsubscribe(q)


# ─── static source audit (router registration + unsubscribe in finally) ───────


class TestRouterSourceAudit:
    def test_router_registered_under_api_v1(self) -> None:
        src = (Path(__file__).resolve().parents[1] / "src" / "main.py").read_text()
        assert 'include_router(events_router, prefix="/api/v1")' in src

    def test_unsubscribe_in_finally(self) -> None:
        router_src = (
            Path(__file__).resolve().parents[1] / "src" / "events" / "router.py"
        ).read_text()
        assert "finally:" in router_src
        assert "hub.unsubscribe" in router_src
