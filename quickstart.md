# Quick Start

## Local development

Day-to-day development (deps, dev servers, tests): see [CONTRIBUTING.md](CONTRIBUTING.md). The dev seed provides demo accounts, so no console commands are needed there.

## Fresh installation (empty database)

The web UI requires a logged-in user, so the very first account is created from the console — the only user created outside the web app (see [docs/domain-rules/auth.md](docs/domain-rules/auth.md), *User lifecycle*):

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python -m src.cli create-user --phone "+79990000001" --role admin
# DATABASE_URL env var selects the database (default: local ./memo.db);
# the command prompts for the password twice (8–64 characters)
```

Then start the backend (`uv run uvicorn src.main:app`) and the frontend (`pnpm install && pnpm dev` from the repo root), and log in with the created phone + password. All further staff accounts are created from the web UI (staff card → «Учётка»).
