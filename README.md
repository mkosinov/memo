# Memo Project

Memo is a management platform for art studios.

## Quick Start

Day-to-day development (deps, dev servers, tests): see [CONTRIBUTING.md](CONTRIBUTING.md). The dev seed provides demo accounts, so no console commands are needed there.

### Fresh installation (empty database)

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

## API-first integration

Our architecture employs an **API-first** approach, ensuring a robust connection between the frontend and backend through a type-safe layer:

- **Clean Architecture:** Backend utilizes FastAPI with service/repository separation.
- **API Client:** Shared `@memo/api-client` package provides consistent interaction with `/api/v1/` endpoints.
- **Data Fetching:** Frontend leverages **React Query** for efficient caching, invalidation, and state synchronization.
- **Mapper Pattern:** Data from the backend is transformed into View Models using dedicated mapper functions, decoupling the API schema from the UI layer.
