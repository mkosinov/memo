#!/usr/bin/env bash
# =============================================================================
# deploy/render-env.sh — render the production env file (GH #616, spec §3.3).
# =============================================================================
#
# Reads KEY=VALUE lines from STDIN and atomically writes them to the
# CANONICAL env path /opt/memo/env/production.env — the compose env_file.
# Compose UNION-merges env_file lists, so an override file cannot replace
# the base path: the canonical path must simply HAVE a file. This script is
# the single render mechanism for all three callers:
#   - .github/workflows/deploy.yml `deploy` job (values from GitHub Secrets)
#   - .github/workflows/test.yml PR smoke job (dummy literals)
#   - scripts/prod-smoke.sh (dummy literals)
#
# Usage:
#   <KEY=VALUE lines on stdin> | ./render-env.sh [--output <path>]
#
# Examples:
#   # deploy job — values arrive from GitHub Secrets:
#   printf '%s\n' "SECRET_KEY=${SECRET_KEY}" | ./render-env.sh
#
#   # CI smoke / prod-smoke.sh — dummy literals via heredoc:
#   ./render-env.sh <<'EOF'
#   SECRET_KEY=ci-dummy-not-real
#   DATABASE_URL=sqlite:////opt/memo/data/memo.db
#   EOF
#
# Input contract: one variable per line, `KEY=VALUE`. Empty lines and lines
# starting with '#' are skipped. Any other line that does not match
# ^[A-Za-z_][A-Za-z0-9_]*= aborts the render BEFORE the target is touched
# (exit 2). A trailing carriage return is stripped from each line (CRLF-
# tolerant: an env file saved with Windows line endings renders as if LF).
# A render that consumes ZERO KEY=VALUE lines (empty or comments-only
# stdin) is refused the same way — the target must never be truncated by
# an empty render. Values may contain any bytes except newline and are
# passed through VERBATIM — no quoting added, no interpretation; callers
# compose shell-safe literals.
#
# Secrecy: values are never written to stdout/stderr (no `set -x`, no echo
# of the input); error messages name the LINE NUMBER and KEY only. A line
# without '=' has no key at all (it may itself be a leaked secret), so
# nothing of it is echoed.
#
# Atomicity: temp file in the SAME directory as the target, chmod 0600,
# then mv (rename) over the target — concurrent readers see either the old
# file or the new one, never a partial write. The directory is mkdir -p'd
# (0755) first; an existing target is replaced (rename semantics).
#
# Exit codes:
#   0  success — target rendered atomically
#   1  usage error (bad arguments) or preflight/write failure
#   2  malformed input line on stdin, or zero KEY=VALUE lines consumed
#      (empty/comments-only stdin — the target is never truncated)
set -euo pipefail

readonly DEFAULT_OUTPUT=/opt/memo/env/production.env

usage() {
  cat <<'USAGE'
Usage: render-env.sh [--output <path>]   (KEY=VALUE lines on stdin)

Renders stdin KEY=VALUE lines atomically to the production env file
(default /opt/memo/env/production.env): temp file in the same directory,
chmod 0600, rename over the target. Empty lines and '#' comments are
skipped; a malformed line aborts before the target is touched (exit 2).
Values pass through verbatim and are never echoed.

Examples:
  # deploy job (values from GitHub Secrets):
  printf '%s\n' "SECRET_KEY=${SECRET_KEY}" | ./render-env.sh

  # CI smoke / prod-smoke.sh (dummy literals, canonical path):
  ./render-env.sh <<'EOF'
  SECRET_KEY=ci-dummy-not-real
  EOF

  # local sandbox redirect:
  ./render-env.sh --output ./sandbox.env < input.env

Exit codes: 0 ok, 1 usage/preflight, 2 malformed input.
USAGE
}

output=$DEFAULT_OUTPUT
while [ $# -gt 0 ]; do
  case $1 in
    --output)
      if [ $# -lt 2 ]; then
        printf 'render-env.sh: --output requires a path argument\n' >&2
        usage >&2
        exit 1
      fi
      output=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'render-env.sh: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

target_dir=$(dirname -- "$output")
# 0755 on the leaf dir only; parents keep the umask default (0755 under
# 022). Deliberate: a pre-existing env dir must not be re-chmod'd.
# shellcheck disable=SC2174
mkdir -p -m 0755 -- "$target_dir"

tmp=$(mktemp -- "$target_dir/.render-env.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT

count=0
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line=${line%$'\r'} # CRLF tolerance: strip one trailing carriage return
  # Empty lines and '#' comments are skipped.
  if [ -z "$line" ] || [[ $line == '#'* ]]; then
    continue
  fi
  if [[ ! $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    # Key part only — never the value. See "Secrecy" in the header.
    if [[ $line == *=* ]]; then
      printf 'render-env.sh: stdin line %d: malformed KEY=VALUE line (key: %s)\n' \
        "$lineno" "${line%%=*}" >&2
    else
      printf 'render-env.sh: stdin line %d: malformed KEY=VALUE line (no KEY= prefix)\n' "$lineno" >&2
    fi
    exit 2
  fi
  printf '%s\n' "$line" >> "$tmp"
  count=$((count + 1))
done

# Zero consumed lines = empty or comments-only stdin: refuse BEFORE the
# target is touched (tmp is removed by the trap) — an empty render would
# truncate the canonical env file to nothing.
if [ "$count" -eq 0 ]; then
  printf 'render-env.sh: no KEY=VALUE lines consumed from stdin — refusing to truncate %s with an empty render\n' \
    "$output" >&2
  exit 2
fi

chmod 0600 -- "$tmp"
mv -f -- "$tmp" "$output"
trap - EXIT

printf 'render-env.sh: rendered %d variable(s) to %s\n' "$count" "$output"
