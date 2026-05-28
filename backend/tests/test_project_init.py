"""Tests for project initialization and structure."""

import importlib
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class TestDirectoryStructure:
    """Verify required directories exist."""

    @pytest.mark.parametrize(
        "directory",
        [
            "app",
            "app/core",
            "app/db",
            "app/domain",
            "tests",
        ],
    )
    def test_directory_exists(self, directory: str) -> None:
        path = BACKEND_ROOT / directory
        assert path.is_dir(), f"Missing directory: {path}"


class TestPyprojectToml:
    """Verify pyproject.toml exists and has required dependencies."""

    def test_pyproject_exists(self) -> None:
        path = BACKEND_ROOT / "pyproject.toml"
        assert path.is_file(), "pyproject.toml not found"

    def test_required_dependencies(self) -> None:
        import tomllib

        path = BACKEND_ROOT / "pyproject.toml"
        with open(path, "rb") as f:
            config = tomllib.load(f)

        deps = config.get("project", {}).get("dependencies", [])
        dep_names = [d.split(">=")[0].split("[")[0].strip() for d in deps]

        required = ["fastapi", "uvicorn", "sqlalchemy", "aiosqlite", "pydantic-settings"]
        for req in required:
            assert req in dep_names, f"Missing dependency: {req}"

    def test_dev_dependencies(self) -> None:
        import tomllib

        path = BACKEND_ROOT / "pyproject.toml"
        with open(path, "rb") as f:
            config = tomllib.load(f)

        dev_deps = (
            config.get("project", {}).get("optional-dependencies", {}).get("dev", [])
        )
        dev_dep_names = [d.split(">=")[0].split("[")[0].strip() for d in dev_deps]

        required_dev = ["pytest", "pytest-asyncio", "httpx", "ruff", "mypy"]
        for req in required_dev:
            assert req in dev_dep_names, f"Missing dev dependency: {req}"

    def test_ruff_configured(self) -> None:
        import tomllib

        path = BACKEND_ROOT / "pyproject.toml"
        with open(path, "rb") as f:
            config = tomllib.load(f)

        assert "tool" in config
        assert "ruff" in config["tool"], "Missing [tool.ruff] section"

    def test_mypy_configured(self) -> None:
        import tomllib

        path = BACKEND_ROOT / "pyproject.toml"
        with open(path, "rb") as f:
            config = tomllib.load(f)

        assert "tool" in config
        assert "mypy" in config["tool"], "Missing [tool.mypy] section"
        mypy = config["tool"]["mypy"]
        assert mypy.get("strict") is True, "mypy strict mode not enabled"


class TestAppFactory:
    """Verify the FastAPI application can be created."""

    def test_app_module_importable(self) -> None:
        mod = importlib.import_module("app.main")
        assert hasattr(mod, "create_app"), "app.main must export create_app()"

    def test_create_app_returns_fastapi(self) -> None:
        from fastapi import FastAPI

        from app.main import create_app

        app = create_app()
        assert isinstance(app, FastAPI)

    def test_health_endpoint(self) -> None:
        from fastapi.testclient import TestClient

        from app.main import create_app

        app = create_app()
        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
