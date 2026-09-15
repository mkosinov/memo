#!/usr/bin/env python3
"""Запрещает голые z-значения в коде админки вне токен-блока globals.css.

Разрешено: z-[var(--z-*)] в классах, zIndex: 'var(--z-*)' в inline-стилях.
Токены: frontend/admin/app/globals.css (:root). Спека: docs/specs/2026-09-14-z-tokens-design.md §3.3.
Исключение спеки: карточная модель глубины DayColumn рендерит `zIndex: cardZIndex` — на месте
вызова нет числового литерала, ни один паттерн не срабатывает (числа живут в арифметике 25−z).
"""
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "frontend" / "admin" / "app"

ARBITRARY = re.compile(r"\bz-\[(?!var\()[^\]]*\d")   # z-[110], z-[15px]…
BARE = re.compile(r"\bz-(?!\[)\d+\b")                 # z-30, z-50… (z-[N] не дублируется — ловит ARBITRARY)
INLINE = re.compile(r"\bzIndex\s*:\s*['\"]?\d")       # zIndex: 15, zIndex: '15'…
PATTERNS = (("z-[N]", ARBITRARY), ("z-N", BARE), ("zIndex: N", INLINE))


def main() -> int:
    files = sorted(
        p for glob in ("*.ts", "*.tsx") for p in APP.rglob(glob)
        if "__tests__" not in p.parts and ".test." not in p.name
    )
    violations = []
    for path in files:
        rel = path.relative_to(APP.parents[2])
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for label, pattern in PATTERNS:
                if pattern.search(line):
                    violations.append(f"{rel}:{lineno}: {label}: {line.strip()}")
    if violations:
        print("z-token guard: голые z-значения запрещены.")
        print("Токены: frontend/admin/app/globals.css (:root). Используй z-[var(--z-имя)] / zIndex: 'var(--z-имя)'.")
        for v in violations:
            print(f"  {v}")
        return 1
    print(f"z-token guard: OK ({len(files)} files scanned, 0 violations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
