#!/usr/bin/env python3
"""Generate the Telethon session string for the notify Telegram channel.

GH #485 part 4 Task 4 (spec §6.1): the worker authenticates as the
STUDIO'S USER ACCOUNT via a pre-generated ``StringSession`` — no session
files, the string lives in the settings as ``TELEGRAM_SESSION``
(SecretStr). This OFFLINE script produces that string interactively;
ported from the cmbot reference (``scripts/generate_telegram_session.py``)
with the proxy/code-hash operational extras dropped.

Usage (from ``backend/``)::

    uv run python scripts/generate_telegram_session.py

Prompts for the application credentials (https://my.telegram.org/apps),
the account phone, the verification code delivered to the Telegram apps,
and the 2FA password when the account has one. Prints the settings
line::

    TELEGRAM_SESSION=<the generated string>

The string IS durable account access (spec §14) — store it as a secret;
rotation is manual: rerun the script.
"""

import asyncio
import sys


async def generate_session() -> str:
    """Interactive login → the saved ``StringSession`` value."""
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError:
        print("Ошибка: telethon не установлен — uv sync")
        raise SystemExit(1) from None

    print("=" * 60)
    print("Генератор строки сессии Telegram (Telethon)")
    print("=" * 60)
    print()
    print("Код подтверждения придёт в приложение Telegram (не по SMS).")
    print("Проверьте ВСЕ устройства — код может появиться на другом.")
    print()

    api_id_raw = input("API ID: ").strip()
    api_hash = input("API Hash: ").strip()
    phone = input("Телефон аккаунта (с +, например +79991234567): ").strip()

    if not api_id_raw or not api_hash or not phone:
        print("Ошибка: все поля обязательны")
        raise SystemExit(1)
    try:
        api_id = int(api_id_raw)
    except ValueError:
        print("Ошибка: API ID должен быть числом")
        raise SystemExit(1) from None

    client = TelegramClient(StringSession(), api_id, api_hash)
    try:
        print()
        print("Подключение к Telegram…")
        await client.connect()

        print(f"Запрос кода подтверждения для {phone}…")
        sent_code = await client.send_code_request(phone)
        print("Код отправлен (придёт в приложение Telegram).")
        if hasattr(sent_code, "timeout") and sent_code.timeout:
            print(f"Код действителен ~{sent_code.timeout} с.")

        phone_code = input("Введите код подтверждения: ").strip()
        if not phone_code:
            print("Ошибка: код обязателен")
            raise SystemExit(1)

        try:
            await client.sign_in(
                phone, phone_code, phone_code_hash=sent_code.phone_code_hash
            )
        except Exception as exc:
            message = str(exc).lower()
            if "password" in message or "two" in message:
                password = input("Пароль 2FA: ").strip()
                if not password:
                    print("Ошибка: пароль 2FA обязателен")
                    raise SystemExit(1) from None
                await client.sign_in(password=password)
            else:
                raise

        session_string = client.session.save()

        print()
        print("=" * 60)
        print("Строка сессии сгенерирована.")
        print("=" * 60)
        print()
        print("Добавьте в настройки окружения воркера (секрет!):")
        print()
        print(f"TELEGRAM_SESSION={session_string}")
        print()
        print("=" * 60)
        return session_string
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(generate_session())
    except KeyboardInterrupt:
        print("\n\nОперация прервана")
        raise SystemExit(1) from None
    except SystemExit:
        raise
    except Exception as exc:
        print(f"\n\nОшибка: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
