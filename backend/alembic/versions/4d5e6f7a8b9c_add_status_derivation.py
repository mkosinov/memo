"""Re-map visit/record statuses to VisitStatus enum (waiting/visited/missed/cancelled).

Revision ID: 4d5e6f7a8b9c
Revises: 448bdcc2a6a7
Create Date: 2026-06-20 19:05:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d5e6f7a8b9c'
down_revision: Union[str, Sequence[str], None] = '448bdcc2a6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mapping from Wave 5 RecordStatus to VisitStatus
OLD_TO_NEW = {
    "pending": "waiting",
    "confirmed": "visited",
    "cancelled": "cancelled",
    "no_show": "missed",
}


def upgrade() -> None:
    """Re-map visit/record statuses to VisitStatus enum.

    Idempotent: only updates rows with old values.
    """
    # Step 1: re-map visits.status if it still uses old values
    for old, new in OLD_TO_NEW.items():
        op.execute(
            f"UPDATE visits SET status = '{new}' WHERE status = '{old}'"
        )

    # Step 2: re-compute records.status from visits
    # Priority: any visited > all missed > all cancelled > waiting

    # 2a: records with at least 1 active 'visited' visit → 'visited'
    op.execute("""
        UPDATE records SET status = 'visited'
        WHERE EXISTS (
            SELECT 1 FROM visits
            WHERE visits.record_id = records.id
              AND visits.status = 'visited'
              AND visits.is_active = 1
        )
    """)

    # 2b: records with no 'visited' but all active visits are 'missed' → 'missed'
    op.execute("""
        UPDATE records SET status = 'missed'
        WHERE id IN (
            SELECT r.id FROM records r
            WHERE NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'visited'
                  AND v.is_active = 1
            )
            AND EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'missed'
                  AND v.is_active = 1
            )
            AND NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status NOT IN ('missed')
                  AND v.is_active = 1
            )
        )
    """)

    # 2c: records with no 'visited'/'missed' but all active visits are 'cancelled' → 'cancelled'
    op.execute("""
        UPDATE records SET status = 'cancelled'
        WHERE id IN (
            SELECT r.id FROM records r
            WHERE NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status IN ('visited', 'missed')
                  AND v.is_active = 1
            )
            AND EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'cancelled'
                  AND v.is_active = 1
            )
        )
    """)

    # 2d: records with 0 active visits or still using old values → 'waiting' (default)
    op.execute("""
        UPDATE records SET status = 'waiting'
        WHERE status NOT IN ('waiting', 'visited', 'missed', 'cancelled')
    """)


def downgrade() -> None:
    # No-op: re-mapping is one-way; downgrade is not meaningful.
    pass
