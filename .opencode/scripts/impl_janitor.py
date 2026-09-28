#!/usr/bin/env python3
"""impl_janitor — hourly reaper of pipeline leftovers (2026-09-28, #324 case).

The #324 incident: dev servers (uvicorn + next dev) started for verification
inside a task worktree outlived the merged card by 16+ hours — the finishing
flow removed the worktree itself, but nothing stopped its processes, so they
kept running from the deleted directory. The hourly janitor kills:

  1. Processes whose CWD is inside a memo worktree (.worktrees/…) whose card
     is no longer in an active IMPL status (In IMPL / PR (G7)), when the
     process is older than JANITOR_WORKTREE_MIN_AGE_S (default 1h — protects
     servers a run has just started). The card numbers are read from the
     worktree path parts via the board.
  2. Orphaned TUI clients — a bare `opencode` process on a pts whose parent
     terminal is gone (ppid 0/1 or the zombie-reaper) — older than
     JANITOR_TUI_MIN_AGE_S (default 12h). A user's live window always has a
     live parent (the terminal/ssh/docker-exec that owns it) and is never
     touched.

Never touched: the server (`opencode web`), `opencode run` clients, the
watcher, the zombie-reaper, this script itself, anything outside the two
rules above. Worktree DIRECTORIES are not removed here — the finishing flow
owns them; this script only stops processes.

Runs from auto_impl_watch.sh every cycle and self-throttles to one pass per
JANITOR_MIN_INTERVAL_S (default 1h) via a lastrun stamp. Worktree kills are
logged to the issue's "auto-impl log:" comment; TUI kills go to the watcher
log only.

Usage: impl_janitor.py [--dry-run]
"""
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path("/root/workspace/memo")
WORKTREES = REPO / ".worktrees"
STATE = Path("/root/.local/state/opencode")
STAMP = STATE / "impl-janitor.lastrun"
MIN_INTERVAL_S = int(os.environ.get("JANITOR_MIN_INTERVAL_S", "3600"))
WORKTREE_MIN_AGE_S = int(os.environ.get("JANITOR_WORKTREE_MIN_AGE_S", "3600"))
TUI_MIN_AGE_S = int(os.environ.get("JANITOR_TUI_MIN_AGE_S", "43200"))
ACTIVE_STATUSES = ("in impl", "pr (g7)")
DRY = "--dry-run" in sys.argv

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gh_board  # noqa: E402  (same directory; import-safe, CLI is guarded)


def log_line(msg: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} janitor: {msg}")


_BOOT = None
_CLK = None


def proc_age_s(pid: int) -> float:
    global _BOOT, _CLK
    if _BOOT is None:
        _BOOT = float(open("/proc/uptime").read().split()[0])
        _CLK = os.sysconf("SC_CLK_TCK")
    with open(f"/proc/{pid}/stat") as f:
        after = f.read().rsplit(") ", 1)[1].split()
    starttime = int(after[19])
    return _BOOT - starttime / _CLK


def procs():
    """(pid, ppid, tty_nr, age_s, cmdline, cwd) for every readable process."""
    out = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        pid = int(entry)
        try:
            raw = open(f"/proc/{pid}/stat").read()
            _, rest = raw.split("(", 1)
            state_rest = rest.rsplit(") ", 1)[1]
            fields = state_rest.split()
            ppid, tty = int(fields[1]), int(fields[4])
            cmdline = open(f"/proc/{pid}/cmdline").read().replace("\0", " ").strip()
            try:
                cwd = os.readlink(f"/proc/{pid}/cwd")
            except OSError:
                cwd = ""
            out.append((pid, ppid, tty, proc_age_s(pid), cmdline, cwd))
        except (OSError, ValueError, IndexError):
            continue
    return out


def kill_all(pids) -> None:
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    time.sleep(2)
    for pid in pids:
        try:
            os.kill(pid, 0)
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


def auto_log(number: int, text: str) -> None:
    if DRY:
        log_line(f"would auto-log #{number}: {text[:80]}…")
        return
    try:
        subprocess.run(
            ["python3", ".opencode/scripts/gh_board.py", "auto-log", str(number), text],
            cwd=REPO, capture_output=True, timeout=60, check=True,
        )
    except Exception as e:  # noqa: BLE001 — the log is best-effort, kills already happened
        log_line(f"auto-log #{number} failed: {e}")


def main() -> None:
    if not DRY:
        STATE.mkdir(parents=True, exist_ok=True)
        if STAMP.exists():
            try:
                if time.time() - float(STAMP.read_text().strip() or 0) < MIN_INTERVAL_S:
                    return  # throttled — a pass ran less than an hour ago
            except ValueError:
                pass
        STAMP.write_text(f"{time.time():.0f}\n")

    log_line(f"pass start{' (dry-run)' if DRY else ''}")

    # Cards still living in their worktrees: OPEN + In IMPL / PR (G7).
    active_numbers: set[int] = set()
    try:
        for it in gh_board.items_with_fields():
            if it["state"] == "OPEN" and (it["status"] or "").lower() in ACTIVE_STATUSES:
                active_numbers.add(it["number"])
    except SystemExit as e:
        log_line(f"board lookup failed ({e}) — pass skipped")
        return

    ps = procs()

    # Rule 1: worktree processes of non-active cards (older than the grace).
    wt_kills: dict[str, list[tuple[int, str]]] = {}
    for pid, _ppid, _tty, age, cmdline, cwd in ps:
        if pid == os.getpid() or not cwd:
            continue
        try:
            rel = Path(cwd).relative_to(WORKTREES)
        except ValueError:
            continue
        parts = rel.parts
        if not parts:
            continue
        nums: set[int] = set()
        for part in parts:
            nums |= {int(x) for x in re.findall(r"\d+", part)}
        if nums & active_numbers:
            continue  # the card is still In IMPL / PR (G7) — live worktree
        if age < WORKTREE_MIN_AGE_S:
            continue  # fresh process — possibly just started by a new run
        slug = "/".join(parts)
        wt_kills.setdefault(slug, []).append((pid, cmdline[:80]))

    for slug, victims in wt_kills.items():
        for pid, cmd in victims:
            log_line(f"{'would kill' if DRY else 'killing'} pid {pid} ({cmd}) in .worktrees/{slug}/")
        if not DRY:
            kill_all([pid for pid, _ in victims])
        nums = sorted({int(x) for x in re.findall(r"\d+", slug)})
        if nums:
            auto_log(nums[0], f"janitor: остановлены процессы ворктри {slug} "
                             f"({len(victims)} шт.) — карточка больше не в In IMPL / PR (G7)")

    # Rule 2: orphaned TUI clients (bare `opencode` on a pts, parent gone).
    reaper_pids = {pid for pid, _p, _t, _a, cmd, _c in ps if "zombie-reaper" in cmd}
    tui_kills = []
    for pid, ppid, tty, age, cmdline, _cwd in ps:
        if cmdline != "opencode" or tty == 0:
            continue  # interactive client only: bare `opencode` on a pseudo-terminal
        if ppid not in (0, 1) and ppid not in reaper_pids:
            continue  # parent alive — the user's live window, never touched
        if age < TUI_MIN_AGE_S:
            continue
        tui_kills.append((pid, age))
    for pid, age in tui_kills:
        log_line(f"{'would kill' if DRY else 'killing'} orphan TUI pid {pid} "
                 f"(age {age / 3600:.1f}h, parent terminal gone)")
    if not DRY and tui_kills:
        kill_all([pid for pid, _ in tui_kills])

    log_line("pass done, "
             f"{len(wt_kills)} worktree + {len(tui_kills)} TUI targets"
             + (" (dry-run)" if DRY else ""))


if __name__ == "__main__":
    main()
