# Production seed data (reference tables)

YAML templates for filling a fresh production database with the studio's
reference data, plus the loader that writes them in
(`backend/src/seed/reference.py`).

This is **not** the dev/demo seed (`backend/src/seed/seed.py`). That one
requires an empty DB and also creates demo activities, clients, records,
visits and payments. This loader writes reference rows only, is idempotent,
and is safe to re-run.

## Files

| File | What you fill |
|---|---|
| `locations.yaml` | studios: title, address, capacity, hint, image |
| `services.yaml` | services with nested tariffs, tags and material links |
| `materials.yaml` | material/technique dictionary referenced by services |
| `tags.yaml` | tag dictionary referenced by services, locations, masters |
| `staff.yaml` | employees, their positions, and the master (schedule) block |

Every file starts with a Russian field-by-field comment block — that is the
authoritative guidance for filling it. Values shipped here are the current
studio data taken from the dev seed: review them, do not assume they are
final.

## Rules the loader enforces

- Rows are matched by natural key: `title` (dictionaries, services,
  locations), `first_name + last_name` (staff). A re-run updates in place;
  renaming a title creates a new row — rename via the admin UI instead.
- Cross-references are **by title** (`tags`, `materials`, `positions`) and
  must exist in their dictionary file / in the DB.
- Unknown keys, wrong types, duplicate titles, `max_age < min_age`, a bad
  colour or an over-long specialty fail validation before anything is
  written.
- Tag / material / position link sets are synced exactly (the file is the
  source of truth). Tariffs present in the DB but absent from the file are
  left untouched and reported as a warning.
- One transaction: any error rolls the whole load back.
- The schema is never created — run migrations first.

## Runbook

From `backend/`:

```bash
uv run alembic upgrade head                        # schema (once)
uv run python -m src.seed.reference --check        # validate files, no DB
uv run python -m src.seed.reference --dry-run      # full load, rolled back
uv run python -m src.seed.reference                # real load
```

`DATABASE_URL` selects the database (default `sqlite+aiosqlite:///./memo.db`).
The first production admin is created separately, with a password prompt:

```bash
uv run python -m src.cli create-user --phone "+79990000001" --role admin
```

## Deliberately out of scope

- **Staff accounts** (`users` rows) — created through the admin UI or
  `create-user`; the file must never carry passwords.
- **Photos** (`photos` table) — not loaded yet; service/location images are
  plain `image_url` paths served by the web frontend
  (`frontend/web/public/images/...`).
- **Operational data** — activities, clients, records, visits, payments.
- **Positions `master`/`admin` and the `new_record` notify template** — seeded
  by migrations; the loader only verifies they exist.
