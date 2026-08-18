"""Verify pure_unit marker behavior and registration."""
import pytest


pytestmark = pytest.mark.pure_unit


def test_pure_unit_marker_recognized():
    """A test marked pure_unit runs as a pure_unit test."""
    assert True


def test_pure_unit_marker_registered_in_pyproject(request):
    """The pure_unit marker is registered in pyproject.toml.

    Reads the marker registration from pytest's own config
    (request.config.getini("markers"), populated from
    [tool.pytest.ini_options].markers in pyproject.toml) instead of
    shelling out to `uv run pytest --markers`. The subprocess approach
    broke in environments where `uv` is not on the PATH of the test
    runner (spawn fails with FileNotFoundError).
    """
    markers = request.config.getini("markers")
    assert any("pure_unit" in m for m in markers), (
        "pure_unit marker not registered in [tool.pytest.ini_options].markers"
    )
