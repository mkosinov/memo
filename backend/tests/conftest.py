"""Shared test fixtures and configuration."""

import os

# Test settings — must be set before any app imports (conftest runs first).
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["TESTING"] = "True"
