#!/usr/bin/env python3
"""check_skipped_tests.py — CI-утилита для отслеживания отключённых тестов.

Соглашение: каждый `test.skip`/`test.fixme` (Playwright) или
`pytest.mark.skip`/`pytest.mark.xfail` (pytest) обязан ссылаться на
GitHub issue в формате `GH #NNN` в комментарии/строке skip'а.

Режимы:
  default (warning): печатает ::warning аннотации GitHub Actions и
    сводку, но exit code всегда 0 — "жёлтая" проверка.
  --strict: exit 1 если есть хотя бы одно нарушение.

Нарушения:
  - skip'ы БЕЗ ссылки на issue (безусловные: test.skip(true,...) / test.fixme(...) /
    pytest.mark.skip(...) / pytest.mark.xfail(...) / pytest.skip(...) /
    pytest.xfail(...) без `GH #NNN` в строке)
  - skip'ы, у которых связанный issue уже CLOSED (тест пора включать)

Условные skip'ы в теле теста (test.skip() без аргументов по условию
отсутствия seed-данных) — НЕ считаются нарушением.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent

PLAYWRIGHT_SPEC_GLOB = "frontend/admin/e2e/**/*.spec.ts"
PYTEST_TEST_GLOB = "backend/tests/**/*.py"

# Безусловные skip'ы (нарушение, если без GH #NNN)
PLAYWRIGHT_UNCONDITIONAL_SKIP_RE = re.compile(
    r"""
    (?:^|\n)                       # начало строки
    (?P<indent>[ \t]*)             # отступ
    test\.
    (?P<kind>skip|fixme)           # skip или fixme
    \s*\(                          # открывающая скобка
    (?P<args>[^)]*)                # аргументы до закрывающей скобки
    \)                             # закрывающая скобка
    """,
    re.VERBOSE,
)

PYTEST_UNCONDITIONAL_SKIP_RES = [
    re.compile(r"@pytest\.mark\.(?P<kind>skip|xfail)\s*\((?P<args>[^)]*)\)"),
    re.compile(r"pytest\.(?P<kind>skip|xfail)\s*\((?P<args>[^)]*)\)"),
]

# Условные skip'ы (НЕ нарушение) — test.skip() / test.skip(condition, reason)
# Эвристика: это нарушение, только если есть `true` (безусловный) или
# есть ненулевая причина с GH #NNN.
PLAYWRIGHT_CONDITIONAL_SKIP_RE = re.compile(
    r"^\s*test\.(?P<kind>skip|fixme)\s*\((?P<args>[^)]*)\)\s*;?",
    re.MULTILINE,
)

ISSUE_REF_RE = re.compile(r"GH\s*#(?P<n>\d+)", re.IGNORECASE)


@dataclass
class SkipHit:
    path: str
    line: int          # 1-based
    kind: str          # "skip" / "fixme"
    args: str          # содержимое скобок
    issues: list[int]  # GH #NNN найденные рядом
    source: str        # "playwright" | "pytest"


def log_warning(hit: SkipHit, message: str) -> None:
    """Печатает GitHub Actions ::warning аннотацию."""
    rel = hit.path
    # Сделать путь относительным корня репо
    try:
        rel = str(Path(hit.path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        pass
    print(f"::warning file={rel},line={hit.line}::{message}")


def log_info(msg: str) -> None:
    print(msg)


def log_error(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)


def discover_files(glob_pattern: str) -> list[Path]:
    """Возвращает список файлов по glob-паттерну (без сторонних библиотек)."""
    base_str, _, pattern = glob_pattern.partition("/**/")
    if not pattern:
        return list(REPO_ROOT.glob(glob_pattern))
    base = REPO_ROOT / base_str
    if not base.exists():
        return []
    # Собираем все файлы под base, матчащие суффикс-паттерн
    suffix = pattern.replace("*", "")
    out: list[Path] = []
    for p in base.rglob(f"*{suffix}"):
        if p.is_file():
            out.append(p)
    return out


def _is_conditional_playwright_skip(args: str) -> bool:
    """Возвращает True, если это условный skip вида test.skip() / test.skip(condition)."""
    a = args.strip()
    if not a:
        return True
    # test.skip(true, '...') — безусловный (true literal)
    if re.match(r"^true\b", a, re.IGNORECASE):
        return False
    return True


def find_playwright_skips(path: Path) -> list[SkipHit]:
    text = path.read_text(encoding="utf-8")
    hits: list[SkipHit] = []
    for m in PLAYWRIGHT_UNCONDITIONAL_SKIP_RE.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        args = m.group("args")
        kind = m.group("kind")
        # Проверить: это условный (без аргументов) или безусловный (с `true`)?
        if _is_conditional_playwright_skip(args):
            continue
        # Безусловный — ищем GH #NNN в строке и в 1 строке выше/ниже
        # для комментариев.
        lines = text.split("\n")
        context = "\n".join(lines[max(0, line - 2):line + 1])
        issues = [int(x) for x in ISSUE_REF_RE.findall(context)]
        hits.append(SkipHit(
            path=str(path),
            line=line,
            kind=kind,
            args=args,
            issues=issues,
            source="playwright",
        ))
    return hits


def find_pytest_skips(path: Path) -> list[SkipHit]:
    text = path.read_text(encoding="utf-8")
    hits: list[SkipHit] = []
    for rx in PYTEST_UNCONDITIONAL_SKIP_RES:
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            args = m.group("args")
            kind = m.group("kind")
            # Контекст: строка маркера + декоратор (строка выше)
            lines = text.split("\n")
            ctx_start = max(0, line - 3)
            ctx_end = min(len(lines), line + 1)
            context = "\n".join(lines[ctx_start:ctx_end])
            issues = [int(x) for x in ISSUE_REF_RE.findall(context)]
            hits.append(SkipHit(
                path=str(path),
                line=line,
                kind=kind,
                args=args,
                issues=issues,
                source="pytest",
            ))
    return hits


def find_all_skips() -> list[SkipHit]:
    out: list[SkipHit] = []
    for p in discover_files(PLAYWRIGHT_SPEC_GLOB):
        out.extend(find_playwright_skips(p))
    for p in discover_files(PYTEST_TEST_GLOB):
        out.extend(find_pytest_skips(p))
    return out


# --- GitHub API --------------------------------------------------------------

def detect_repo() -> str | None:
    """Возвращает owner/repo из GITHUB_REPOSITORY или `git remote get-url origin`."""
    env_repo = os.environ.get("GITHUB_REPOSITORY")
    if env_repo and "/" in env_repo:
        return env_repo
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=str(REPO_ROOT),
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    # https://github.com/owner/repo(.git) или git@github.com:owner/repo.git
    m = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?$", url)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    return None


_issue_cache: dict[int, dict | None] = {}


def fetch_issue(number: int, repo: str) -> dict | None:
    if number in _issue_cache:
        return _issue_cache[number]
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    url = f"https://api.github.com/repos/{repo}/issues/{number}"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log_info(f"  (i) issue #{number} не найден в {repo} (404)")
            _issue_cache[number] = None
            return None
        if e.code == 403:
            log_error(f"rate-limit / 403 при запросе issue #{number}: {e.reason}")
            _issue_cache[number] = None
            return None
        log_error(f"HTTP {e.code} при запросе issue #{number}: {e.reason}")
        _issue_cache[number] = None
        return None
    except urllib.error.URLError as e:
        log_error(f"network error при запросе issue #{number}: {e.reason}")
        _issue_cache[number] = None
        return None
    _issue_cache[number] = data
    return data


# --- Main --------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 при наличии нарушений")
    parser.add_argument("--dry-run", action="store_true",
                        help="не опрашивать GitHub API, только найти skip'ы")
    args = parser.parse_args(argv)

    repo = detect_repo()
    if not repo:
        log_error("не удалось определить owner/repo (GITHUB_REPOSITORY или git remote origin)")
        return 2

    log_info(f"Repo: {repo}")
    log_info("Поиск skip'ов...")

    hits = find_all_skips()
    log_info(f"Найдено безусловных skip'ов: {len(hits)}")

    if not hits:
        log_info("Skip'ов не найдено — готово.")
        return 0

    # Группируем по issue и по "без ссылки"
    no_ref: list[SkipHit] = []
    by_issue: dict[int, list[SkipHit]] = {}
    for h in hits:
        if not h.issues:
            no_ref.append(h)
        else:
            for n in h.issues:
                by_issue.setdefault(n, []).append(h)

    closed_count = 0
    if not args.dry_run:
        log_info("Опрос GitHub API для каждого issue...")
        for n, hhits in by_issue.items():
            data = fetch_issue(n, repo)
            if data is None:
                continue
            state = data.get("state", "open")
            title = data.get("title", "<no title>")
            if state == "closed":
                closed_count += 1
                for h in hhits:
                    log_warning(
                        h,
                        f"Skip на закрытый issue #{n} — тест пора включать ({title})",
                    )
    else:
        log_info("(--dry-run) пропуск GitHub API")

    # Skip'ы без ссылки
    for h in no_ref:
        log_warning(h, "skip без ссылки на issue (добавьте GH #NNN в причину)")

    # Сводка
    log_info("")
    log_info("=== Сводка skip-tracker ===")
    log_info(f"  Проверено skip'ов:   {len(hits)}")
    log_info(f"  С закрытым issue:    {closed_count}")
    log_info(f"  Без ссылки на issue: {len(no_ref)}")

    has_violations = closed_count > 0 or len(no_ref) > 0
    if has_violations and args.strict:
        log_error("--strict: есть нарушения, exit 1")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
