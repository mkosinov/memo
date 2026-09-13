"""FilesService — avatar storage, the ONLY file infrastructure (GH #262 T2).

Spec §3.4 / domain-rules/profile.md «Avatar files»:

* ``save_avatar`` streams an :class:`~fastapi.UploadFile` to
  ``FILES_DIR/avatars`` — reads the first chunk, sniffs the magic bytes
  (stdlib, no new dep), streams to a ``.tmp-<hex>`` staging file with a
  5 MB byte cap, then ``os.replace``-publishes it under a server-side
  UUIDv4 + whitelisted extension (user input never reaches the path);
  every error path cleans the staging file up (no ``.tmp-*`` leftovers);
* ``delete_served`` unlinks a previously served avatar file — and ONLY
  that (a URL must start with the served avatar prefix; external URLs
  are a no-op, missing files are fine);
* ``content_length_rejected`` is the pre-read Content-Length precheck
  with ~64 KB multipart-overhead slack (a multipart body is slightly
  larger than the file it carries).

``settings.FILES_DIR`` is read at CALL time so tests (and per-tenant
deployments) can repoint the storage without re-creating the app.
"""

from __future__ import annotations

import os
import secrets
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from src.core.config import settings
from src.domain.errors import FileInvalidTypeError, FileTooLargeError
from src.util.file_type import sniff_image_extension

if TYPE_CHECKING:
    from fastapi import UploadFile

#: Public URL prefix under which avatars are served (StaticFiles mount).
AVATAR_URL_PREFIX = "/api/v1/files/avatar/"

#: Hard avatar limit (spec §3.4 — 5 MB).
MAX_AVATAR_BYTES = 5 * 1024 * 1024

#: Multipart overhead slack for the Content-Length precheck: the form
#: body wraps the file in headers/boundaries, so a few KB above the file
#: size is normal. Generous 64 KB — the stream cap stays the exact gate.
MP_SLACK_BYTES = 64 * 1024

#: Streaming chunk size (64 KB — same order as the slack, small enough
#: to abort an oversized upload quickly).
_CHUNK = 64 * 1024


class FilesService:
    """Avatar file storage (stateless — settings read per call)."""

    MP_SLACK_BYTES = MP_SLACK_BYTES

    @staticmethod
    def content_length_rejected(length: int) -> bool:
        """True when a declared Content-Length can never be a legal
        avatar upload (file over 5 MB even ignoring multipart overhead).
        """
        return length > MAX_AVATAR_BYTES + MP_SLACK_BYTES

    def _avatars_dir(self) -> Path:
        """``FILES_DIR/avatars`` (settings read at call time)."""
        return Path(settings.FILES_DIR) / "avatars"

    async def save_avatar(self, upload: UploadFile) -> str:
        """Store *upload* under a fresh UUIDv4 name; return its URL.

        Raises :class:`FileInvalidTypeError` (bad magic bytes) or
        :class:`FileTooLargeError` (stream over the 5 MB cap) — on every
        error path the staging file is removed and nothing is stored.
        """
        avatars = self._avatars_dir()
        avatars.mkdir(parents=True, exist_ok=True)

        # 1. First chunk → sniff magic bytes (filename is never trusted).
        first = await upload.read(_CHUNK)
        extension = sniff_image_extension(first)
        if extension is None:
            raise FileInvalidTypeError(
                f"uploaded file is not JPEG/PNG/WebP "
                f"(filename={upload.filename!r})"
            )

        # 2. Stream to a hidden staging file with the exact byte cap.
        tmp_path = avatars / f".tmp-{secrets.token_hex(8)}"
        try:
            written = 0
            with open(tmp_path, "wb") as fh:
                chunk = first
                while chunk:
                    written += len(chunk)
                    if written > MAX_AVATAR_BYTES:
                        raise FileTooLargeError(
                            f"avatar exceeds {MAX_AVATAR_BYTES} bytes "
                            f"while streaming"
                        )
                    fh.write(chunk)
                    chunk = await upload.read(_CHUNK)

            # 3. Publish atomically under the server-generated name.
            final_name = f"{uuid.uuid4()}.{extension}"
            os.replace(tmp_path, avatars / final_name)
        finally:
            # No-op when the replace succeeded; cleans up on every error.
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

        return f"{AVATAR_URL_PREFIX}{final_name}"

    def delete_served(self, url: str | None) -> bool:
        """Unlink a previously served avatar file; return whether it
        existed.

        ONLY URLs under the served avatar prefix are ever mapped to disk
        — external URLs (``https://…``) are a hard no-op, so a crafted
        ``avatar_url`` can never make the server delete an arbitrary
        path.
        """
        if not url or not url.startswith(AVATAR_URL_PREFIX):
            return False
        name = url[len(AVATAR_URL_PREFIX):]
        # Belt-and-suspenders: the prefix strip must leave a bare
        # filename, never anything path-shaped (uploads only ever create
        # uuid.ext names, but a hostile DB value must not traverse).
        if not name or "/" in name or "\\" in name or ".." in name:
            return False
        target = self._avatars_dir() / name
        if not target.is_file():
            return False
        target.unlink(missing_ok=True)
        return True


def get_files_service() -> FilesService:
    """Factory for FilesService (dependency-free constructor)."""
    return FilesService()
