"""Hard delete: drop is_active from tags, photos, visitors, activities, records, user_settings.

Also re-creates the following FK constraints with explicit ON DELETE behaviour:
    records.activity_id  -> activities  (CASCADE)
    visits.visitor_id    -> visitors    (CASCADE)
    photos.visitor_id    -> visitors    (SET NULL)
    photos.activity_id   -> activities  (SET NULL)

These FKs are originally unnamed in the schema, so a naming convention is
applied to the batch_alter_table blocks that touch them: batch mode on
SQLite recreates the whole table, and the convention lets the reflected
constraints be addressed by a deterministic name for drop_constraint.

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
"""
from alembic import op
import sqlalchemy as sa

revision = 'b7c8d9e0f1a2'
down_revision = 'a1b2c3d4e5f6'

# Naming convention so the originally unnamed FK constraints get a
# deterministic name (fk_<table>_<col>_<referred_table>) that can be targeted
# by drop_constraint inside batch_alter_table on SQLite.
FK_NAMING_CONVENTION = {
    'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
}


def upgrade():
    # Tables that only lose the is_active column (no FK changes).
    for table in ('tags', 'visitors', 'activities', 'user_settings'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column('is_active')

    # records: drop is_active and switch activity_id FK to ON DELETE CASCADE.
    with op.batch_alter_table(
        'records', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_column('is_active')
        batch_op.drop_constraint(
            'fk_records_activity_id_activities', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_records_activity_id_activities',
            'activities',
            ['activity_id'],
            ['id'],
            ondelete='CASCADE',
        )

    # photos: drop is_active and switch visitor_id / activity_id FKs to
    # ON DELETE SET NULL.
    with op.batch_alter_table(
        'photos', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_column('is_active')
        batch_op.drop_constraint(
            'fk_photos_visitor_id_visitors', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_photos_visitor_id_visitors',
            'visitors',
            ['visitor_id'],
            ['id'],
            ondelete='SET NULL',
        )
        batch_op.drop_constraint(
            'fk_photos_activity_id_activities', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_photos_activity_id_activities',
            'activities',
            ['activity_id'],
            ['id'],
            ondelete='SET NULL',
        )

    # visits: no is_active column here (already dropped); switch visitor_id FK
    # to ON DELETE CASCADE.
    with op.batch_alter_table(
        'visits', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_visits_visitor_id_visitors', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_visits_visitor_id_visitors',
            'visitors',
            ['visitor_id'],
            ['id'],
            ondelete='CASCADE',
        )


def downgrade():
    # Reverse order of upgrade.

    # visits: revert visitor_id FK to NO ACTION.
    with op.batch_alter_table(
        'visits', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_visits_visitor_id_visitors', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_visits_visitor_id_visitors',
            'visitors',
            ['visitor_id'],
            ['id'],
        )

    # photos: revert visitor_id / activity_id FKs to NO ACTION and re-add
    # is_active.
    with op.batch_alter_table(
        'photos', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_photos_activity_id_activities', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_photos_activity_id_activities',
            'activities',
            ['activity_id'],
            ['id'],
        )
        batch_op.drop_constraint(
            'fk_photos_visitor_id_visitors', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_photos_visitor_id_visitors',
            'visitors',
            ['visitor_id'],
            ['id'],
        )
        batch_op.add_column(
            sa.Column(
                'is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')
            )
        )

    # records: revert activity_id FK to NO ACTION and re-add is_active.
    with op.batch_alter_table(
        'records', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(
            'fk_records_activity_id_activities', type_='foreignkey'
        )
        batch_op.create_foreign_key(
            'fk_records_activity_id_activities',
            'activities',
            ['activity_id'],
            ['id'],
        )
        batch_op.add_column(
            sa.Column(
                'is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')
            )
        )

    # Tables whose is_active column was dropped without FK changes.
    for table in ('user_settings', 'activities', 'visitors', 'tags'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    'is_active',
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text('1'),
                )
            )