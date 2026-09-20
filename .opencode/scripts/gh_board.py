#!/usr/bin/env python3
"""gh_board.py — GH Project #3 (Memo Project) board management.

Usage (from repo root):
  python3 .zcode/scripts/gh_board.py next-up                     — show the trajectory (Next Up 1→3)
  python3 .zcode/scripts/gh_board.py pick-next [host]           — token for auto-impl watcher: NONE | <issue>; per-host budget HOST_BUDGETS
  python3 .zcode/scripts/gh_board.py host N                     — the card's host field value (watcher tiebreak token)
  python3 .zcode/scripts/gh_board.py pick-next-design            — token for design kickoff: <issue> | NONE (reason)
  python3 .zcode/scripts/gh_board.py auto-log N "BLOCKED ..."    — append an entry to the issue's auto-impl log comment
  python3 .zcode/scripts/gh_board.py auto-state N                — last auto-impl log entry (or nothing)
  python3 .zcode/scripts/gh_board.py show N                      — read one card: status + queue position
  python3 .zcode/scripts/gh_board.py show all                    — the whole board as a table
  python3 .zcode/scripts/gh_board.py set-next-up N 1|2|3|none    — set/clear queue position
  python3 .zcode/scripts/gh_board.py shift                       — after Next Up 1 completes: clear it, shift 2→1, 3→2
  python3 .zcode/scripts/gh_board.py status N "In IMPL" [host]  — move a card; entering In IMPL/In Design stamps the host field, leaving clears it
  python3 .zcode/scripts/gh_board.py merged N PR ["short title"] — append the "Recently merged" line (scratchpad v2)
  python3 .zcode/scripts/gh_board.py issue N                      — standard issue view: state, labels, body

Project constants are hardcoded (IDs are stable for Project #3).
Card ownership lives in the single-select field "host" (options: imac,
macbook, hk, gcp — created manually 2026-09-20): claiming is a field write
and the race tiebreak re-reads the field. This replaced the CLAIM-comment
mechanism; the auto-impl log comment remains the BLOCKED channel only.
The script is part of the host/container seam and travels via git.
Identical copies ship in BOTH harness folders — .zcode/scripts/ (host)
and .opencode/scripts/ (container); when editing, change both (or edit
one and copy over).
"""
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

SCRATCHPAD = Path(__file__).resolve().parents[2] / ".opencode" / "scratchpad.md"
MERGED_BLOCK = "## Recently merged"
MERGED_MAX = 5

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
    global _status_field_id, _status_opts, _host_field_id, _host_field_opts
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
    if not _status_field_id:
        sys.exit("Status field not found")
    if not _host_field_id:
        sys.exit(f"'{HOST_FIELD_NAME}' single-select field not found — create it on the project (options: imac, macbook, hk, gcp)")


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
        "status": None, "next_up": None, "host": None,
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
        print(f"  {it['next_up']}. #{it['number']} [{it['status'] or 'no status'}] {it['title']}")


CLAIM_TTL_HOURS = 1  # auto-impl: freshness of claim/blocked log entries — a fresh entry means the card is in flight or resting
HOST_BUDGETS = {"imac": 2, "macbook": 1}  # auto-impl: per-machine In IMPL slots (replaced the global MAX_TOTAL_INFLIGHT on 2026-09-20: parked cards on one machine must not starve another)
DEFAULT_HOST_BUDGET = 1  # unknown hosts (hk, gcp — reserved) get one slot
HOST_FIELD_NAME = "host"  # single-select ownership field; options imac/macbook/hk/gcp
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
    Skipped: cards whose auto-impl log comment's LAST entry is a fresh
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


def cmd_host(number: int):
    """The card's host field value (token protocol for the watcher tiebreak):
    prints the option name, or nothing when the card has no host."""
    for it in items_with_fields():
        if it["number"] == number:
            if it["host"]:
                print(it["host"])
            return
    sys.exit(f"#{number} is not on the board")


def cmd_show(arg: str):
    if arg == "all":
        items = sorted(items_with_fields(), key=lambda it: it["number"])
        if not items:
            print("Board is empty.")
            return
        print(f"{'#':>5}  {'Status':<18} {'NextUp':<6} {'Host':<7}  Title")
        for it in items:
            print(f"{it['number']:>5}  {(it['status'] or '-'):<18} {(it['next_up'] or '-'):<6} {(it['host'] or '-'):<7}  {it['title']} [{it['state']}]")
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
    field left as is); leaving those statuses clears it — the field is the
    single ownership source, there is no comment fallback."""
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
    elif it["host"]:
        set_field(it["item_id"], _host_field_id, None)
        print(f"#{number}: host cleared")


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
    elif cmd == "host" and len(args) == 2:
        cmd_host(int(args[1]))
    elif cmd == "show" and len(args) == 2:
        cmd_show(args[1])
    elif cmd == "set-next-up" and len(args) == 3:
        cmd_set_next_up(int(args[1]), args[2])
    elif cmd == "shift":
        cmd_shift()
    elif cmd == "status" and len(args) in (3, 4):
        cmd_status(int(args[1]), args[2], args[3] if len(args) == 4 else None)
    elif cmd == "merged" and len(args) >= 3:
        cmd_merged(int(args[1]), int(args[2]), " ".join(args[3:]).strip())
    elif cmd == "issue" and len(args) == 2:
        cmd_issue(int(args[1]))
    else:
        print(__doc__)
        sys.exit(1)
