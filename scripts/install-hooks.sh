#!/usr/bin/env bash
# Installs git hooks from scripts/git-hooks/ to .git/hooks/
# Runs on `pnpm install` via postinstall in package.json
# Safe to run multiple times (skips if already installed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/git-hooks"
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [ -z "$GIT_DIR" ]; then
  echo "⚠️  Not a git repository. Skipping hook installation."
  exit 0
fi

HOOKS_DIR="$GIT_DIR/hooks"

for hook_file in "$SRC_DIR"/*; do
  [ -e "$hook_file" ] || continue
  hook_name="$(basename "$hook_file")"
  dest="$HOOKS_DIR/$hook_name"

  if [ -f "$dest" ] && [ ! -L "$dest" ]; then
    # Existing hook is not a symlink; skip (don't overwrite)
    echo "⚠️  $hook_name already exists at $dest (not a symlink). Skipping."
    continue
  fi

  if [ -L "$dest" ]; then
    # Remove old symlink
    rm "$dest"
  fi

  cp "$hook_file" "$dest"
  chmod +x "$dest"
  echo "✅ Installed $hook_name → $dest"
done
