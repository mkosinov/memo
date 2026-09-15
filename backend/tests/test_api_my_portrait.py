"""GH #262 Task 2 — POST /api/v1/my/portrait + public avatar serving.

Covers the plan RED list (spec §3.4, D5/D8; domain-rules/profile.md
«Avatar files»):

* Content-Length precheck: >5 MB → 413 FILE_TOO_LARGE BEFORE reading the
  body (oversized junk with INVALID magic must still yield 413 — proof
  the precheck runs before the sniff; a 415 would mean it ran too late);
* streaming cap: valid JPEG header + >5 MB payload with Content-Length
  under the precheck threshold+slack → 413 via the byte cap;
* magic-byte typing: JPEG/PNG/WebP accepted, renamed/foreign → 415
  FILE_INVALID_TYPE; NO ``.tmp-*`` leftovers and no new files in the
  avatars dir on ANY error path;
* stored name = UUIDv4 + whitelist extension (regex);
* success → session user's staff card ``avatar_url`` =
  ``/api/v1/files/avatar/<uuid>.<ext>`` (DB assert); previous OWN served
  file deleted (2nd upload: 1st file gone); external URLs untouched;
* no session → 401;
* ``GET /api/v1/files/avatar/<uuid>.jpg`` public 200 with
  ``X-Content-Type-Options: nosniff``; encoded traversal → 404;
* upload without a staff card → 422 (portrait is card-bound);
* SSE: successful upload emits the EXISTING ``staff`` entity.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest

from src.auth.passwords import hash_password
from src.events.hub import hub
from tests.conftest import query_db

pytestmark = pytest.mark.api

MY_PASSWORD = "my-pass-123"

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64

MAX_BYTES = 5 * 1024 * 1024
SLACK = 64 * 1024  # mirror of FilesService.MP_SLACK_BYTES

_UUID_EXT_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"\.(jpg|png|webp)$"
)

AVATARS_DIR = Path(os.environ["FILES_DIR"]) / "avatars"


@pytest.fixture(scope="module")
def _my_hash() -> str:
    """Hash the test password once per module (Argon2 is slow)."""
    return hash_password(MY_PASSWORD)


@pytest.fixture(autouse=True)
def _clean_avatars_dir():
    """Fresh avatars dir per test — error-path leftovers never leak
    between tests."""
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    for entry in AVATARS_DIR.iterdir():
        if entry.is_file():
            entry.unlink()
    yield
    for entry in AVATARS_DIR.iterdir():
        if entry.is_file():
            entry.unlink()


@pytest.fixture
def anon(app, db_engine):
    """Unauthenticated TestClient (401 / public-serving probes)."""
    from fastapi.testclient import TestClient

    client = TestClient(app)
    yield client
    client.close()


@pytest.fixture
def subscriber():
    """Subscribe to the SSE hub for ONE test; drain on exit."""
    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


def _drain(q) -> list[tuple[set[str], object]]:
    events: list[tuple[set[str], object]] = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


def _make_staff_user(api_client, login_as, _my_hash, *, role: str = "master"):
    """Create a staff card + linked login. Returns ``(client, staff_id)``."""
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    resp = api_client.post(
        "/api/v1/staff",
        json={
            "first_name": "Мария",
            "last_name": "Иванова",
            "master": {"specialty": "живопись", "color": "#5B8C7A"},
        },
    )
    assert resp.status_code == 201, resp.text
    staff_id = resp.json()["id"]
    from tests.conftest import insert_user

    insert_user(phone, _my_hash, role=role, master_id=staff_id)
    return login_as(phone, MY_PASSWORD), staff_id


def _make_cardless_user(login_as, _my_hash, *, role: str = "admin"):
    """A user with NO staff card (the modal hides the portrait row)."""
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    from tests.conftest import insert_user

    insert_user(phone, _my_hash, role=role)
    return login_as(phone, MY_PASSWORD)


def _upload(client, data: bytes, filename: str = "portrait.jpg"):
    return client.post(
        "/api/v1/my/portrait",
        files={"file": (filename, data, "application/octet-stream")},
    )


def _stored_files() -> list[str]:
    return sorted(p.name for p in AVATARS_DIR.iterdir())


def _staff_avatar(staff_id: str) -> str | None:
    rows = query_db(
        f"SELECT avatar_url FROM staff WHERE id = '{staff_id}'"
    )
    assert len(rows) == 1
    return rows[0]["avatar_url"]


# ─── Content-Length precheck (413 BEFORE reading the body) ─────────────────────


class TestContentLengthPrecheck:
    def test_oversized_invalid_magic_yields_413_not_415(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Order proof: CL > 5MB + slack with INVALID magic bytes must be
        FILE_TOO_LARGE (413) — a 415 would mean the sniff ran before the
        precheck (the body would have been read)."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, b"MZ\x90\x00" + b"\x00" * (MAX_BYTES + SLACK + 1))
        assert resp.status_code == 413, resp.text
        assert resp.json()["detail"]["code"] == "FILE_TOO_LARGE"
        assert _stored_files() == []

    def test_streaming_cap_413(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Valid JPEG header + >5MB payload, CL under the precheck
        threshold+slack → the STREAM byte cap fires → 413."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        payload = JPEG + b"\x00" * (MAX_BYTES + 1)
        assert len(payload) <= MAX_BYTES + SLACK  # precheck must NOT fire
        resp = _upload(client, payload)
        assert resp.status_code == 413, resp.text
        assert resp.json()["detail"]["code"] == "FILE_TOO_LARGE"
        # No .tmp leftovers, nothing stored.
        assert _stored_files() == []


# ─── Magic-byte typing (415) ───────────────────────────────────────────────────


class TestMagicByteTyping:
    def test_renamed_exe_rejected_415(self, api_client, login_as, _my_hash) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, b"MZ\x90\x00" + b"\x00" * 32, "evil.jpg")
        assert resp.status_code == 415, resp.text
        assert resp.json()["detail"]["code"] == "FILE_INVALID_TYPE"
        assert _stored_files() == []

    def test_gif_rejected_415(self, api_client, login_as, _my_hash) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, b"GIF89a" + b"\x00" * 32, "anim.gif")
        assert resp.status_code == 415
        assert _stored_files() == []

    @pytest.mark.parametrize(
        ("data", "filename", "ext"),
        [
            (JPEG, "portrait.jpg", "jpg"),
            (PNG, "portrait.png", "png"),
            (WEBP, "portrait.webp", "webp"),
        ],
    )
    def test_all_types_accepted(
        self, api_client, login_as, _my_hash, data, filename, ext
    ) -> None:
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, data, filename)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == {"avatar_url"}
        assert body["avatar_url"].startswith("/api/v1/files/avatar/")
        stored = _stored_files()
        assert len(stored) == 1
        assert _UUID_EXT_RE.match(stored[0]), stored
        assert stored[0].endswith(f".{ext}")
        assert body["avatar_url"].endswith(stored[0])
        assert _staff_avatar(staff_id) == body["avatar_url"]


# ─── Success path: DB write, previous-file cleanup ─────────────────────────────


class TestSuccessPath:
    def test_avatar_url_written_to_staff_card(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, JPEG)
        assert resp.status_code == 200, resp.text
        avatar_url = resp.json()["avatar_url"]
        assert _staff_avatar(staff_id) == avatar_url
        # /my reflects the new avatar too.
        assert client.get("/api/v1/my").json()["avatar_url"] == avatar_url

    def test_second_upload_deletes_previous_own_file(
        self, api_client, login_as, _my_hash
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        first = _upload(client, JPEG).json()["avatar_url"]
        assert len(_stored_files()) == 1

        second = _upload(client, PNG, "p.png").json()["avatar_url"]
        stored = _stored_files()
        assert len(stored) == 1, "old file must be deleted, exactly one kept"
        assert stored[0] == second.rsplit("/", 1)[1]
        assert first != second

    def test_external_previous_url_not_deleted(
        self, api_client, login_as, _my_hash, tmp_path
    ) -> None:
        """An external https://… avatar_url is never touched on disk."""
        client, staff_id = _make_staff_user(api_client, login_as, _my_hash)
        external_file = tmp_path / "external.jpg"
        external_file.write_bytes(JPEG)
        external_url = "https://cdn.example.com/face.jpg"
        query_db(
            f"UPDATE staff SET avatar_url = '{external_url}' "
            f"WHERE id = '{staff_id}'"
        )
        resp = _upload(client, JPEG)
        assert resp.status_code == 200, resp.text
        assert external_file.exists()  # nothing outside FILES_DIR touched
        assert _staff_avatar(staff_id) == resp.json()["avatar_url"]

    def test_get_serving_after_upload(
        self, api_client, login_as, _my_hash, anon
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = _upload(client, JPEG)
        assert resp.status_code == 200, resp.text
        avatar_url = resp.json()["avatar_url"]

        served = anon.get(avatar_url)
        assert served.status_code == 200, served.text
        assert served.content == JPEG
        assert served.headers["x-content-type-options"] == "nosniff"
        assert served.headers["content-type"] == "image/jpeg"


# ─── Auth / card guards ────────────────────────────────────────────────────────


class TestGuards:
    def test_no_session_401(self, anon) -> None:
        resp = anon.post(
            "/api/v1/my/portrait",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
        )
        assert resp.status_code == 401

    def test_cross_site_fetch_rejected(
        self, api_client, login_as, _my_hash
    ) -> None:
        """Mutating multipart route carries verify_fetch_metadata."""
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        resp = client.post(
            "/api/v1/my/portrait",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
            headers={"sec-fetch-site": "cross-site"},
        )
        assert resp.status_code == 403

    def test_cardless_user_422(self, login_as, _my_hash) -> None:
        """Portrait is card-bound: no staff card → 422, modal hides it."""
        client = _make_cardless_user(login_as, _my_hash)
        resp = _upload(client, JPEG)
        assert resp.status_code == 422, resp.text
        assert _stored_files() == []


# ─── Public serving ────────────────────────────────────────────────────────────


class TestPublicServing:
    def test_public_200_with_nosniff(self, anon) -> None:
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4()}.jpg"
        (AVATARS_DIR / name).write_bytes(JPEG)
        resp = anon.get(f"/api/v1/files/avatar/{name}")
        assert resp.status_code == 200, resp.text
        assert resp.content == JPEG
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["content-type"] == "image/jpeg"

    def test_content_type_by_extension(self, anon) -> None:
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        for name, ctype in (
            (f"{uuid.uuid4()}.png", "image/png"),
            (f"{uuid.uuid4()}.webp", "image/webp"),
        ):
            (AVATARS_DIR / name).write_bytes(JPEG)
            resp = anon.get(f"/api/v1/files/avatar/{name}")
            assert resp.status_code == 200
            assert resp.headers["content-type"] == ctype

    def test_encoded_traversal_404(self, anon) -> None:
        resp = anon.get(
            "/api/v1/files/avatar/%2e%2e%2f%2e%2e%2fetc%2fpasswd"
        )
        assert resp.status_code == 404

    def test_missing_file_404(self, anon) -> None:
        resp = anon.get(f"/api/v1/files/avatar/{uuid.uuid4()}.jpg")
        assert resp.status_code == 404


# ─── SSE emit (existing `staff` entity) ────────────────────────────────────────


class TestSseEmit:
    def test_upload_emits_existing_staff_entity(
        self, api_client, login_as, _my_hash, subscriber
    ) -> None:
        client, _sid = _make_staff_user(api_client, login_as, _my_hash)
        _drain(subscriber)  # discard setup events (card/section writes)
        resp = _upload(client, JPEG)
        assert resp.status_code == 200, resp.text

        events = _drain(subscriber)
        entities = {entity for es, _origin in events for entity in es}
        assert "staff" in entities
        assert "user_profiles" not in entities
