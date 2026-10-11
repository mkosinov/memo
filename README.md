# Memo Project

Memo is a management platform for art studios.

## Quick Start

See [quickstart.md](quickstart.md): local development and fresh-installation setup (migrations, creating the first admin via the CLI).

## API-first integration

Our architecture employs an **API-first** approach, ensuring a robust connection between the frontend and backend through a type-safe layer:

- **Clean Architecture:** Backend utilizes FastAPI with service/repository separation.
- **API Client:** Shared `@memo/api-client` package provides consistent interaction with `/api/v1/` endpoints.
- **Data Fetching:** Frontend leverages **React Query** for efficient caching, invalidation, and state synchronization.
- **Mapper Pattern:** Data from the backend is transformed into View Models using dedicated mapper functions, decoupling the API schema from the UI layer.
