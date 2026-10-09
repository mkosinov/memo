"""Скрипт бюджета lint/mypy — рахет-гейт (GH #306, волна 0).

Пороги зафиксированы константами ниже: ``RUFF_BUDGET`` — per-rule словарь ruff
(правила — независимые классы нарушений, тотал допустил бы компенсацию),
``MYPY_BUDGET`` — тотал mypy. Скрипт запускает ruff и mypy, сравнивает
факт и порог:

* факт > порога → exit 1 «PR добавил ошибок: было N, стало F»;
* факт < порога → exit 1 «порог разболтался: опусти до F»;
* факт == порогу → зелёный.

Отчёты обоих инструментов печатаются целиком, короткого замыкания нет.
Fail-closed: сломанный инструмент (ruff exit ≥ 2, mypy exit = 2, пустой или
непарсимый вывод, таймаут) → exit 1 «инструмент сломан, счётчик недостоверен».

Для CI действует запрет роста порогов: пороги читаются из базовой версии этого
файла (``git show <merge-base>:backend/scripts/lint_budget.py``; для пуша
в main — ``HEAD~1``), рост любого порога → красный. Файла в базе нет →
создание бюджета (волна 0) разрешено.

Запуск (из ``backend/``)::

    uv run python scripts/lint_budget.py

Бинарники инструментов переопределяются переменными ``RUFF_BIN``/``MYPY_BIN``.
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from collections.abc import Mapping

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH_IN_REPO = "backend/scripts/lint_budget.py"
TOOL_TIMEOUT_SECONDS = 600

# Снапшот фактических счётчиков после волны 0 (конфиг B008 для fastapi-семейства
# + безопасные автоправки ruff --fix по src/tests): ruff check src tests scripts —
# 119 находок, mypy src --no-incremental — 531 ошибка (без изменений).
# Обновлять только вниз (рахет): снеси ошибки — опусти порог до факта;
# правило ушло в ноль — оставь запись «правило: 0» или удали её.
# 2026-10-08 (GH #306, Task 4 транш 1 — mypy-волна services): mypy
# 531 → 397 (record.py + generic.py → 0; поддерживающие правки сигнатур:
# SearchField.column, SortExpr, repositories reorder); ruff-факт не менялся.
# 2026-10-08 (GH #306, Task 4 транш 2 — остаток семейства services): mypy
# 397 → 318 — все файлы src/services/ → 0 (78 ошибок; честные сигнатуры
# list-оверрайдов, ModelList-алиас, классовые _model-аннотации; 4 точечных
# type: ignore[override] в service.py по прецеденту GH #171); коллатерально
# api/v1/staff.py 6 → 5 (аннотация order_by). Ruff-факт не менялся.
# 2026-10-09 (GH #306, Task 5 — mypy-волна admin): mypy 318 → 170 — всё
# семейство admin (src/admin/setup.py 148 → 0): честные аннотации
# ClassVar[list[Column]] → ClassVar[Sequence[_AdminAttr]] по объявлениям
# sqladmin 0.26 (Sequence[MODEL_ATTR]), штампы types-WTForms в dev-extra
# (гасят [import-untyped] без новых ошибок), data: dict[str, Any],
# ALL_ADMIN_VIEWS: list[type[ModelView]], setup_admin(app: FastAPI).
# Ruff-факт не менялся (119).
# 2026-10-09 (GH #306, Task 6 — mypy-волна api): mypy 170 → 94 — всё
# семейство api (src/api/* 76 → 0): delete-family роуты `-> None` →
# `-> Response` (early-return JSONResponse из 204-роута; FastAPI 0.141
# ассертит «204 без тела», Response-аннотация не меняет OpenAPI —
# проверено), явные `return Response(status_code=204)`,
# deps: list[DependencyNode], order_by: list[SortExpr] | None (прецедент
# locations.py), `_to_response` валидирует ORM на границе,
# Annotated[VisitorService] вместо any; 6 точечных пар type: ignore[misc]/
# [arg-type] на selfless-вызовах сценариев (прецедент staff.py/GH #171);
# поддерживающее: update_by_user_id принимает Update | Patch (сервис).
# Ruff-факт не менялся (119).
RUFF_BUDGET: dict[str, int] = {
    "B006": 1,
    "B011": 2,
    "B905": 1,
    "E712": 1,
    "F821": 2,
    "F841": 10,
    "RUF001": 9,
    "RUF002": 4,
    "RUF003": 2,
    "RUF005": 1,
    "RUF012": 23,
    "RUF043": 1,
    "RUF059": 9,
    "RUF100": 3,
    "SIM115": 2,
    "SIM118": 2,
    "TC001": 6,
    "TC002": 14,
    "TC003": 8,
    "UP040": 1,
    "UP042": 8,
    "UP046": 3,
    "UP047": 2,
    "W291": 2,
    "W293": 2,
}
MYPY_BUDGET: int = 94

_MYPY_TOTAL_RE = re.compile(r"^Found (\d+) errors?", re.MULTILINE)

LOCAL = "local"
PULL_REQUEST = "pull_request"
MAIN_PUSH = "main_push"


class Verdict(NamedTuple):
    """Итог сравнения факта и порога по одному классу нарушений."""

    ok: bool
    message: str


class Budgets(NamedTuple):
    """Пороги, вычитанные из версии скрипта (текущей или базовой)."""

    ruff: dict[str, int]
    mypy: int


class BaseState(NamedTuple):
    """Результат чтения порогов из базовой версии скрипта.

    ``budgets is None`` и ``error is None`` — рост-проверка пропущена
    (локальный запуск либо файла в базе нет — создание, волна 0).
    ``error is not None`` — база не читается, fail-closed красный.
    """

    budgets: Budgets | None
    note: str
    error: str | None


# ── Чистые функции (покрыты юнит-тестами) ─────────────────────────────


def parse_budgets(source: str) -> Budgets | None:
    """Вычитать ``RUFF_BUDGET``/``MYPY_BUDGET`` из текста скрипта.

    Принимаются только литеральные словарь ``str -> int`` и ``int``;
    anything else (вычисляемые константы, отсутствие, синтаксическая
    ошибка) → ``None`` — базовая версия нечитаема.
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    ruff: dict[str, int] | None = None
    mypy: int | None = None
    for node in tree.body:
        name: str | None = None
        value: ast.expr | None = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name = node.target.id
            value = node.value
        elif (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            name = node.targets[0].id
            value = node.value
        if name == "RUFF_BUDGET" and value is not None:
            ruff = _literal_int_dict(value)
        elif name == "MYPY_BUDGET" and value is not None:
            mypy = _literal_int(value)
    if ruff is None or mypy is None:
        return None
    return Budgets(ruff, mypy)


def _literal_int(node: ast.expr) -> int | None:
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, int)
        and not isinstance(node.value, bool)
    ):
        return node.value
    return None


def _literal_int_dict(node: ast.expr) -> dict[str, int] | None:
    if not isinstance(node, ast.Dict):
        return None
    result: dict[str, int] = {}
    for key, val in zip(node.keys, node.values, strict=True):
        if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
            return None
        item = _literal_int(val)
        if item is None:
            return None
        result[key.value] = item
    return result


def parse_ruff_counts(payload: str) -> dict[str, int]:
    """Пер-rule счётчики из JSON-вывода ruff.

    Поднимает ``ValueError`` на пустом/битом JSON — вызывающий код обязан
    среагировать fail-closed («инструмент сломан»).
    """
    findings = json.loads(payload)
    if not isinstance(findings, list):
        raise ValueError(f"ожидался JSON-массив, получен {type(findings).__name__}")
    counts: Counter[str] = Counter()
    for item in findings:
        code = item.get("code") if isinstance(item, dict) else None
        if not isinstance(code, str):
            raise ValueError("элемент вывода ruff без строкового поля 'code'")
        counts[code] += 1
    return dict(counts)


def parse_mypy_total(output: str) -> int | None:
    """Тотал из итоговой строки mypy ``Found N errors...``; ``None`` — нет её."""
    match = _MYPY_TOTAL_RE.search(output)
    if match is None:
        return None
    return int(match.group(1))


def compare_tool(name: str, fact: int, threshold: int) -> Verdict:
    """Вердикт «факт против порога»: рост и разболтанность красные."""
    if fact > threshold:
        return Verdict(False, f"{name}: PR добавил ошибок: было {threshold}, стало {fact}")
    if fact < threshold:
        return Verdict(False, f"{name}: порог разболтался: опусти до {fact}")
    return Verdict(True, f"{name}: {fact} — в бюджете")


def compare_ruff_rules(fact: Mapping[str, int], budget: Mapping[str, int]) -> list[Verdict]:
    """Вердикты по объединению правил факта и бюджета, отсортированы по коду.

    Правило вне бюджета имеет порог 0; правило бюджета без находок — факт 0.
    """
    verdicts = []
    for rule in sorted(set(fact) | set(budget)):
        verdicts.append(
            compare_tool(f"ruff {rule}", fact.get(rule, 0), budget.get(rule, 0))
        )
    return verdicts


def check_growth(current: Budgets, base: Budgets) -> list[str]:
    """Запрет роста порогов: каждый порог текущей версии ≤ порога базы.

    Новая запись бюджета трактуется как рост от неявного нуля базы.
    """
    violations = []
    for rule in sorted(set(base.ruff) | set(current.ruff)):
        was = base.ruff.get(rule, 0)
        now = current.ruff.get(rule, 0)
        if now > was:
            violations.append(
                f"ruff {rule}: бюджет не растёт — сначала снеси ошибки "
                f"(было {was}, стало {now})"
            )
    if current.mypy > base.mypy:
        violations.append(
            f"mypy: бюджет не растёт — сначала снеси ошибки "
            f"(было {base.mypy}, стало {current.mypy})"
        )
    return violations


def base_mode(env: Mapping[str, str]) -> str:
    """Режим рост-проверки по окружению: PR / пуш в main / локальный запуск."""
    if env.get("GITHUB_BASE_REF"):
        return PULL_REQUEST
    if env.get("GITHUB_EVENT_NAME") == "push" and env.get("GITHUB_REF") == "refs/heads/main":
        return MAIN_PUSH
    return LOCAL


# ── Сабпроцесс-обвязка (проверяется сценарно) ─────────────────────────


def run_tool(command: list[str]) -> subprocess.CompletedProcess[str]:
    """Запуск инструмента из ``backend/``; OSError/таймаут летят наружу."""
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        cwd=BACKEND_DIR,
        timeout=TOOL_TIMEOUT_SECONDS,
    )


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=False,
        cwd=BACKEND_DIR.parent,
        timeout=TOOL_TIMEOUT_SECONDS,
    )


def _print_verdicts(verdicts: list[Verdict]) -> bool:
    for verdict in verdicts:
        print(verdict.message)
    return all(v.ok for v in verdicts)


def ruff_stage() -> bool:
    print("== ruff check src tests scripts --output-format json ==")
    command = [os.environ.get("RUFF_BIN", "ruff"), "check", "src", "tests", "scripts",
               "--output-format", "json"]
    try:
        proc = run_tool(command)
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"ruff: инструмент сломан, счётчик недостоверен (не запустился: {exc})")
        return False
    if proc.returncode not in (0, 1):
        print(f"ruff: инструмент сломан, счётчик недостоверен (exit {proc.returncode})")
        _print_stderr(proc.stderr)
        return False
    try:
        counts = parse_ruff_counts(proc.stdout)
    except ValueError as exc:
        print(f"ruff: инструмент сломан, счётчик недостоверен ({exc})")
        return False
    ok = _print_verdicts(compare_ruff_rules(counts, RUFF_BUDGET))
    print(f"итого ruff: факт {sum(counts.values())}, бюджет {sum(RUFF_BUDGET.values())}")
    return ok


def mypy_stage() -> bool:
    print("== mypy src --no-incremental ==")
    command = [os.environ.get("MYPY_BIN", "mypy"), "src", "--no-incremental"]
    try:
        proc = run_tool(command)
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"mypy: инструмент сломан, счётчик недостоверен (не запустился: {exc})")
        return False
    if proc.returncode not in (0, 1):
        print(f"mypy: инструмент сломан, счётчик недостоверен (exit {proc.returncode})")
        _print_stderr(proc.stderr)
        return False
    total = parse_mypy_total(proc.stdout)
    if total is None:
        if proc.returncode != 0:
            print("mypy: инструмент сломан, счётчик недостоверен (нет строки «Found N errors»)")
            return False
        total = 0
    return _print_verdicts([compare_tool("mypy", total, MYPY_BUDGET)])


def _print_stderr(stderr: str) -> None:
    stripped = stderr.strip()
    if stripped:
        print(stripped)


def load_base_state() -> BaseState:
    """Пороги из базовой версии скрипта по режиму окружения."""
    mode = base_mode(os.environ)
    if mode == LOCAL:
        return BaseState(None, "локальный запуск — рост-проверка порогов пропущена", None)
    if mode == PULL_REQUEST:
        base_ref = os.environ["GITHUB_BASE_REF"]
        fetch = git("fetch", "--no-tags", "origin", base_ref)
        if fetch.returncode != 0:
            return BaseState(
                None, "", f"git fetch origin {base_ref} не удался: {fetch.stderr.strip()}"
            )
        merge_base = git("merge-base", "HEAD", "FETCH_HEAD")
        if merge_base.returncode != 0:
            return BaseState(
                None, "", f"git merge-base не удался: {merge_base.stderr.strip()}"
            )
        rev = merge_base.stdout.strip()
    else:
        rev = "HEAD~1"
    blob = f"{rev}:{SCRIPT_PATH_IN_REPO}"
    exists = git("cat-file", "-e", blob)
    if exists.returncode != 0:
        return BaseState(
            None, "файла в базе нет — создание бюджета (волна 0) разрешено", None
        )
    shown = git("show", blob)
    if shown.returncode != 0:
        return BaseState(
            None, "", f"git show {blob} не удался: {shown.stderr.strip()}"
        )
    budgets = parse_budgets(shown.stdout)
    if budgets is None:
        return BaseState(
            None, "", f"пороги базовой версии {rev} не читаются (нет литеральных констант)"
        )
    return BaseState(budgets, f"база рост-проверки: {rev}", None)


def base_stage() -> bool:
    print("== запрет роста порогов (база ветки) ==")
    try:
        state = load_base_state()
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"git: инструмент сломан, счётчик недостоверен ({exc})")
        return False
    if state.note:
        print(state.note)
    if state.error is not None:
        print(state.error)
        return False
    if state.budgets is None:
        return True
    violations = check_growth(Budgets(RUFF_BUDGET, MYPY_BUDGET), state.budgets)
    for line in violations:
        print(line)
    return not violations


def main() -> int:
    ok = ruff_stage()
    ok = mypy_stage() and ok
    ok = base_stage() and ok
    print("зелёный: бюджеты соблюдены" if ok else "красный: бюджеты нарушены")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
