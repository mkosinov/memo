"""GH #262 Task 2 — magic-byte image sniffing (pure unit, stdlib only).

Spec §3.4 / domain-rules/profile.md: the avatar type check reads MAGIC
BYTES of the first chunk — JPEG ``FF D8 FF``, PNG 8-byte signature,
WebP ``RIFF….WEBP`` — never the client-supplied filename/extension.
"""

import pytest

from src.util.file_type import sniff_image_extension

pytestmark = [pytest.mark.unit, pytest.mark.pure_unit]

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 L"


class TestSniffImageExtension:
    @pytest.mark.parametrize(
        ("data", "expected"),
        [
            (JPEG, "jpg"),
            (PNG, "png"),
            (WEBP, "webp"),
        ],
    )
    def test_supported_magic_detected(self, data: bytes, expected: str) -> None:
        assert sniff_image_extension(data) == expected

    def test_minimal_jpeg_prefix(self) -> None:
        """Three magic bytes are enough for JPEG."""
        assert sniff_image_extension(b"\xff\xd8\xff") == "jpg"

    @pytest.mark.parametrize(
        "data",
        [
            b"",                       # empty
            b"\xff\xd8",               # truncated JPEG magic
            b"GIF89a" + b"\x00" * 10,  # foreign format
            b"%PDF-1.7",               # document, not an image
            b"RIFF\x24\x00\x00\x00WAVE",  # RIFF container that is NOT webp
            b"\x89PNG",                # truncated PNG signature
        ],
    )
    def test_unsupported_returns_none(self, data: bytes) -> None:
        assert sniff_image_extension(data) is None

    def test_renamed_png_still_sniffs_png(self) -> None:
        """A PNG named ``.jpg`` is a PNG — the filename never matters."""
        assert sniff_image_extension(PNG) == "png"
