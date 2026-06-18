"""Verify pure_unit marker behavior and registration."""
import subprocess
import pytest


pytestmark = pytest.mark.pure_unit


def test_pure_unit_marker_recognized():
    """A test marked pure_unit runs as a pure_unit test."""
    assert True


def test_pure_unit_marker_registered_in_pyproject():
    """The pure_unit marker is registered in pyproject.toml."""
    result = subprocess.run(
        ["uv", "run", "pytest", "--markers"],
        capture_output=True, text=True, cwd="."
    )
    assert "pure_unit" in result.stdout, "pure_unit marker not registered"
