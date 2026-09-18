"""Thing-title canon #172: rename label fields locations.name → title, tags.tag → title.

Spec: docs/specs/2026-09-17-thing-title-canon-design.md (rev3, Task 1).

Pure column rename on SQLite batch mode (recipe cf. e5f7a9c3b1d8):
1. ``locations``: one batch block — ``name`` → ``title``.
2. ``tags``: THREE separate batch blocks — drop the unnamed unique on
   ``tag`` (convention alias ``uq_tags_tag``), rename ``tag`` → ``title``,
   re-create the unique as ``uq_tags_title``. The drop MUST precede the
   rename: alembic's batch recreate reflects constraints against the
   pre-rename column set, so a drop issued in the same block as (or after)
   the rename resolves against stale columns and fires as a no-op
   (empirically verified, cf. e5f7a9c3b1d8:120-124).

No downgrade (project practice): restore = roll back the dev file copy.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision = 'a7b8c9d0e1f2'
down_revision = 'dc47abd1ad2d'
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


def _assert_tags_title_unique_index(conn) -> None:
    """Post-check: ``tags.title`` must carry a UNIQUE constraint named
    ``uq_tags_title``.

    SQLite quirk (empirical, cf. e5f7a9c3b1d8:120-124): a named inline
    UNIQUE constraint is surfaced by ``PRAGMA index_list`` under an
    autoindex name (``sqlite_autoindex_tags_N``, origin ``u``) — the
    constraint name lives only in the table DDL. So the check asserts:
    1. via index_list + index_info — a unique (origin ``u``) index whose
       sole column is ``title``;
    2. via sqlite_master DDL — the constraint is named ``uq_tags_title``.
    """
    index_rows = conn.execute(sa.text("PRAGMA index_list(tags)")).fetchall()
    # (seq, name, unique, origin, partial) — unique origin 'u' = UNIQUE constraint
    unique_indexes = [row[1] for row in index_rows if row[2] == 1 and row[3] == 'u']
    title_unique = False
    for index_name in unique_indexes:
        cols = [
            row[2] for row in
            conn.execute(sa.text(f"PRAGMA index_info({index_name})")).fetchall()
        ]
        if cols == ['title']:
            title_unique = True
            break
    assert title_unique, (
        "tags.title must carry a unique index after the rename; "
        f"PRAGMA index_list(tags) returned: {index_rows}"
    )
    ddl = conn.execute(
        sa.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='tags'")
    ).fetchone()[0]
    assert 'uq_tags_title' in ddl, (
        "tags DDL must declare the unique constraint as 'uq_tags_title'; "
        f"DDL was: {ddl}"
    )


def upgrade():
    conn = op.get_bind()

    # ── 1. locations: name → title (single batch block) ───────────────────
    with op.batch_alter_table(
        'locations', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column('name', new_column_name='title')

    # ── 2. tags: three separate batch blocks (drop → rename → re-create) ──
    # NOTE: separate blocks are mandatory — see module docstring.
    with op.batch_alter_table(
        'tags', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint('uq_tags_tag', type_='unique')
    with op.batch_alter_table(
        'tags', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column('tag', new_column_name='title')
    with op.batch_alter_table(
        'tags', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.create_unique_constraint('uq_tags_title', ['title'])

    _assert_tags_title_unique_index(conn)
