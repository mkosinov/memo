from datetime import UTC, datetime


def utc_now() -> datetime:
    """Наивное UTC-«сейчас»: мгновение UTC без tzinfo.

    Для мгновений (TTL, отметки создания/обновления, журнал, аудит).
    не для настенного времени расписания: там своё время —
    src/notify/time.py::business_now() (бизнес-зона, тоже наивное).
    Осведомлённое время и пояса — #498; до него значения наивные.
    """
    return datetime.now(UTC).replace(tzinfo=None)
