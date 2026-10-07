#!/usr/bin/env python3
"""gh_board.py — GH Project #3 (Memo Project) board management.

Usage (from repo root):
  python3 .zcode/scripts/gh_board.py next-up                     — show the trajectory (Next Up 1→3)
  python3 .zcode/scripts/gh_board.py pick-next [host]           — token for auto-impl watcher: NONE | <issue>; per-host budget HOST_BUDGETS
  python3 .zcode/scripts/gh_board.py host N                     — read the card's host field (watcher tiebreak token)
  python3 .zcode/scripts/gh_board.py host N <label>|-           — set/clear the host label; on a Ready card a host label is the sticky progress marker (crash-released session lives on that machine, other hosts skip it, cleared only by the user accepting the progress loss)
  python3 .zcode/scripts/gh_board.py reconcile [host] [--dry-run] — watcher-side stale-card sweep: closed issue in In IMPL/PR (G7) → In-main/Not planned; dead In IMPL run on this host → Ready to IMPL + BLOCKED auto-log entry (host label preserved — sticky progress, user-release only); PR (G7) with a dead owner → wake-first, then gate=blocked; mirror sweep: an open issue without a card → card (Backlog; containers — issues with sub-issues — get Hold, never Backlog), an open issue's card without a Status value → Backlog/Hold by the same rule
  python3 .zcode/scripts/gh_board.py orphans [host]             — token for auto-impl watcher: "impl N"/"pr N" lines (nudge-due orphan cards) | NONE
  python3 .zcode/scripts/gh_board.py pick-next-design            — token for design kickoff: <issue> | NONE (reason)
  python3 .zcode/scripts/gh_board.py auto-log N "BLOCKED ..."    — append an entry to the issue's auto-impl log comment
  python3 .zcode/scripts/gh_board.py auto-state N                — last auto-impl log entry (or nothing)
  python3 .zcode/scripts/gh_board.py show N                      — read one card: status + queue position
  python3 .zcode/scripts/gh_board.py show all                    — the whole board as a table
  python3 .zcode/scripts/gh_board.py set-next-up N 1|2|3|none    — set/clear queue position
  python3 .zcode/scripts/gh_board.py shift                       — after Next Up 1 completes: clear it, shift 2→1, 3→2
  python3 .zcode/scripts/gh_board.py status N "In IMPL" [host]  — move a card; entering In IMPL/In Design stamps the host field, leaving clears it (host survives PR (G7), clears on leaving it)
  python3 .zcode/scripts/gh_board.py gate N concept|spec|plan|blocked|auto-retry|none — the pending-ask marker: a design gate stop, an IMPL blocker awaiting the user, or a temporary upstream pause (auto-retry — the watcher stamps/clears it, nobody awaits the user)
  python3 .zcode/scripts/gh_board.py merged N PR ["short title"] — append the "Recently merged" line (scratchpad v2)
  python3 .zcode/scripts/gh_board.py issue N                      — standard issue view: state, labels, body

Project constants are hardcoded (IDs are stable for Project #3).
Card ownership lives in the single-select field "host" (options: imac,
macbook, hk, gcp — created manually 2026-09-20): claiming is a field write
and the race tiebreak re-reads the field. This replaced the CLAIM-comment
mechanism; the auto-impl log comment remains the BLOCKED channel only.
Sticky progress marker (2026-09-26, the dead-zai-quota churn incident): when
reconcile returns a dead run to Ready to IMPL, the host label STAYS on the
card — it then means "the unfinished session lives on this machine's session
store" (session resume searches only the local DB, so a foreign host would
restart from zero). Foreign hosts skip such cards in pick-next; the label is
cleared only by the user (host N - — accepting the progress loss) or
reassigned (host N <label>). A clean release (gate-fail return, manual
status move) still clears the label as before.
The pending-ask marker lives in the single-select field "gate" (options:
concept, spec, plan, blocked, auto-retry — the first four created manually
2026-09-20, auto-retry added 2026-10-06): a design session stamps it at a
gate stop, an IMPL manager stamps "blocked" when a blocker awaits the
user; it is emptied at the user's answer (given in the opencode session)
and automatically when the card leaves In IMPL/In Design — except the
crash release: reconcile re-stamps "blocked" on the returned Ready card
(2026-09-26 user decision — a card awaiting the user must stay visible),
and pick-next skips gate=blocked cards, so a blocked card gets no
auto-retry; the user's answer clears the gate and the card re-enters the
pipeline. It replaced the gate:* issue labels.
"auto-retry" (2026-10-06, after the #349 frozen week) marks a TEMPORARY
pause: the watcher stamps it when a nudge is skipped on a failed upstream
ping (quota window / outage) and clears it when the ping passes and the
wake is sent — the pipeline self-heals, nobody awaits the user. The Gate
column thus separates "will retry" from "blocked" (awaits a user
decision). cmd_gate is idempotent: re-setting the current value or
clearing an empty gate is a no-op, so per-cycle watcher calls cost no
GraphQL writes.
The script is part of the host/container seam and travels via git.
Identical copies ship in BOTH harness folders — .zcode/scripts/ (host)
and .opencode/scripts/ (container); when editing, change both (or edit
one and copy over).
Orphan wake-first scheme (2026-09-27, the #324 parked-PR incident): a card
in In IMPL / PR (G7) whose sessions are silent and whose client process is
dead is not released immediately — the watcher wakes the manager session
(the wake marker NUDGE-<kind> in the auto-impl log doubles as the counter;
a fresh wake rests CLAIM_TTL_HOURS — the hourly cadence). Wake rules
(2026-09-28, the #348 night — 4 of 5 wakes burned inside the closed z.ai
quota window, each re-reading the manager history): before every wake the
watcher tests the upstream with llm_ping.sh (a closed window costs no wake
and writes no NUDGE marker); the budget is NUDGE_BUDGET wakes per
NUDGE_BUDGET_H (24 per 24h). When the budget is exhausted, BOTH kinds park
visibly on gate=blocked (an In IMPL card is released to Ready to IMPL with
the gate re-stamped) — the old release-then-reclaim loop re-burned the
manager context every hour. A live-but-silent client is never woken (a
second driver is worse than a release) and keeps the old path.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

SCRATCHPAD = Path(__file__).resolve().parents[2] / ".opencode" / "scratchpad.md"
MERGED_BLOCK = "## Recently merged"
MERGED_MAX = 5
SESSION_DB = Path("/root/.local/share/opencode/opencode.db")  # container-side session store (liveness source for reconcile)
SESSION_IDLE_LIMIT_S = 3600  # a run's sessions silent this long = stuck (the 2026-09-22 #319 dead-stream incident)

# Configure per project. Get IDs via:
#   gh api graphql -f query='query { user(login: "<owner>") { projectV2(number: <N>) { id fields(first: 30) { nodes { ... on ProjectV2SingleSelectField { name id options { id name } } } } } } }'
PROJECT_ID = "PVT_kwHOA-0Z984BXl3Z"
OWNER = "mkosinov"
REPO = "memo"
PROJECT_NUM = 3

NEXT_UP_FIELD = "PVTSSF_lAHOA-0Z984BXl3ZzhZEGRs"
NEXT_UP_OPTS = {"1": "ad936c13", "2": "8167d82e", "3": "ece04007"}

# Statuses are read live from the board (the option list is user-managed in
# the web UI — e.g. "Not planned" was added there 2026-09-09; never hardcode).

_status_field_id = None
_status_opts = None
_host_field_id = None
_host_field_opts = None
_gate_field_id = None
_gate_field_opts = None


def gql(query: str) -> dict:
    r = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"gh api error: {r.stderr.strip()}")
    data = json.loads(r.stdout)
    if "errors" in data:
        sys.exit(f"graphql errors: {data['errors']}")
    return data["data"]


def load_status_field():
    global _status_field_id, _status_opts, _host_field_id, _host_field_opts, _gate_field_id, _gate_field_opts
    if _status_field_id:
        return
    d = gql(f'query {{ node(id: "{PROJECT_ID}") {{ ... on ProjectV2 {{ fields(first: 30) {{ nodes {{ __typename ... on ProjectV2SingleSelectField {{ id name options {{ id name }} }} }} }} }} }} }}')
    for f in d["node"]["fields"]["nodes"]:
        if f["__typename"] != "ProjectV2SingleSelectField":
            continue
        if f["name"] == "Status":
            _status_field_id = f["id"]
            _status_opts = {o["name"]: o["id"] for o in f["options"]}
        elif f["name"] == HOST_FIELD_NAME:
            _host_field_id = f["id"]
            _host_field_opts = {o["name"]: o["id"] for o in f["options"]}
        elif f["name"] == GATE_FIELD_NAME:
            _gate_field_id = f["id"]
            _gate_field_opts = {o["name"]: o["id"] for o in f["options"]}
    if not _status_field_id:
        sys.exit("Status field not found")
    if not _host_field_id:
        sys.exit(f"'{HOST_FIELD_NAME}' single-select field not found — create it on the project (options: imac, macbook, hk, gcp)")
    if not _gate_field_id:
        sys.exit(f"'{GATE_FIELD_NAME}' single-select field not found — create it on the project (options: concept, spec, plan, blocked)")


def items_with_fields() -> list[dict]:
    out = []
    cursor = ""
    while True:
        after = f', after: "{cursor}"' if cursor else ""
        d = gql(f'''query {{ node(id: "{PROJECT_ID}") {{ ... on ProjectV2 {{ items(first: 50{after}) {{ pageInfo {{ hasNextPage endCursor }} nodes {{
            id
            content {{ ... on Issue {{ number title state }} }}
            fieldValues(first: 20) {{ nodes {{
                ... on ProjectV2ItemFieldSingleSelectValue {{ name field {{ ... on ProjectV2FieldCommon {{ name }} }} }}
            }} }}
        }} }} }} }} }}''')
        page = d["node"]["items"]
        for it in page["nodes"]:
            c = it.get("content")
            if not c or "number" not in c:
                continue
            vals = {v["field"]["name"]: v["name"] for v in it["fieldValues"]["nodes"] if v}
            out.append({
                "item_id": it["id"],
                "number": c["number"],
                "title": c["title"],
                "state": c["state"],
                "status": vals.get("Status"),
                "next_up": vals.get("Next Up"),
                "host": vals.get(HOST_FIELD_NAME),
                "gate": vals.get(GATE_FIELD_NAME),
            })
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    return out


def find_item(number: int) -> dict:
    for it in items_with_fields():
        if it["number"] == number:
            return it
    # не на доске — добавить
    d = gql(f'query {{ repository(owner: "{OWNER}", name: "{REPO}") {{ issue(number: {number}) {{ id title state }} }} }}')
    issue = d["repository"]["issue"]
    if not issue:
        sys.exit(f"Issue #{number} not found")
    d2 = gql(f'mutation {{ addProjectV2ItemById(input: {{ projectId: "{PROJECT_ID}", contentId: "{issue["id"]}" }}) {{ item {{ id }} }} }}')
    return {
        "item_id": d2["addProjectV2ItemById"]["item"]["id"],
        "number": number, "title": issue["title"], "state": issue["state"],
        "status": None, "next_up": None, "host": None, "gate": None,
    }


def set_field(item_id: str, field_id: str, option_id: str | None):
    value = f'value: {{ singleSelectOptionId: "{option_id}" }}' if option_id else "value: {}"
    # очистка single-select — пустое value не поддерживается; используем clear mutation
    if option_id is None:
        gql(f'mutation {{ clearProjectV2ItemFieldValue(input: {{ projectId: "{PROJECT_ID}", itemId: "{item_id}", fieldId: "{field_id}" }}) {{ projectV2Item {{ id }} }} }}')
    else:
        gql(f'mutation {{ updateProjectV2ItemFieldValue(input: {{ projectId: "{PROJECT_ID}", itemId: "{item_id}", fieldId: "{field_id}", {value} }}) {{ projectV2Item {{ id }} }} }}')


def cmd_next_up():
    items = [it for it in items_with_fields() if it["next_up"] and it["state"] == "OPEN"]
    items.sort(key=lambda x: x["next_up"])
    if not items:
        print("Trajectory is empty — no open issue has Next Up set.")
        return
    print("Trajectory (Next Up):")
    for it in items:
        g = f" gate={it['gate']}" if it["gate"] else ""
        print(f"  {it['next_up']}. #{it['number']} [{it['status'] or 'no status'}{g}] {it['title']}")


CLAIM_TTL_HOURS = 1  # auto-impl: freshness of claim/blocked log entries — a fresh entry means the card is in flight or resting
NUDGE_BUDGET = 24  # orphan wake budget (2026-09-28, user decision after the #348 night: hourly wakes for a full day, not 3 per sliding 6h)
NUDGE_BUDGET_H = 24  # the NUDGE-marker counting window for NUDGE_BUDGET
HOST_BUDGETS = {"imac": 2, "macbook": 1}  # auto-impl: per-machine In IMPL slots (replaced the global MAX_TOTAL_INFLIGHT on 2026-09-20: parked cards on one machine must not starve another)
DEFAULT_HOST_BUDGET = 1  # unknown hosts (hk, gcp — reserved) get one slot
HOST_FIELD_NAME = "host"  # single-select ownership field; options imac/macbook/hk/gcp
GATE_FIELD_NAME = "gate"  # single-select pending-ask field; options concept/spec/plan/blocked (replaced the gate:* issue labels 2026-09-20)
AUTO_IMPL_LOG_PREFIX = "auto-impl log:"
_DEP_RE = re.compile(r"(?im)^\s*depends-on:\s*(.+)$")
_NUM_RE = re.compile(r"#(\d+)")


def _recent_markers(number: int, prefixes: tuple[str, ...]) -> list[dict]:
    """Issue comments whose body starts with one of prefixes, posted within
    CLAIM_TTL_HOURS, oldest first. Network errors → empty list (fail-open)."""
    r = subprocess.run(
        ["gh", "issue", "view", str(number), "--json", "comments",
         "--repo", f"{OWNER}/{REPO}"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return []
    now = datetime.now(timezone.utc)
    out = []
    for c in json.loads(r.stdout or "{}").get("comments", []):
        body = c.get("body", "")
        if not any(body.startswith(p) for p in prefixes):
            continue
        try:
            created = datetime.fromisoformat(c["createdAt"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if (now - created).total_seconds() <= CLAIM_TTL_HOURS * 3600:
            out.append({"created": created, "body": body})
    return sorted(out, key=lambda c: c["created"])


def _open_deps(number: int) -> list[int]:
    """Issue numbers from body lines `depends-on: #12, #34` that are still OPEN.
    Convention for the auto-impl pipeline: declare hard dependencies in the
    issue body so the watcher can skip not-yet-mergeable cards cheaply."""
    r = subprocess.run(
        ["gh", "issue", "view", str(number), "--json", "body",
         "--repo", f"{OWNER}/{REPO}"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return []
    body = json.loads(r.stdout or "{}").get("body") or ""
    nums: list[int] = []
    for m in _DEP_RE.finditer(body):
        nums += [int(n) for n in _NUM_RE.findall(m.group(1))]
    open_deps = []
    for n in dict.fromkeys(nums):
        try:
            d = gql(f'query {{ repository(owner: "{OWNER}", name: "{REPO}") {{ issue(number: {n}) {{ state }} }} }}')
            issue = d["repository"]["issue"]
        except SystemExit:
            # Deleted/nonexistent issue number (e.g. stray digits in the line):
            # not a dependency — skip it instead of blinding the whole picker.
            continue
        if issue and issue["state"] == "OPEN":
            open_deps.append(n)
    return open_deps


def _resolve_host(explicit: str | None = None) -> str | None:
    """Which machine this invocation acts for: an explicit arg wins, then the
    GH_BOARD_HOST env (set by the watcher), then the container's host-label
    file (covers manual manager runs inside the container). None = unresolved."""
    if explicit:
        return explicit.strip().lower()
    env = os.environ.get("GH_BOARD_HOST", "").strip()
    if env:
        return env.lower()
    label = Path("/root/.local/state/opencode/auto-impl-host")
    try:
        if label.is_file():
            return label.read_text().strip().lower() or None
    except OSError:
        pass
    return None


def cmd_pick_next(host_arg: str | None = None):
    """Token protocol for .opencode/scripts/auto_impl_watch.sh: NONE | <number>.
    Candidates: OPEN issues with board status "Ready to IMPL".
    Order: Next Up position ascending (99 = unset), then board order.
    Skipped: cards with gate=blocked (awaiting the user's answer —
    2026-09-26 decision, no auto-retry against a user decision), cards
    whose auto-impl log comment's LAST entry is a fresh
    (<= CLAIM_TTL_HOURS) CLAIM/BLOCKED (legacy claims + blocked rest),
    cards with legacy standalone claim/blocked comments that fresh, and
    cards whose body declares `depends-on: #N` with N still OPEN.
    Budget: PER-HOST — cards "In IMPL" whose host field names this machine
    count against HOST_BUDGETS[host]. In IMPL cards with an empty host block
    no one (stderr warning) — ownership lives in the field, there is no
    comment fallback. Manual IMPL sessions count too: they stamp the host
    via the label file."""
    host = _resolve_host(host_arg)
    if not host:
        sys.exit("pick-next needs a host: pass it as an argument or set GH_BOARD_HOST")
    load_status_field()
    items = [it for it in items_with_fields() if it["state"] == "OPEN"]
    in_impl = [it for it in items if (it["status"] or "").lower() == "in impl"]
    orphans = [f"#{it['number']}" for it in in_impl if not it["host"]]
    if orphans:
        print(f"warn: In IMPL cards without host (blocking no one): {', '.join(orphans)}", file=sys.stderr)
    mine = sum(1 for it in in_impl if (it["host"] or "") == host)
    if mine >= HOST_BUDGETS.get(host, DEFAULT_HOST_BUDGET):
        print("NONE")
        return
    # статус на борде — "Ready to IMPL (G2)": матч по префиксу, не по точной строке
    ready = [it for it in items if (it["status"] or "").startswith("Ready to IMPL")]
    ready.sort(key=lambda it: int(it["next_up"]) if it["next_up"] else 99)
    for it in ready:
        # sticky progress marker (2026-09-26): a Ready card carrying a host
        # label belongs to that machine's unfinished session — only that host
        # may re-claim it; the user clears/reassigns the label manually
        if it["host"] and host and it["host"] != host:
            continue
        # gate=blocked (2026-09-26): the card awaits the USER's answer — the
        # pipeline never re-takes it (no auto-retry against a decision)
        if (it["gate"] or "").lower() == "blocked":
            continue
        _, log_body = _auto_impl_log(it["number"])
        if log_body:
            entries = [ln[2:] for ln in log_body.splitlines() if ln.startswith("- ")]
            if entries:
                m2 = re.match(r"(\S+)\s+(\w+)", entries[-1])
                if m2:
                    try:
                        ts = datetime.fromisoformat(m2.group(1).replace("Z", "+00:00"))
                        fresh = (datetime.now(timezone.utc) - ts).total_seconds() <= CLAIM_TTL_HOURS * 3600
                        if fresh and m2.group(2) in ("CLAIM", "BLOCKED"):
                            continue
                    except ValueError:
                        pass
        if _recent_markers(it["number"], ("auto-impl claim:", "auto-impl blocked:")):
            continue
        if _open_deps(it["number"]):
            continue
        print(it["number"])
        return
    print("NONE")


def cmd_pick_next_design():
    """Token protocol for the DESIGN phase kickoff: <number> | NONE (reason).
    Capacity invariant: if ANY board card sits in a status starting with
    "In Design", nothing new enters design (one design at a time).
    Candidates: OPEN issues with board status starting with "Backlog".
    Skipped: cards whose body declares `depends-on: #N` with N still OPEN.
    Order: Next Up position ascending (99 = unset), then board order."""
    all_items = items_with_fields()
    # инвариант мощности: дизайн занят — новых карточек не берём
    busy = [f"#{it['number']}" for it in all_items
            if (it["status"] or "").startswith("In Design")]
    if busy:
        print(f"NONE (design slot busy: {', '.join(busy)})")
        return
    # статус на борде — "Backlog (...)": матч по префиксу, не по точной строке
    backlog = [it for it in all_items
               if it["state"] == "OPEN" and (it["status"] or "").startswith("Backlog")]
    if not backlog:
        print("NONE (no Backlog cards)")
        return
    backlog.sort(key=lambda it: int(it["next_up"]) if it["next_up"] else 99)
    for it in backlog:
        if _open_deps(it["number"]):
            continue
        print(it["number"])
        return
    print("NONE (all Backlog cards blocked by depends-on)")


def _auto_impl_log(number: int):
    """The watcher's single log comment (starts with AUTO_IMPL_LOG_PREFIX)
    → (comment_id, body) or (None, None). Entries are "- <iso-ts> <text>"
    lines appended chronologically at the bottom.
    Fetched via REST: the id must be numeric — `gh issue view --json comments`
    (gh ≥ 2.100) returns GraphQL node ids, and REST PATCH 404s on them."""
    r = subprocess.run(
        ["gh", "api", f"repos/{OWNER}/{REPO}/issues/{number}/comments"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None, None
    for c in json.loads(r.stdout or "[]"):
        if c.get("body", "").startswith(AUTO_IMPL_LOG_PREFIX):
            return c["id"], c["body"]
    return None, None


def cmd_auto_log(number: int, entry: str):
    """Append "<now> <entry>" to the auto-impl log comment (create if missing).
    Read-merge-append: the body is re-fetched right before the patch, so a
    concurrent appender's lines are kept (last writer wins the merge)."""
    line = f"- {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {entry}"
    cid, body = _auto_impl_log(number)
    if cid is None:
        r = subprocess.run(
            ["gh", "issue", "comment", str(number), "--body", f"{AUTO_IMPL_LOG_PREFIX}\n{line}",
             "--repo", f"{OWNER}/{REPO}"], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"auto-log create failed: {r.stderr.strip()}")
        print("log created")
        return
    new_body = body.rstrip("\n") + "\n" + line
    r = subprocess.run(
        ["gh", "api", "-X", "PATCH", f"repos/{OWNER}/{REPO}/issues/comments/{cid}",
         "-f", f"body={new_body}"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"auto-log append failed: {r.stderr.strip()}")
    print("log appended")


def cmd_auto_state(number: int):
    """Last line of the auto-impl log ("<ts> <entry>") or nothing.
    Diagnostics for humans; since 2026-09-20 the claim tiebreak reads the
    host field (cmd_host), not this log."""
    _, body = _auto_impl_log(number)
    if not body:
        return
    entries = [ln[2:] for ln in body.splitlines() if ln.startswith("- ")]
    if entries:
        print(entries[-1])


def cmd_host(number: int, value: str | None = None):
    """No value: print the card's host field (token protocol for the watcher
    tiebreak), or nothing when the card has no host.
    With value: set ('imac'…) or clear ('-') the label. The setter is the
    USER's tool for the sticky progress marker (2026-09-26): a crash-released
    Ready card keeps its host — clearing it (host N -) = the user accepts the
    progress loss; reassigning (host N <label>) hands the unfinished session
    to another machine."""
    load_status_field()
    it = find_item(number)
    if value is None:
        if it["host"]:
            print(it["host"])
        return
    if value == "-":
        if it["host"]:
            set_field(it["item_id"], _host_field_id, None)
            print(f"#{number}: host cleared")
        else:
            print(f"#{number}: host already empty")
        return
    if value not in _host_field_opts:
        sys.exit(f"Unknown host '{value}'. Field options: {', '.join(_host_field_opts)}")
    set_field(it["item_id"], _host_field_id, _host_field_opts[value])
    print(f"#{number}: host → {value}")


def _impl_run_alive(number: int) -> bool | None:
    """Is some `opencode run` process carrying this issue in its cmdline (the
    `--title "#N IMPL.…"` or a «продолжаем траекторию #N» prompt) alive on THIS
    machine? Fallback liveness for the "no session rows yet" window (a launch
    just happened, or the claim was orphaned). /proc-based — None when /proc
    is absent (a macOS host run)."""
    proc = Path("/proc")
    if not proc.is_dir():
        return None
    needle = f"#{number}".encode()
    for p in proc.glob("[0-9]*"):
        try:
            cmdline = (p / "cmdline").read_bytes()
        except OSError:
            continue
        if needle in cmdline:
            return True
    return False


def _run_session_fresh(number: int) -> tuple[bool | None, int | None]:
    """Is work on this card still alive server-side? The `opencode run` CLI is
    only an attach client — it dies/detaches while the session keeps working
    in the `opencode web` server (the "#232 frozen-log" pattern), so a live
    process is NOT the signal. Liveness = the session store (opencode.db — the
    #285 lesson: parts live in the DB, not in a pid): roots are the manager
    "#N IMPL.%" and the architect "IMPL #N %" sessions plus their whole
    parent_id subtree (deeper subagents). Returns (fresh, idle_minutes):
    fresh True = something wrote within SESSION_IDLE_LIMIT_S, False = silent
    longer / no rows (no rows falls back to the run-process check),
    None = session store absent (a host run) — the caller must not treat the
    card as dead; idle_minutes = minutes since the last store write (None when
    unknown — no rows yet or the /proc fallback)."""
    if not SESSION_DB.is_file():
        return None, None
    try:
        con = sqlite3.connect(f"file:{SESSION_DB}?mode=ro", uri=True)
    except sqlite3.Error:
        return None, None
    try:
        row = con.execute(
            """WITH RECURSIVE tree(id) AS (
                   SELECT id FROM session WHERE title LIKE ? OR title LIKE ?
                   UNION
                   SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id
               )
               SELECT MAX(time_updated) FROM session WHERE id IN (SELECT id FROM tree)""",
            (f"#{number} IMPL.%", f"IMPL #{number} %"),
        ).fetchone()
    except sqlite3.Error:
        return None, None
    finally:
        con.close()
    if not row or row[0] is None:
        # сессий нет вообще: только что запущенный CLI ещё живёт в /proc,
        # осиротевший захват (карточка заявлена, запуска не было) — нет
        return _impl_run_alive(number), None
    idle_s = datetime.now(timezone.utc).timestamp() - row[0] / 1000.0
    return idle_s <= SESSION_IDLE_LIMIT_S, int(idle_s // 60)


def _blocked_count(number: int) -> int:
    """BLOCKED entries recorded in the auto-impl log — the crash counter for
    BLOCKED diagnostics (user decision 2026-09-26-C). Deliberately NOT a
    consecutive-run counter: successful claims write no log entries, so "in a
    row" is not knowable from the log alone."""
    _, body = _auto_impl_log(number)
    if not body:
        return 0
    return sum(1 for ln in body.splitlines() if re.match(r"- \S+ BLOCKED\b", ln))


def _nudge_entries(number: int, kind: str) -> list[datetime]:
    """Timestamps of this issue's auto-impl log entries "- <ts> NUDGE-<kind>:"
    within NUDGE_BUDGET_H, oldest first. Network errors → empty list
    (fail-open, same as the other log readers). The NUDGE marker is written
    by the watcher when it sends a wake to an orphan card's manager session;
    it doubles as the wake counter."""
    _, body = _auto_impl_log(number)
    if not body:
        return []
    now = datetime.now(timezone.utc)
    out = []
    for ln in body.splitlines():
        m = re.match(rf"- (\S+) NUDGE-{kind}\b", ln)
        if not m:
            continue
        try:
            ts = datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
        except ValueError:
            continue
        if (now - ts).total_seconds() <= NUDGE_BUDGET_H * 3600:
            out.append(ts)
    return sorted(out)


def _nudge_count_recent(number: int, kind: str) -> int:
    return len(_nudge_entries(number, kind))


def _last_nudge_fresh(number: int, kind: str) -> bool:
    """A wake was sent within CLAIM_TTL_HOURS — give it time to take effect
    before counting it as failed or sending the next one."""
    ents = _nudge_entries(number, kind)
    if not ents:
        return False
    return (datetime.now(timezone.utc) - ents[-1]).total_seconds() <= CLAIM_TTL_HOURS * 3600


def _closing_pr(number: int) -> tuple[int, str] | None:
    """The merged PR whose body closes the issue (Closes/Fixes/Resolves #N)
    → (pr_number, title), or None. Scans recent merges only — the sweep runs
    every few minutes, the gap it repairs is minutes-to-hours old."""
    r = subprocess.run(
        ["gh", "pr", "list", "--state", "merged", "--limit", "30",
         "--repo", f"{OWNER}/{REPO}", "--json", "number,title,body"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None
    pat = re.compile(
        rf"(?im)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:{OWNER}/{REPO})?#{number}\b"
    )
    for pr in json.loads(r.stdout or "[]"):
        if pat.search(pr.get("body") or ""):
            return pr["number"], pr.get("title") or ""
    return None


def _open_issues() -> dict[int, dict]:
    """Open repo issues → number → {number, title, id} (id = the GraphQL node
    id addProjectV2ItemById needs). One cheap REST call; empty dict on
    failure (the mirror sweep is fail-open)."""
    r = subprocess.run(
        ["gh", "issue", "list", "--state", "open", "--limit", "500",
         "--repo", f"{OWNER}/{REPO}", "--json", "number,title,id"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"warn: mirror sweep skipped (issue list failed: {r.stderr.strip()})", file=sys.stderr)
        return {}
    return {i["number"]: i for i in json.loads(r.stdout or "[]")}


def _sub_issue_totals(numbers: list[int]) -> dict[int, int]:
    """Issue number → count of sub-issues (any state — total never shrinks,
    so a direction stays a container even with all its sub-issues done).
    One batched GraphQL query per 100 issues (alias-per-issue). Raises
    SystemExit on failure — the caller decides fail-open."""
    totals: dict[int, int] = {}
    for chunk in (numbers[i:i + 100] for i in range(0, len(numbers), 100)):
        parts = ", ".join(
            f'i{n}: issue(number: {n}) {{ subIssuesSummary {{ total }} }}'
            for n in chunk
        )
        d = gql(f'query {{ repository(owner: "{OWNER}", name: "{REPO}") {{ {parts} }} }}')
        for alias, node in d["repository"].items():
            if node:  # None = the issue vanished between list and query — skip
                totals[int(alias[1:])] = node["subIssuesSummary"]["total"]
    return totals


def _mirror_sweep(items: list[dict], dry_run: bool):
    """Repair 3 in cmd_reconcile — the board mirrors ALL open issues
    (2026-10-07: 47 open issues had silently accumulated off-board again,
    the 2026-09-14 incident recurring). Host-independent, matched by issue
    number. Leaves (issues with no sub-issues): no card → card with
    Status=Backlog; a card with no Status value → Backlog (the native
    "Auto-add to project" workflow adds cards without field values — this
    closes that gap). Containers (issues WITH sub-issues, e.g. the #279
    direction): the card belongs in Hold, never Backlog — a Backlog
    container is pickable work for the design pipeline (user decision
    2026-10-07: Hold is where containers live; «эпик ≠ Backlog», 2026-09-15).
    Container drift kinds: no card → card+Hold, empty status → Hold,
    Backlog → Hold (covers "container created before its first sub-issue" —
    the card first landed in Backlog; totals never shrink, so this repair
    is one-way). Any other status an agent or the user has set is never
    overwritten; closed issues are never carded or stamped. On a failed
    sub-issue totals query the sweep skips the cycle — a container must
    never be guessed into Backlog."""
    open_issues = _open_issues()
    if not open_issues:
        return
    backlog_id = _status_opts.get("Backlog")
    if not backlog_id:
        print("warn: mirror sweep skipped (no 'Backlog' status on the board)", file=sys.stderr)
        return
    try:
        totals = _sub_issue_totals(sorted(open_issues))
    except SystemExit as e:
        print(f"warn: mirror sweep skipped this cycle (sub-issue totals failed: {e})", file=sys.stderr)
        return
    hold_id = _status_opts.get("Hold")
    if not hold_id and any(t > 0 for t in totals.values()):
        print("warn: mirror sweep: no 'Hold' status on the board — container handling skipped", file=sys.stderr)
    carded = {it["number"]: it for it in items if it["number"] in open_issues}

    def target(n: int) -> tuple[str, str] | None:
        """(desc, status_name) for one open issue's drift, or None."""
        it = carded.get(n)
        if totals.get(n, 0) > 0:  # container
            if not hold_id:
                return None
            if it is None:
                return f"#{n}: container issue without a card → added with Status=Hold", "Hold"
            if not it["status"]:
                return f"#{n}: container card without Status → Hold", "Hold"
            if it["status"] == "Backlog":
                return f"#{n}: container card in Backlog → Hold (containers are not pickable work)", "Hold"
            return None
        if it is None:
            return f"#{n}: open issue without a card → added with Status=Backlog", "Backlog"
        if not it["status"]:
            return f"#{n}: card without Status → Backlog", "Backlog"
        return None

    plan: list[tuple[int, str, str]] = []
    for n in sorted(open_issues):
        t = target(n)
        if t:
            plan.append((n, t[0], t[1]))
    for n, desc, status_name in plan:
        if dry_run:
            print(f"would: {desc}")
            continue
        opt_id = hold_id if status_name == "Hold" else backlog_id
        it = carded.get(n)
        if it is None:
            d = gql(f'mutation {{ addProjectV2ItemById(input: {{ projectId: "{PROJECT_ID}", contentId: "{open_issues[n]["id"]}" }}) {{ item {{ id }} }} }}')
            set_field(d["addProjectV2ItemById"]["item"]["id"], _status_field_id, opt_id)
        else:
            set_field(it["item_id"], _status_field_id, opt_id)
        print(desc)
    if plan and not dry_run:
        print(f"mirror sweep: {len(plan)} repair(s) applied")


def cmd_reconcile(host_arg: str | None = None, dry_run: bool = False):
    """Watcher-side sweep of stale cards (top of every auto_impl_watch.sh
    loop). Three repairs. Repairs 1–2 come from the 2026-09-22 incident
    class — a closed or dead card left sitting in In IMPL:
      1. issue CLOSED while the card still sits in In IMPL / PR (G7) — the
         finishing flip was lost (e.g. a network flake at the very end of a
         marathon run): flip to In-main (stateReason COMPLETED) or
         "Not planned", and record the "Recently merged" line when the
         closing PR is found. Host-independent — issue state is global truth.
      2. issue OPEN, status In IMPL, host = this machine (or empty), and the
         run's sessions (opencode.db) silent for over SESSION_IDLE_LIMIT_S or
         never started — the dispatch died or wedged without a BLOCKED report
         (e.g. API unreachable at plan-only start, a dead stream): append a
         BLOCKED entry to the auto-impl log (the card then rests for
         CLAIM_TTL_HOURS — crash-loop throttle) and flip back to Ready to IMPL.
         The host label is PRESERVED on the Ready card (sticky progress marker,
         2026-09-26 user decision): only the owning machine re-claims and
         resumes its own session; foreign hosts skip the card; the user clears
         the label (host N -) to release the progress. The BLOCKED entry
         carries the diagnostics (silent minutes, crash number).
         gate=blocked is PRESERVED across the release (2026-09-26 user
         decision): the silence may be the card waiting for the USER, not a
         dead run — the marker must not hide, pick-next skips such cards (no
         auto-retry) and the user's in-session answer clears the gate,
         returning the card to the pipeline; the log entry then says the
         card awaits the user, not "auto-retry".
      3. Mirror sweep (2026-10-07, the 47-off-board-issues incident): the
         board mirrors ALL open issues — an OPEN issue with no card is added
         with Status=Backlog (containers — issues with sub-issues — go to
         Hold instead: user decision 2026-10-07, a Backlog container is
         pickable work for the design pipeline), and an OPEN issue's card
         with no Status value is stamped by the same rule (the native
         "Auto-add to project" workflow adds cards without field values).
         A status an agent has already set is never overwritten; closed
         issues are never carded. Host-independent.
    Liveness = session-store freshness (the opencode run CLI is a mere attach
    client and dies while the session keeps working — run processes only fill
    the "no session rows yet" window); run this from the container, where the
    store lives; on a host run (no store) repair 2 is skipped (repairs 1 and
    3 still work)."""
    host = _resolve_host(host_arg)
    load_status_field()
    items = items_with_fields()
    _mirror_sweep(items, dry_run)
    for it in items:
        status = (it["status"] or "").lower()
        if not (status.startswith("in impl") or status.startswith("pr")):
            continue
        n = it["number"]
        if it["state"] == "CLOSED":
            target = "In-main"
            r = subprocess.run(
                ["gh", "issue", "view", str(n), "--json", "stateReason",
                 "--repo", f"{OWNER}/{REPO}"],
                capture_output=True, text=True,
            )
            reason = ""
            if r.returncode == 0:
                try:
                    reason = (json.loads(r.stdout) or {}).get("stateReason") or ""
                except ValueError:
                    pass
            if reason and reason != "COMPLETED":
                if "Not planned" not in _status_opts:
                    print(f"warn: #{n} closed as {reason} but the board has no 'Not planned' status — skipped", file=sys.stderr)
                    continue
                target = "Not planned"
            pr = _closing_pr(n)
            desc = (f"#{n}: closed issue in {it['status']} → {target}"
                    + (f" (PR #{pr[0]})" if pr else " (closing PR not found)"))
            if dry_run:
                print(f"would: {desc}")
                continue
            try:
                cmd_status(n, target)
            except SystemExit as e:
                print(f"warn: #{n} flip failed: {e}", file=sys.stderr)
                continue
            if pr:
                try:
                    cmd_merged(n, pr[0], pr[1])
                except SystemExit as e:
                    print(f"warn: #{n} merged line skipped: {e}", file=sys.stderr)
            print(desc)
            continue
        # OPEN card: stuck-run handling, own machine only (the session store
        # is local — a foreign host's sessions are invisible here and would
        # look dead). PR (G7) + OPEN is "legitimately on CI" only while the
        # owner is alive; a dead owner = orphaned PR (2026-09-27, #324).
        if it["host"] and host and it["host"] != host:
            continue
        fresh, idle_min = _run_session_fresh(n)
        if fresh is None:
            print("warn: session store not found — stuck-run check skipped (run reconcile from the container)", file=sys.stderr)
            continue
        if fresh:
            continue
        card_host = it["host"] or ""
        was_blocked = (it["gate"] or "").lower() == "blocked"
        why = (f"сессии молчат {idle_min} мин" if idle_min is not None
               else "сессии так и не стартовали")
        alive = _impl_run_alive(n)
        if not status.startswith("in impl"):
            # PR (G7) orphan: the owner's sessions are dead. A live run
            # process = a legit long CI watch — untouched; gate=blocked =
            # already awaiting the user. Wake budget not exhausted + sessions
            # exist → the watcher nudges (orphans subcommand); otherwise
            # escalate to a visible gate=blocked (user directive 2026-09-26:
            # a card awaiting the user must not hide).
            if alive is not False or was_blocked:
                continue
            nudges = _nudge_count_recent(n, "pr")
            if nudges < NUDGE_BUDGET and idle_min is not None:
                if _last_nudge_fresh(n, "pr"):
                    continue  # a wake was sent <CLAIM_TTL_HOURS ago — give it time
                if dry_run:
                    print(f"would: #{n}: PR (G7) orphan ({why}) — nudge due ({nudges}/{NUDGE_BUDGET})")
                continue  # no flip, no gate — the watcher wakes the manager session
            desc = (f"#{n}: PR (G7) orphan (owner dead: {why}, nudges "
                    f"{nudges}/{NUDGE_BUDGET}) → gate=blocked (awaits the user)")
            if dry_run:
                print(f"would: {desc}")
                continue
            try:
                cmd_auto_log(n, f"BLOCKED reconciler: владелец PR мёртв ({why}), побудок "
                                f"{nudges}/{NUDGE_BUDGET} безуспешно — карточка ждёт "
                                f"пользователя в PR (G7). Разобрать: войти в сессию "
                                f"менеджера либо мерж/правка PR руками; решение снимает "
                                f"метку: python3 .opencode/scripts/gh_board.py gate {n} none")
            except SystemExit as e:
                print(f"warn: #{n} auto-log failed: {e}", file=sys.stderr)
            if _gate_field_id and "blocked" in _gate_field_opts:
                set_field(it["item_id"], _gate_field_id, _gate_field_opts["blocked"])
                print(f"#{n}: gate → blocked (PR orphan)")
            print(desc)
            continue
        # In IMPL stuck-dispatch repair, with the 2026-09-27 wake-first stage:
        # a fully dead client (no run process) and existing sessions = nudge
        # territory — the watcher wakes the manager session hourly (ping-gated
        # via llm_ping.sh) up to NUDGE_BUDGET within NUDGE_BUDGET_H. A
        # wedged-but-live client or a gate=blocked card keeps the 2026-09-26
        # release semantics (a second driver is worse than a release; the
        # silence may be the card awaiting the user).
        sticky = (f"; прогресс хоста {card_host} сохранён (метка host на Ready-карточке: "
                  f"продолжит только {card_host}, чужие хосты не берут; снять решением "
                  f"юзера: python3 .opencode/scripts/gh_board.py host {n} -)"
                  if card_host else "")
        if idle_min is not None and not was_blocked and alive is False:
            nudges = _nudge_count_recent(n, "impl")
            if nudges < NUDGE_BUDGET:
                if _last_nudge_fresh(n, "impl"):
                    continue  # wake sent recently — give it time to take effect
                if dry_run:
                    print(f"would: #{n}: In IMPL orphan ({why}) — nudge due ({nudges}/{NUDGE_BUDGET})")
                continue  # release deferred; the watcher wakes the manager session
            # wake budget exhausted (2026-09-28: hourly wakes for a full day) —
            # the run had 24h and never recovered: release AND park on
            # gate=blocked. The old path (plain crash release) let pick-next
            # re-claim the card and re-burn the manager context every hour
            # (the #348 night); the gate makes the stop visible and sticky —
            # only the user's answer clears it.
            desc = (f"#{n}: In IMPL orphan ({why}), побудок {nudges}/{NUDGE_BUDGET} за "
                    f"сутки безрезультатно → Ready to IMPL + gate=blocked (awaits the user)"
                    + (f", host kept: {card_host}" if card_host else ""))
            if dry_run:
                print(f"would: {desc}")
                continue
            try:
                cmd_auto_log(n, f"BLOCKED reconciler: прогон не ожил после {nudges} "
                                f"почасовых побудок за сутки ({why}) — карточка в Ready "
                                f"to IMPL с gate=blocked, дальше только решение "
                                f"пользователя (снять: python3 .opencode/scripts/gh_board.py "
                                f"gate {n} none)" + sticky)
            except SystemExit as e:
                print(f"warn: #{n} auto-log failed: {e}", file=sys.stderr)
            try:
                cmd_status(n, "Ready to IMPL")
            except SystemExit as e:
                print(f"warn: #{n} flip failed: {e}", file=sys.stderr)
                continue
            if card_host and card_host in _host_field_opts:
                set_field(it["item_id"], _host_field_id, _host_field_opts[card_host])
                print(f"#{n}: host kept → {card_host}")
            if _gate_field_id and "blocked" in _gate_field_opts:
                set_field(it["item_id"], _gate_field_id, _gate_field_opts["blocked"])
                print(f"#{n}: gate → blocked (wake budget exhausted)")
            print(desc)
            continue
        crash_no = _blocked_count(n) + 1
        desc = (f"#{n}: In IMPL stuck (crash #{crash_no}) → BLOCKED auto-log entry "
                f"+ Ready to IMPL" + (f", host kept: {card_host}" if card_host else "")
                + (", gate kept: blocked (awaits the user)" if was_blocked else ""))
        if dry_run:
            print(f"would: {desc}")
            continue
        # auto-log FIRST: pick-next must never see the card ready without the
        # resting marker (a crash-loop of dead dispatches follows otherwise)
        try:
            if was_blocked:
                # the silence is the card WAITING for the user, not a dead run
                # (2026-09-26): no auto-retry promise — the unblock is the
                # user's answer in the session
                cmd_auto_log(n, f"BLOCKED: карточка ждёт решения пользователя "
                                f"(прогон молчит: {why}); метка blocked сохранена на "
                                f"Ready-карточке, авто-повтора не будет — конвейер её "
                                f"не трогает; ответ на блокер в сессии opencode снимет "
                                f"метку и вернёт карточку в работу" + sticky)
            else:
                cmd_auto_log(n, f"BLOCKED reconciler: прогон завис — {why}, сбой №{crash_no} "
                                f"по счёту; карточка возвращена в Ready to IMPL, "
                                f"авто-повтор после отдыха" + sticky)
        except SystemExit as e:
            print(f"warn: #{n} auto-log failed: {e}", file=sys.stderr)
        try:
            cmd_status(n, "Ready to IMPL")
        except SystemExit as e:
            print(f"warn: #{n} flip failed: {e}", file=sys.stderr)
            continue
        if card_host and card_host in _host_field_opts:
            # sticky progress marker (2026-09-26): the label survives the crash
            # release so only the owning machine re-claims and resumes its own
            # session; the USER clears it (host N -), accepting the loss
            set_field(it["item_id"], _host_field_id, _host_field_opts[card_host])
            print(f"#{n}: host kept → {card_host}")
        if was_blocked and _gate_field_id and "blocked" in _gate_field_opts:
            # the awaiting-user marker survives the crash release (2026-09-26):
            # cmd_status cleared it with the flip — re-stamp so the blocked
            # state stays visible on the Ready card until the user answers
            set_field(it["item_id"], _gate_field_id, _gate_field_opts["blocked"])
            print(f"#{n}: gate kept → blocked")
        print(desc)


def cmd_orphans(host_arg: str | None = None):
    """Token protocol for auto_impl_watch.sh: lines "impl <N>" / "pr <N>"
    (nudge-due orphan cards on this machine) or "NONE".
    An orphan: OPEN card, own host, board status In IMPL / PR (G7), session
    store silent > SESSION_IDLE_LIMIT_S, no live run process, gate != blocked,
    last wake stale (CLAIM_TTL_HOURS), wake budget not exhausted
    (NUDGE_BUDGET within NUDGE_BUDGET_H — the escalation is
    reconcile's job). Only cards with existing session rows are listed: a
    wake without a session is pointless (no rows → reconcile releases the
    In IMPL card or escalates the PR (G7) card directly)."""
    host = _resolve_host(host_arg)
    if not host:
        sys.exit("orphans needs a host: pass it as an argument or set GH_BOARD_HOST")
    load_status_field()
    out = []
    for it in items_with_fields():
        if it["state"] != "OPEN":
            continue
        status = (it["status"] or "").lower()
        kind = "impl" if status.startswith("in impl") else ("pr" if status.startswith("pr") else None)
        if not kind:
            continue
        if (it["host"] or "") != host:
            continue
        if (it["gate"] or "").lower() == "blocked":
            continue
        fresh, idle_min = _run_session_fresh(it["number"])
        if fresh is not False or idle_min is None:
            continue  # alive / no store / no sessions — nothing to wake
        if _impl_run_alive(it["number"]) is not False:
            continue  # a live client must never get a second driver
        if _last_nudge_fresh(it["number"], kind):
            continue  # a wake was just sent
        if _nudge_count_recent(it["number"], kind) >= NUDGE_BUDGET:
            continue  # exhausted — reconcile parks the card on gate=blocked
        out.append(f"{kind} {it['number']}")
    print("\n".join(out) if out else "NONE")


def cmd_show(arg: str):
    if arg == "all":
        items = sorted(items_with_fields(), key=lambda it: it["number"])
        if not items:
            print("Board is empty.")
            return
        print(f"{'#':>5}  {'Status':<18} {'NextUp':<6} {'Host':<7} {'Gate':<8}  Title")
        for it in items:
            print(f"{it['number']:>5}  {(it['status'] or '-'):<18} {(it['next_up'] or '-'):<6} {(it['host'] or '-'):<7} {(it['gate'] or '-'):<8}  {it['title']} [{it['state']}]")
        return
    if not arg.isdigit():
        sys.exit("argument must be an issue number or 'all'")
    number = int(arg)
    for it in items_with_fields():
        if it["number"] == number:
            print(f"#{number} [{it['state']}] {it['title']}")
            print(f"  Status: {it['status'] or '-'}")
            print(f"  Next Up: {it['next_up'] or '-'}")
            print(f"  Host: {it['host'] or '-'}")
            print(f"  Gate: {it['gate'] or '-'}")
            return
    sys.exit(f"#{number} is not on the board. It is added automatically by the first set-next-up/status call.")


def cmd_set_next_up(number: int, pos: str):
    it = find_item(number)
    if pos == "none":
        set_field(it["item_id"], NEXT_UP_FIELD, None)
        print(f"#{number}: Next Up cleared")
        return
    if pos not in NEXT_UP_OPTS:
        sys.exit("pos must be 1|2|3|none")
    # conflict: if the position is taken by another issue — clear it there
    for other in items_with_fields():
        if other["next_up"] == pos and other["number"] != number:
            set_field(other["item_id"], NEXT_UP_FIELD, None)
            print(f"#{other['number']}: Next Up {pos} freed (was occupied)")
    set_field(it["item_id"], NEXT_UP_FIELD, NEXT_UP_OPTS[pos])
    print(f"#{number}: Next Up = {pos}")


def cmd_shift():
    items = {it["next_up"]: it for it in items_with_fields() if it["next_up"]}
    if "1" in items:
        set_field(items["1"]["item_id"], NEXT_UP_FIELD, None)
        print(f"#{items['1']['number']}: Next Up 1 cleared (completed)")
    for src, dst in (("2", "1"), ("3", "2")):
        if src in items:
            set_field(items[src]["item_id"], NEXT_UP_FIELD, NEXT_UP_OPTS[dst])
            print(f"#{items[src]['number']}: Next Up {src} → {dst}")
    print("Queue shifted. Position 3 is free.")


def cmd_status(number: int, status: str, host: str | None = None):
    """Move a card's status. Entering In IMPL/In Design also stamps the host
    field (arg > GH_BOARD_HOST > container label file; unresolved → warning,
    field left as is); leaving those statuses clears host AND gate — a card
    that left its phase carries no stale ownership or pending ask.
    Exception (2026-09-21): PR (G7) keeps the host — the card is still owned
    by its machine while on CI (and returns to it if CI is red) — but it
    occupies no IMPL slot (the budget counts only In IMPL status). Leaving
    PR (G7) clears the label. Exception (2026-09-26): the reconcile crash
    release re-stamps a preserved gate=blocked after the flip — the
    awaiting-user marker survives the release (cmd_status itself always
    clears)."""
    load_status_field()
    if status not in _status_opts:
        sys.exit(f"Unknown status '{status}'. Available: {', '.join(_status_opts)}")
    it = find_item(number)
    set_field(it["item_id"], _status_field_id, _status_opts[status])
    print(f"#{number}: Status → {status}")
    if status.lower().startswith(("in impl", "in design")):
        h = _resolve_host(host)
        if not h:
            print("warn: host not resolved (arg/GH_BOARD_HOST/label file) — host field left unchanged", file=sys.stderr)
        elif h not in _host_field_opts:
            sys.exit(f"Unknown host '{h}'. Field options: {', '.join(_host_field_opts)}")
        else:
            set_field(it["item_id"], _host_field_id, _host_field_opts[h])
            print(f"#{number}: host → {h}")
    elif status.lower().startswith("pr"):
        if it["gate"]:
            set_field(it["item_id"], _gate_field_id, None)
            print(f"#{number}: gate cleared")
    else:
        if it["host"]:
            set_field(it["item_id"], _host_field_id, None)
            print(f"#{number}: host cleared")
        if it["gate"]:
            set_field(it["item_id"], _gate_field_id, None)
            print(f"#{number}: gate cleared")


def cmd_gate(number: int, value: str):
    """Set the card's gate field — the pending-ask marker: concept|spec|plan
    = a design gate stop, blocked = an IMPL blocker awaiting the user,
    auto-retry = a temporary upstream pause the watcher stamps and clears
    itself (nobody awaits the user); none = the ask is answered (also
    cleared automatically when the card leaves In IMPL/In Design via
    cmd_status). Idempotent (2026-10-06): the watcher may call it every
    cycle — re-setting the current value (or clearing an already-empty
    gate) prints "gate unchanged" and performs no GraphQL write."""
    load_status_field()
    it = find_item(number)
    if value == "none":
        if not it["gate"]:
            print(f"#{number}: gate unchanged (empty)")
            return
        set_field(it["item_id"], _gate_field_id, None)
        print(f"#{number}: gate cleared")
        return
    if value not in _gate_field_opts:
        sys.exit(f"Unknown gate '{value}'. Available: {', '.join(_gate_field_opts)}, none")
    if (it["gate"] or "").lower() == value.lower():
        print(f"#{number}: gate unchanged ({value})")
        return
    set_field(it["item_id"], _gate_field_id, _gate_field_opts[value])
    print(f"#{number}: gate → {value}")


def cmd_issue(number: int):
    """Standard `gh issue view` with fixed output — replaces ad-hoc `--json … -q …` compositions
    (audit 2026-09-09: 33 hand-rolled calls in 3 weeks). Body is capped at 120 lines."""
    r = subprocess.run(
        ["gh", "issue", "view", str(number), "--repo", f"{OWNER}/{REPO}",
         "--json", "number,title,state,labels,body,url"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"gh issue view error: {r.stderr.strip()}")
    d = json.loads(r.stdout)
    labels = ", ".join(l["name"] for l in d.get("labels") or [])
    print(f"#{d['number']} [{d['state']}] {d['title']}")
    if labels:
        print(f"  Labels: {labels}")
    print(f"  {d['url']}")
    body = (d.get("body") or "").rstrip("\n")
    lines = body.split("\n")
    print()
    print("\n".join(lines[:120]))
    if len(lines) > 120:
        print(f"... [body truncated, {len(lines) - 120} more lines]")


def cmd_merged(number: int, pr: int, title: str = ""):
    """Append "- YYYY-MM-DD #issue [title] → PR #n" to "## Recently merged" (newest first, max 5).

    Scratchpad Discipline v2: the manager runs this at the In-main board flip;
    the session section is then removed. Creates the block (right under the
    file title) when missing.
    """
    if not SCRATCHPAD.exists():
        sys.exit(f"scratchpad not found at {SCRATCHPAD}")
    lines = SCRATCHPAD.read_text(encoding="utf-8").rstrip("\n").split("\n")
    stamp = subprocess.run(["date", "+%F"], capture_output=True, text=True).stdout.strip() \
        or date.today().isoformat()
    entry = f"- {stamp} #{number}" + (f" {title}" if title else "") + f" → PR #{pr}"

    if MERGED_BLOCK in lines:
        head = lines.index(MERGED_BLOCK)
        hard_end = len(lines)
        for i in range(head + 1, len(lines)):
            if lines[i].strip() and not lines[i].startswith("- "):
                hard_end = i
                break
        entries = [ln for ln in lines[head + 1:hard_end] if ln.startswith("- ")]
        if any(f"#{number}" in e and f"PR #{pr}" in e for e in entries):
            print(f"Already recorded: #{number} → PR #{pr}")
            return
        entries = ([entry] + entries)[:MERGED_MAX]
        n_entries = len(entries)
        new = lines[:head] + [MERGED_BLOCK] + entries
        if hard_end < len(lines) and lines[hard_end].strip():
            new.append("")
        new += lines[hard_end:]
    else:
        insert_at = 1 if lines and lines[0].startswith("# ") else 0
        while insert_at < len(lines) and not lines[insert_at].strip():
            insert_at += 1
        new = lines[:insert_at] + [MERGED_BLOCK, entry, ""] + lines[insert_at:]
        n_entries = 1

    SCRATCHPAD.write_text("\n".join(new) + "\n", encoding="utf-8")
    print(f"Recently merged: {entry}")
    print(f"block now holds {n_entries}/{MERGED_MAX} entries")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd = args[0]
    if cmd == "next-up":
        cmd_next_up()
    elif cmd == "pick-next" and len(args) <= 2:
        cmd_pick_next(args[1] if len(args) == 2 else None)
    elif cmd == "pick-next-design":
        cmd_pick_next_design()
    elif cmd == "auto-log" and len(args) == 3:
        cmd_auto_log(int(args[1]), args[2])
    elif cmd == "auto-state" and len(args) == 2:
        cmd_auto_state(int(args[1]))
    elif cmd == "host" and len(args) in (2, 3):
        cmd_host(int(args[1]), args[2] if len(args) == 3 else None)
    elif cmd == "reconcile":
        flags = [a for a in args[1:] if a.startswith("--")]
        rest = [a for a in args[1:] if not a.startswith("--")]
        if len(rest) > 1 or any(f != "--dry-run" for f in flags):
            print(__doc__)
            sys.exit(1)
        cmd_reconcile(rest[0] if rest else None, dry_run="--dry-run" in flags)
    elif cmd == "orphans" and len(args) <= 2:
        cmd_orphans(args[1] if len(args) == 2 else None)
    elif cmd == "show" and len(args) == 2:
        cmd_show(args[1])
    elif cmd == "set-next-up" and len(args) == 3:
        cmd_set_next_up(int(args[1]), args[2])
    elif cmd == "shift":
        cmd_shift()
    elif cmd == "status" and len(args) in (3, 4):
        cmd_status(int(args[1]), args[2], args[3] if len(args) == 4 else None)
    elif cmd == "gate" and len(args) == 3:
        cmd_gate(int(args[1]), args[2])
    elif cmd == "merged" and len(args) >= 3:
        cmd_merged(int(args[1]), int(args[2]), " ".join(args[3:]).strip())
    elif cmd == "issue" and len(args) == 2:
        cmd_issue(int(args[1]))
    else:
        print(__doc__)
        sys.exit(1)
