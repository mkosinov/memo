#!/usr/bin/env bash
# =============================================================================
# scripts/release.sh — milestone → release (GH #616, spec §4.1).
# =============================================================================
#
# One command = release = deploy. Automates the release ritual over the gh
# CLI: verifies the milestone is fully closed, closes it, builds the release
# notes from its issues (number + title per line), and publishes
# `gh release create <tag> --target main` — whose `published` event is what
# triggers deploy.yml (spec §4.2). Tag naming convention: name the tag after
# the milestone (`v1`, `v1.1`) — the script resolves the milestone by tag
# name first and prints a notice when they diverge.
#
# Usage:
#   scripts/release.sh <tag> [--milestone <number|title>] [--dry-run]
#                      [--force] [--repo <owner/repo>] [-h | --help]
#
#   <tag>                       release tag, e.g. v1 (recommended = milestone
#                               title, spec §4.1)
#   --milestone <number|title>  which milestone to release. Default: the
#                               milestone whose title equals <tag>; else the
#                               repo's single OPEN milestone; ambiguous/none
#                               → error listing candidates.
#   --dry-run                   print the full plan — milestone, issue list,
#                               tag, target commit (main HEAD sha), notes
#                               preview, the exact commands a real run would
#                               execute — and exit 0. NOTHING is mutated:
#                               no milestone edits, no release, no side
#                               effects (read-only gh queries).
#   --force                     bypass the open-issues stop (conscious
#                               override; the check result is still printed).
#   --repo <owner/repo>         target repo (default: the repo of the CWD).
#
# Exit codes:
#   0  success — release published (or dry-run plan printed)
#   1  usage / preflight — bad flags, gh missing, repo/milestone not found
#      or ambiguous, tag or release already exists
#   2  milestone closure failed (gh api PATCH …/milestones/N)
#   3  milestone has OPEN issues and no --force — release refused
#   4  release creation failed (gh release create)
#
# Notes are built from ALL issues of the milestone (PRs excluded by
# `gh issue list`), one "#<number> <title>" line each, sorted by number.
# Milestone table is fetched with per_page=100 (no pagination loop — this
# repo's milestone count is two orders of magnitude below that cap).
# =============================================================================

set -euo pipefail

log() { printf 'release: %s\n' "$1"; }
warn() { printf 'release: WARNING: %s\n' "$1" >&2; }
die() { # die <exit-code> <message...>
  local code=$1
  shift
  printf 'release: ERROR: %s\n' "$*" >&2
  exit "$code"
}

usage() {
  cat <<'EOF'
scripts/release.sh — milestone → release (GH #616, spec §4.1)

One command = release = deploy: verify milestone closed → close it →
notes from its issues → gh release create <tag> --target main (the
`published` event triggers deploy.yml).

Usage:
  scripts/release.sh <tag> [--milestone <number|title>] [--dry-run]
                     [--force] [--repo <owner/repo>]
  scripts/release.sh --help

Examples:
  scripts/release.sh v1 --dry-run     print the plan, execute nothing
  scripts/release.sh v1               release milestone "v1" as tag v1
  scripts/release.sh v1.1 --milestone 3
  scripts/release.sh v1 --force       release despite open issues

Milestone resolution (--milestone omitted): exact title == <tag>, else the
single open milestone of the repo.

Exit codes: 0 ok | 1 usage/preflight | 2 milestone closure failed |
3 open issues (no --force) | 4 release create failed.
EOF
}

# ── args ────────────────────────────────────────────────────────────────────
TAG=
MILESTONE_SEL=
DRY_RUN=0
FORCE=0
REPO=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --milestone)
      [ "$#" -ge 2 ] || die 1 "--milestone needs a value (number or title)"
      MILESTONE_SEL=$2
      shift
      ;;
    --milestone=*) MILESTONE_SEL=${1#*=} ;;
    --repo)
      [ "$#" -ge 2 ] || die 1 "--repo needs a value (owner/repo)"
      REPO=$2
      shift
      ;;
    --repo=*) REPO=${1#*=} ;;
    -h | --help) usage; exit 0 ;;
    -*) die 1 "unknown option: $1 (see --help)" ;;
    *)
      [ -z "$TAG" ] || die 1 "unexpected second positional argument: $1 (tag only)"
      TAG=$1
      ;;
  esac
  shift
done
[ -n "$TAG" ] || { usage >&2; die 1 "tag is required, e.g.: scripts/release.sh v1 --dry-run"; }

# ── preflight ───────────────────────────────────────────────────────────────
command -v gh >/dev/null 2>&1 || die 1 "gh CLI not found (see https://cli.github.com/)"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) ||
    die 1 "could not detect repo from CWD — run inside the repo or pass --repo owner/repo"
fi

# Milestone table: number <TAB> title <TAB> state (all states, one page).
MILESTONES_TSV=$(gh api "repos/$REPO/milestones?state=all&per_page=100" \
  --jq '.[] | [(.number | tostring), (.title // ""), (.state // "")] | @tsv')

ms_row_by_title() { # exact title match → "num<TAB>title<TAB>state" on stdout
  local want=$1 n t s
  while IFS=$'\t' read -r n t s; do
    [ -n "${n:-}" ] || continue
    if [ "$t" = "$want" ]; then
      printf '%s\t%s\t%s\n' "$n" "$t" "$s"
      return 0
    fi
  done <<<"$MILESTONES_TSV"
  return 1
}

# ── milestone resolution ────────────────────────────────────────────────────
if [ -n "$MILESTONE_SEL" ]; then
  if ROW=$(ms_row_by_title "$MILESTONE_SEL"); then
    :
  elif [[ $MILESTONE_SEL =~ ^[0-9]+$ ]]; then
    ROW=$(gh api "repos/$REPO/milestones/$MILESTONE_SEL" \
      --jq '[(.number | tostring), (.title // ""), (.state // "")] | @tsv' 2>/dev/null) ||
      die 1 "milestone not found: #$MILESTONE_SEL (in $REPO)"
  else
    die 1 "milestone not found by title: \"$MILESTONE_SEL\" (in $REPO)"
  fi
elif ROW=$(ms_row_by_title "$TAG"); then
  : # tag == milestone title — the recommended pairing (spec §4.1)
else
  OPEN_COUNT_MS=0
  OPEN_ROW=
  OPEN_LIST=
  while IFS=$'\t' read -r n t s; do
    [ -n "${n:-}" ] || continue
    [ "$s" = "open" ] || continue
    OPEN_COUNT_MS=$((OPEN_COUNT_MS + 1))
    OPEN_ROW=$(printf '%s\t%s\t%s' "$n" "$t" "$s")
    OPEN_LIST=${OPEN_LIST}$(printf '  #%s "%s"\n' "$n" "$t")
  done <<<"$MILESTONES_TSV"
  [ "$OPEN_COUNT_MS" -gt 0 ] || die 1 "no open milestones in $REPO — nothing to release (pass --milestone for a closed one)"
  [ "$OPEN_COUNT_MS" -eq 1 ] || die 1 "ambiguous: $OPEN_COUNT_MS open milestones — pass --milestone:
$OPEN_LIST"
  ROW=$OPEN_ROW
fi
IFS=$'\t' read -r MS_NUM MS_TITLE MS_STATE <<<"$ROW"
log "milestone: #$MS_NUM \"$MS_TITLE\" [$MS_STATE] (repo $REPO)"
if [ "$MS_TITLE" != "$TAG" ]; then
  warn "tag \"$TAG\" != milestone title \"$MS_TITLE\" — spec §4.1 recommends naming the tag after the milestone"
fi

# ── milestone issues → plan lines + notes lines ─────────────────────────────
ISSUES_TSV=$(gh issue list -R "$REPO" --milestone "$MS_NUM" --state all --limit 1000 \
  --json number,title,state \
  --jq 'sort_by(.number) | .[] | [(.state // "UNKNOWN"), (.number | tostring), (.title // "")] | @tsv')
ISSUE_LINES=()
NOTES_LINES=()
TOTAL=0
OPEN_ISSUES=0
while IFS=$'\t' read -r st num title; do
  [ -n "${num:-}" ] || continue
  TOTAL=$((TOTAL + 1))
  if [ "$st" = "OPEN" ]; then
    OPEN_ISSUES=$((OPEN_ISSUES + 1))
    ISSUE_LINES+=("  OPEN     #${num}  ${title}")
  else
    ISSUE_LINES+=("  closed   #${num}  ${title}")
  fi
  NOTES_LINES+=("#${num} ${title}")
done <<<"$ISSUES_TSV"
CLOSED_ISSUES=$((TOTAL - OPEN_ISSUES))

# ── target commit + existing tag/release probe ─────────────────────────────
TARGET_SHA=$(gh api "repos/$REPO/commits/main" --jq '.sha') ||
  die 1 "could not resolve main HEAD in $REPO (branch 'main' exists?)"
TAG_EXISTS=0
TAG_REF=$(printf '%s' "$TAG" | sed 's|/|%2F|g')
gh api "repos/$REPO/git/ref/tags/$TAG_REF" >/dev/null 2>&1 && TAG_EXISTS=1
RELEASE_EXISTS=0
gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 && RELEASE_EXISTS=1

# ── dry run: print the plan, touch nothing ──────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  printf 'release: DRY RUN — nothing will be executed (no milestone edits, no release)\n'
  printf '  repo:          %s\n' "$REPO"
  printf '  milestone:     #%s "%s" [%s] — %d closed / %d open issue(s)\n' \
    "$MS_NUM" "$MS_TITLE" "$MS_STATE" "$CLOSED_ISSUES" "$OPEN_ISSUES"
  printf '  tag:           %s\n' "$TAG"
  printf '  target:        main @ %s\n' "$TARGET_SHA"
  printf '  release title: %s\n' "$TAG"
  [ "$TAG_EXISTS" -eq 0 ] || printf '  NOTE: git tag %s already exists — gh would reuse it and IGNORE --target main\n' "$TAG"
  [ "$RELEASE_EXISTS" -eq 0 ] || printf '  NOTE: release %s already exists — a real run would fail (exit 1)\n' "$TAG"
  printf '  issues in milestone "%s" (%d):\n' "$MS_TITLE" "$TOTAL"
  if [ "$TOTAL" -gt 0 ]; then
    printf '%s\n' "${ISSUE_LINES[@]}"
  else
    printf '    (none)\n'
  fi
  if [ "$OPEN_ISSUES" -gt 0 ]; then
    printf '  check: %d OPEN issue(s) — real run would STOP here (exit 3); --force overrides\n' "$OPEN_ISSUES"
  else
    printf '  check: all issues closed — OK\n'
  fi
  printf '  release notes preview (%d lines):\n' "${#NOTES_LINES[@]}"
  printf '  ---- notes begin ----\n'
  [ "${#NOTES_LINES[@]}" -gt 0 ] && printf '  %s\n' "${NOTES_LINES[@]}"
  printf '  ---- notes end ----\n'
  printf '  a real run would:\n'
  if [ "$MS_STATE" = "open" ]; then
    printf '    1. close milestone #%s "%s"\n' "$MS_NUM" "$MS_TITLE"
  else
    printf '    1. (milestone #%s already closed — skip closure)\n' "$MS_NUM"
  fi
  printf '    2. gh release create %s --target main --title "%s" --notes-file <tmp> -R %s\n' "$TAG" "$TAG" "$REPO"
  printf '    3. deploy.yml triggers on the release "published" event (spec §4.2)\n'
  exit 0
fi

# ── real run ────────────────────────────────────────────────────────────────
[ "$RELEASE_EXISTS" -eq 0 ] || die 1 "release $TAG already exists in $REPO (gh release view $TAG)"
[ "$TAG_EXISTS" -eq 0 ] || die 1 "git tag $TAG already exists — gh would reuse it and ignore --target main; delete it first or pick another tag"

if [ "$OPEN_ISSUES" -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  warn "milestone \"$MS_TITLE\" has $OPEN_ISSUES open issue(s):"
  printf '%s\n' "${ISSUE_LINES[@]}" | grep '  OPEN' >&2 || true
  die 3 "close them first, or rerun with --force to override"
fi
[ "$OPEN_ISSUES" -eq 0 ] || warn "--force: releasing with $OPEN_ISSUES open issue(s) — conscious override"

if [ "$MS_STATE" = "open" ]; then
  log "closing milestone #$MS_NUM \"$MS_TITLE\"…"
  gh api -X PATCH "repos/$REPO/milestones/$MS_NUM" -f state=closed >/dev/null ||
    die 2 "failed to close milestone #$MS_NUM (gh api PATCH)"
else
  log "milestone #$MS_NUM already closed — skipping closure"
fi

NOTES_FILE=$(mktemp)
trap 'rm -f "$NOTES_FILE"' EXIT
printf '%s\n' "${NOTES_LINES[@]}" >"$NOTES_FILE"
log "creating release $TAG (target main @ $TARGET_SHA)…"
if ! gh release create "$TAG" --target main --title "$TAG" --notes-file "$NOTES_FILE" -R "$REPO"; then
  die 4 "gh release create failed — milestone #$MS_NUM is already closed; rerun the SAME command to retry the release"
fi
log "release $TAG published — deploy.yml should be building & deploying (spec §4.2)"
