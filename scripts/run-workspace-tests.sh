#!/usr/bin/env bash
# GH #420: run unit tests for every workspace package that declares a `test`
# script, except frontend/admin (the heavy suite — run separately, see the
# frontend-tests CI job / the vitest stage of test-all.sh).
#
# The package list is DERIVED from the workspace globs (pnpm-workspace.yaml:
# packages/*, frontend/*), never hand-written: a new package with a test
# script is picked up automatically. A floor check (>= 2 packages) fails
# loudly if the globs or package.json layout regress into an empty run —
# the #420 lesson: tests that no gate runs are dead coverage.
#
# Shared by CI (.github/workflows/test.yml, workspace-tests job) and the
# local full suite (scripts/test-all.sh) — single source, no list drift.
set -euo pipefail
cd "$(dirname "$0")/.."

admin="frontend/admin"
pkgs=()
for pkg in packages/* frontend/*; do
  [ -f "$pkg/package.json" ] || continue
  [ "$pkg" = "$admin" ] && continue
  grep -q '"test":' "$pkg/package.json" || continue
  pkgs+=("$pkg")
done

if [ "${#pkgs[@]}" -lt 2 ]; then
  echo "ERROR: expected >= 2 workspace test packages (packages/*, frontend/web), found ${#pkgs[@]}:" >&2
  if [ "${#pkgs[@]}" -eq 0 ]; then
    echo "  <none> — workspace globs or package.json scripts layout regressed" >&2
  else
    printf '  %s\n' "${pkgs[@]}" >&2
  fi
  exit 1
fi

echo "Workspace test packages (${#pkgs[@]}):"
printf '  %s\n' "${pkgs[@]}"

# Run every package even if one fails, then report all failures at once —
# CI shows the full red picture in a single job.
failed=()
for pkg in "${pkgs[@]}"; do
  echo "──────── vitest: $pkg"
  if ! (cd "$pkg" && pnpm run test); then
    failed+=("$pkg")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED workspace test packages:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "All ${#pkgs[@]} workspace test packages passed."
