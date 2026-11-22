"""#616 — alembic/env.py должен потреблять DATABASE_URL.

Контейнерный путь (deploy.sh: ``docker compose run --rm backend alembic
upgrade head``; CI-джоб prod-build) получает DATABASE_URL из env_file
сервиса. Без обработки в env.py alembic мигрирует эфемерный
in-container ``memo.db`` из alembic.ini, а НЕ прод-БД на volume —
прод поднимается немигрированным.

Контракт (прецедентсная цепочка приоритетов):

* DATABASE_URL в окружении + нет явного URL → мигрируем БД из
  DATABASE_URL (форма ``sqlite+aiosqlite://`` допустима — нормализуем
  в sync-форму тем же способом, что src/db/migrate.py);
  ``memo.db`` из alembic.ini при этом НЕ создаётся;
* явный программный ``set_main_option("sqlalchemy.url", ...)``
  (src/db/migrate.py и все migration-тесты) ВСЕГДА побеждает env-var:
  conftest.py выставляет DATABASE_URL на весь pytest-процесс, так что
  без этого гарантии миграционные тесты мигрировали бы сессионную
  БД вместо своих tmp-файлов;
* DATABASE_URL нет в окружении → сегодняшнее поведение (дефолт
  alembic.ini), dev-процессы не затронуты.
"""

import logging
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.pure_unit  # own tmp-file DBs; the session DB is untouched


def _alembic_cfg() -> Config:
    """Config из alembic.ini БЕЗ явного sqlalchemy.url — единственный
    источник URL в этих тестах: env-var DATABASE_URL (как в контейнере)."""
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _tables(db_path: Path) -> set[str]:
    engine = sa.create_engine(f"sqlite:///{db_path}")
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_honors_database_url_env(tmp_path, monkeypatch) -> None:
    """DATABASE_URL из окружения (async-форма, как в prod env_file) →
    миграция идёт в эту БД; ini-дефолт memo.db не создаётся."""
    monkeypatch.chdir(tmp_path)  # ini-дефолт `sqlite:///memo.db` относителен к cwd
    env_db = tmp_path / "from_env.db"
    # Форма из prod env_file (§3.3): async-драйвер — env.py обязан
    # нормализовать её в sync-форму (прецедент src/db/migrate.py).
    monkeypatch.setenv(
        "DATABASE_URL", f"sqlite+aiosqlite:///{env_db}"
    )

    command.upgrade(_alembic_cfg(), "head")

    assert env_db.exists(), (
        "схема должна была уехать в БД из DATABASE_URL, "
        f"но файл {env_db} не создан"
    )
    tables = _tables(env_db)
    assert "alembic_version" in tables, f"нет alembic_version: {sorted(tables)}"
    assert "users" in tables, (
        f"нет базовой схемы (users — маркер base-схемы): {sorted(tables)}"
    )
    assert not (tmp_path / "memo.db").exists(), (
        "ini-дефолт memo.db создан — DATABASE_URL проигнорирован"
    )


def test_explicit_set_main_option_wins_over_database_url_env(
    tmp_path, monkeypatch
) -> None:
    """Явный программный URL (паттерн src/db/migrate.py и всех
    migration-тестов) бьёт env-var: conftest.py держит DATABASE_URL
    выставленным весь pytest-процесс, и без этой гарантии сессионная
    БД мигрировала бы вместо tmp-файлов тестов."""
    monkeypatch.chdir(tmp_path)
    explicit_db = tmp_path / "explicit.db"
    env_db = tmp_path / "from_env.db"
    monkeypatch.setenv(
        "DATABASE_URL", f"sqlite+aiosqlite:///{env_db}"
    )

    cfg = _alembic_cfg()
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{explicit_db}")
    command.upgrade(cfg, "head")

    tables = _tables(explicit_db)
    assert "alembic_version" in tables and "users" in tables, (
        f"явный URL проиграл — explicit.db без схемы: {sorted(tables)}"
    )
    assert not env_db.exists(), (
        "миграция уехала в DATABASE_URL вместо явного URL"
    )
