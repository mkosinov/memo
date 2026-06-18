#!/usr/bin/env bash
# Recreate the dev memo.db from scratch using alembic migrations.
# Use when the DB has drifted from the model schema.
#
# Usage: ./scripts/recreate_dev_db.sh
#
# WARNING: This DROPS the existing memo.db. All data is lost.
# For production, use proper alembic upgrade path instead.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f memo.db ]; then
    BACKUP="memo.db.bak.$(date +%Y%m%d%H%M%S)"
    echo "Backing up existing memo.db → $BACKUP"
    cp memo.db "$BACKUP"
    rm memo.db
fi

echo "Running alembic upgrade head..."
uv run alembic upgrade head

if [ -d src/seed ]; then
    echo "Seeding dev data..."
    uv run python -m src.seed.seed || echo "Seed step failed or skipped (DB is usable without it)"
fi

HEAD=$(uv run alembic current 2>/dev/null | tail -1)
echo "Done. New memo.db created. Current head: $HEAD"
echo "Backup of old DB (if any) is in backend/ as memo.db.bak.*"
