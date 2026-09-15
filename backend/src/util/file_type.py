"""Magic-byte image sniffing for avatar uploads (GH #262 Task 2, spec §3.4).

stdlib only — no new dependency. The client-supplied filename/extension
is NEVER trusted: the stored extension comes from these magic bytes
(JPEG ``FF D8 FF``, PNG 8-byte signature, WebP ``RIFF….WEBP``).
"""

from __future__ import annotations

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_RIFF_SIGNATURE = b"RIFF"
_WEBP_TAG = b"WEBP"


def sniff_image_extension(data: bytes) -> str | None:
    """Return ``"jpg" | "png" | "webp"`` by magic bytes, else ``None``.

    Needs only the first bytes of the stream (the service sniffs the
    first chunk as soon as it is read — before the rest is streamed).
    """
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(_PNG_SIGNATURE):
        return "png"
    if (
        len(data) >= 12
        and data.startswith(_RIFF_SIGNATURE)
        and data[8:12] == _WEBP_TAG
    ):
        return "webp"
    return None
