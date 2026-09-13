"""Staff restructuring #266: masters → staff + master extension + positions.

Spec: docs/specs/2026-09-10-staff-restructuring-design.md («Миграция», шаги 1–7).

Chain (SQLite, batch mode):
1. Rename ``masters`` → ``staff`` (ids and rows preserved).
2. Create new ``masters`` extension (staff_id PK+FK CASCADE, specialty,
   color, is_active) — one row per former master, incl. archived.
3. Create ``positions`` (built-ins master/admin + user-defined seed «СММ»).
4. Create ``staff_positions`` M2M; former «мастер» → master,
   «администратор» -> admin (data audit step 0 confirmed only these values).
5. ``users``: drop the legacy unnamed unique on master_id, rename column →
   staff_id, FK → staff, named unique — one batch block.
6. ``activities`` / ``master_tags``: retarget FKs to new masters.staff_id.
7. ``user_settings``: column_order_masters → column_order_staff.

No downgrade (project practice): restore = roll back the dev file copy.
"""
# ruff: noqa: RUF001, RUF002 -- Cyrillic text is intentional (Russian language app)
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision = 'e5f7a9c3b1d8'
down_revision = '91069ac9acba'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Project recipe (cf. b7c8d9e0f1a2): deterministic names for the
# originally-unnamed constraints inside batch_alter_table on SQLite.
# NOTE: deliberately WITHOUT %(referred_table_name)s in the fk pattern —
# SQLite >= 3.25 auto-rewrites FK references on ALTER TABLE RENAME (masters
# → staff happens in step 1), which would change the reflected referred
# table and thus the convention-generated name mid-flight.
FK_NAMING_CONVENTION = {
    'fk': 'fk_%(table_name)s_%(column_0_name)s',
    'uq': 'uq_%(table_name)s_%(column_0_name)s',
}


def upgrade():
    conn = op.get_bind()

    # ── 1. Rename masters → staff (ids preserved) ─────────────────────────
    op.rename_table('masters', 'staff')

    # ── 2. New masters extension table ────────────────────────────────────
    op.create_table(
        'masters',
        sa.Column('staff_id', sa.String(length=36), nullable=False),
        sa.Column('specialty', sa.Text(), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['staff_id'], ['staff.id'], ondelete='CASCADE',
            name='fk_masters_staff_id_staff',
        ),
        sa.PrimaryKeyConstraint('staff_id'),
    )
    # One row per former master (incl. archived): carry over specialty,
    # color and the row's own is_active (D3 — distribution flag).
    conn.execute(sa.text(
        "INSERT INTO masters (staff_id, specialty, color, is_active,"
        " created_at, updated_at) "
        "SELECT id, specialty, color, is_active, created_at, updated_at"
        " FROM staff"
    ))

    # ── 3. positions dictionary ───────────────────────────────────────────
    op.create_table(
        'positions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    # Populate ONLY when data is being migrated (pre-restructuring rows
    # exist). On a fresh empty install the dictionary stays empty: seed.py
    # owns fresh-stack data (smoke path: alembic upgrade head → seed must
    # not collide on the position PKs).
    _has_staff_rows = conn.execute(sa.text('SELECT 1 FROM staff LIMIT 1')).first()
    if _has_staff_rows:
        conn.execute(sa.text(
            "INSERT INTO positions (id, title, is_system, created_at, updated_at)"
            " VALUES ('master', 'Мастер', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),"
            "        ('admin', 'Администратор', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),"
            "        ('smm', 'СММ', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))

    # ── 4. staff_positions M2M from old position strings ──────────────────
    op.create_table(
        'staff_positions',
        sa.Column('staff_id', sa.String(length=36), nullable=False),
        sa.Column('position_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ['staff_id'], ['staff.id'], ondelete='CASCADE',
            name='fk_staff_positions_staff_id_staff',
        ),
        sa.ForeignKeyConstraint(
            ['position_id'], ['positions.id'], ondelete='CASCADE',
            name='fk_staff_positions_position_id_positions',
        ),
        sa.PrimaryKeyConstraint('staff_id', 'position_id'),
    )
    conn.execute(sa.text(
        "INSERT INTO staff_positions (staff_id, position_id) "
        "SELECT id, 'master' FROM staff WHERE position = 'мастер'"
    ))
    conn.execute(sa.text(
        "INSERT INTO staff_positions (staff_id, position_id) "
        "SELECT id, 'admin' FROM staff WHERE position = 'администратор'"
    ))

    # ── 5. users: master_id → staff_id, FK staff, named unique ────────────
    # NOTE: three separate batch blocks — alembic's SQLite batch mode emits
    # create_* DDL against the PRE-rename column set, so a rename and a
    # create in one block silently drops the new constraint (verified
    # empirically; drop+create alone, without a rename, is safe in one).
    with op.batch_alter_table(
        'users', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        # Drop the legacy unnamed UniqueConstraint (sqlite_autoindex on
        # master_id) and FK via the convention-named aliases.
        batch_op.drop_constraint('uq_users_master_id', type_='unique')
        batch_op.drop_constraint('fk_users_master_id', type_='foreignkey')
    with op.batch_alter_table(
        'users', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column('master_id', new_column_name='staff_id')
    with op.batch_alter_table(
        'users', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.create_foreign_key(
            'fk_users_staff_id_staff', 'staff', ['staff_id'], ['id'],
        )
        batch_op.create_unique_constraint('uq_users_staff_id', ['staff_id'])

    # ── 6. activities / master_tags: FK → new masters.staff_id ────────────
    with op.batch_alter_table(
        'activities', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint('fk_activities_master_id', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_activities_master_id_masters', 'masters',
            ['master_id'], ['staff_id'],
        )

    with op.batch_alter_table(
        'master_tags', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint('fk_master_tags_master_id', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_master_tags_master_id_masters', 'masters',
            ['master_id'], ['staff_id'], ondelete='CASCADE',
        )

    # ── 7. user_settings: column rename, data preserved ───────────────────
    with op.batch_alter_table(
        'user_settings', schema=None,
    ) as batch_op:
        batch_op.alter_column(
            'column_order_masters', new_column_name='column_order_staff',
        )

    # ── Post: specialty/color/position leave staff ────────────────────────
    with op.batch_alter_table('staff', schema=None) as batch_op:
        batch_op.drop_column('specialty')
        batch_op.drop_column('color')
        batch_op.drop_column('position')
