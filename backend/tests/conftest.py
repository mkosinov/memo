"""Shared test fixtures and configuration."""

import os

# Use in-memory SQLite for all tests — must be set before any app creation.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
