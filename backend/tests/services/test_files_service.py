"""GH #262 Task 2 — FilesService unit tests (tmp FILES_DIR, no app).

Pinned architecture (plan T2): ``save_avatar`` streams an UploadFile to
``FILES_DIR/avatars`` under a UUIDv4 name + sniffed extension (5 MB byte
cap, ``.tmp-<hex>`` staging with finally-cleanup); ``delete_served``
unlinks ONLY files under the served avatar prefix and never touches
external URLs; ``content_length_rejected`` is the pre-read CL precheck
with multipart-overhead slack.

Spec §3.4 / domain-rules/profile.md «Avatar files».
"""

from __future__ import annotations

import io
import re
import uuid
from typing import TYPE_CHECKING

import pytest
from fastapi import UploadFile

from src.domain.errors import FileInvalidTypeError, FileTooLargeError
from src.services.files import FilesService

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32

_UUID_EXT_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"\.(jpg|png|webp)$"
)

MAX_BYTES = 5 * 1024 * 1024
#: The precheck rejects CL above MAX + slack (~64 KB multipart overhead).
SLACK = FilesService.MP_SLACK_BYTES


def _upload(data: bytes, filename: str = "portrait.jpg") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=filename)


@pytest.fixture
def files_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point settings.FILES_DIR at a tmp dir (read at CALL time)."""
    from src.core.config import settings

    monkeypatch.setattr(settings, "FILES_DIR", str(tmp_path))
    avatars = tmp_path / "avatars"
    avatars.mkdir()
    return avatars


def _stored(avatars: Path) -> list[str]:
    return sorted(p.name for p in avatars.iterdir())


class TestSaveAvatar:
    async def test_stores_uuid_name_with_sniffed_ext(
        self, files_dir: Path
    ) -> None:
        url = await FilesService().save_avatar(_upload(PNG, "portrait.jpg"))
        # Renamed file: sniffed PNG wins over the .jpg filename.
        assert url.startswith("/api/v1/files/avatar/")
        stored = _stored(files_dir)[0]
        assert _UUID_EXT_RE.match(stored), stored
        assert stored.endswith(".png")
        assert url.endswith(stored)

    async def test_all_three_types_accepted(self, files_dir: Path) -> None:
        service = FilesService()
        for data, ext in ((JPEG, "jpg"), (PNG, "png"), (WEBP, "webp")):
            url = await service.save_avatar(_upload(data, f"x.{ext}"))
            assert url.endswith(f".{ext}"), url

    async def test_unique_uuid_names(self, files_dir: Path) -> None:
        service = FilesService()
        first = await service.save_avatar(_upload(JPEG))
        second = await service.save_avatar(_upload(JPEG))
        assert first != second
        assert len(_stored(files_dir)) == 2

    async def test_invalid_magic_rejected_415_no_leftovers(
        self, files_dir: Path
    ) -> None:
        with pytest.raises(FileInvalidTypeError):
            await FilesService().save_avatar(
                _upload(b"MZ\x90\x00renamed.exe", "evil.jpg")
            )
        assert _stored(files_dir) == []

    async def test_stream_cap_over_5mb_rejected(
        self, files_dir: Path
    ) -> None:
        """Valid JPEG header + >5 MB payload, no CL precheck involved —
        the STREAM cap fires → 413, nothing stored, no .tmp leftovers."""
        payload = JPEG + b"\x00" * (MAX_BYTES + 1)
        with pytest.raises(FileTooLargeError):
            await FilesService().save_avatar(_upload(payload))
        assert _stored(files_dir) == []

    async def test_exactly_5mb_accepted(self, files_dir: Path) -> None:
        payload = JPEG + b"\x00" * (MAX_BYTES - len(JPEG))
        url = await FilesService().save_avatar(_upload(payload))
        assert url.endswith(".jpg")

    async def test_sniff_failure_mid_stream_leaves_no_tmp(
        self, files_dir: Path
    ) -> None:
        """Empty upload → sniff fails → finally-cleanup, no .tmp files."""
        with pytest.raises(FileInvalidTypeError):
            await FilesService().save_avatar(_upload(b"", "empty.jpg"))
        assert _stored(files_dir) == []


class TestDeleteServed:
    def test_removes_own_served_file(self, files_dir: Path) -> None:
        url = "/api/v1/files/avatar/" + str(uuid.uuid4()) + ".jpg"
        target = files_dir / url.rsplit("/", 1)[1]
        target.write_bytes(JPEG)
        assert FilesService().delete_served(url) is True
        assert not target.exists()

    def test_missing_file_is_ok(self, files_dir: Path) -> None:
        url = "/api/v1/files/avatar/" + str(uuid.uuid4()) + ".jpg"
        assert FilesService().delete_served(url) is False

    def test_external_url_noop(self, files_dir: Path, tmp_path: Path) -> None:
        """An https://… URL never maps to disk — nothing touched."""
        external = tmp_path / "external.jpg"
        external.write_bytes(JPEG)
        assert FilesService().delete_served("https://cdn.example.com/x.jpg") is False
        assert external.exists()

    def test_relative_and_traversal_urls_noop(self, files_dir: Path) -> None:
        for url in ("/other/x.jpg", "../etc/passwd", "avatar/x.jpg", None):
            assert FilesService().delete_served(url) is False  # type: ignore[arg-type]


class TestContentLengthRejected:
    def test_rejects_over_5mb_plus_slack(self) -> None:
        assert FilesService().content_length_rejected(MAX_BYTES + SLACK + 1)

    def test_accepts_5mb_plus_slack(self) -> None:
        assert not FilesService().content_length_rejected(MAX_BYTES + SLACK)

    def test_accepts_normal_sizes(self) -> None:
        for length in (0, 1, 1024, MAX_BYTES):
            assert not FilesService().content_length_rejected(length)
