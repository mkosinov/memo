#!/usr/bin/env bash
# Test for deploy/render-env.sh (GH #616, spec §3.3 rev.6).
#
# render-env.sh has no docker/ssh dependencies — real execution, no stubs.
# Asserted:
#   - happy path: stdin KEY=VALUE lines → canonical /opt/memo/env/
#     production.env, byte-exact content, mode 0600 (values with spaces,
#     quotes, $, backticks and backslashes survive verbatim)
#   - empty lines and '#' comments skipped
#   - malformed line → exit 2, message carries the line number and the KEY
#     part only; the VALUE never reaches script output; the target file is
#     not created; no temp leftovers
#   - atomicity: a pre-existing target is replaced via rename (fresh 0600
#     perms, old content gone), directory listing unchanged afterwards
#   - --output override (nested directories created)
#   - usage canon: 0 ok+help / 1 usage / 2 malformed input
#
# Canonical-path cases write /opt/memo/env/production.env and NEED ROOT
# (the CI/VPS sandbox runs as root); the file is left in place afterwards —
# leftover-tolerated canonical path, later tasks render the real content.
#
# Run: bash deploy/render-env.sh.test.sh

set -euo pipefail

SRC_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST=$SRC_DIR/render-env.sh
WORK=$(mktemp -d /tmp/memo-render-env.XXXXXX)
OUT=$WORK/out.log
TARGET=/opt/memo/env/production.env

pass=0 fail=0
ok()  { printf '  ok  %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s\n' "$1" >&2; fail=$((fail + 1)); }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

if [ "$(id -u)" -ne 0 ]; then
  echo "SKIP: needs root for the canonical path $TARGET." >&2
  exit 0
fi

run_render() { # run_render <stdin-file> [args...] — rc → $rc, output → $OUT
  local stdin_file=$1; shift
  set +e
  "$UNDER_TEST" "$@" < "$stdin_file" > "$OUT" 2>&1
  rc=$?
  set -e
}

assert_rc() {
  if [ "$rc" = "$1" ]; then ok "exit $1"
  else bad "exit: want $1, got $rc — output: $(tr '\n' '|' < "$OUT")"; fi
}
out_has()   { if grep -q -F -- "$1" "$OUT"; then ok "out: $1"
              else bad "output missing '$1' — have: $(tr '\n' '|' < "$OUT")"; fi; }
out_lacks() { if grep -q -F -- "$1" "$OUT"; then bad "output must NOT contain '$1'"
              else ok "out: no '$1'"; fi; }
exists_ok() { if [ -e "$2" ]; then ok "exists: $2"
              else bad "missing: $2"; fi; }
absent_ok() { if [ ! -e "$2" ]; then ok "absent: $2"
              else bad "must not exist: $2"; fi; }
cmp_ok()    { # cmp_ok <expected-file> <actual-file>
              if cmp -s -- "$1" "$2"; then ok "byte-exact: $2"
              else bad "$2 differs from $1"; fi; }
mode_ok()   { # mode_ok <file> <want>
              if [ ! -e "$1" ]; then bad "mode of $1: file missing"; return 0; fi
              local got; got=$(stat -c %a -- "$1")
              if [ "$got" = "$2" ]; then ok "mode $2: $1"
              else bad "mode of $1: want $2, got $got"; fi; }
no_temp()   { # no_temp <dir> — no .render-env.* temp leftovers
              if find "$1" -mindepth 1 -maxdepth 1 -name '.render-env.*' | grep -q .; then
                bad "temp leftovers in $1"
              else ok "no temp leftovers in $1"; fi; }

# ── case 1: happy path → canonical target, byte-exact, 0600, no leaks ──────
echo '== case 1: happy path (verbatim values) → canonical target =='
cat > "$WORK/in1.env" <<'EOF'
SECRET_KEY=abc123def456
DATABASE_URL=postgres://memo:p@ss w0rd@$erver/db
SESSION_SECRET=it's a "tricky" $HOME `backtick` \slash value
EMPTY=
EOF
run_render "$WORK/in1.env"
assert_rc 0
exists_ok file "$TARGET"
cmp_ok "$WORK/in1.env" "$TARGET"
mode_ok "$TARGET" 600
out_lacks 'p@ss w0rd'
out_lacks 'tricky'
no_temp /opt/memo/env

# ── case 2: comments and blank lines skipped ───────────────────────────────
echo '== case 2: comments and blank lines skipped =='
cat > "$WORK/in2.env" <<'EOF'
# rendered by the deploy workflow — do not edit
KEY_ONE=value-one

# a middle comment
KEY_TWO=value-two

EOF
printf 'KEY_ONE=value-one\nKEY_TWO=value-two\n' > "$WORK/want2.env"
run_render "$WORK/in2.env" --output "$WORK/out2.env"
assert_rc 0
cmp_ok "$WORK/want2.env" "$WORK/out2.env"
mode_ok "$WORK/out2.env" 600

# ── case 3: malformed line → exit 2, value never echoed, target untouched ──
echo '== case 3: malformed line → exit 2, key named, value hidden =='
cat > "$WORK/in3.env" <<'EOF'
GOOD_KEY=fine
BAD KEY=supersecret-value-xyz
ALSO_GOOD=ok
EOF
run_render "$WORK/in3.env" --output "$WORK/out3.env"
assert_rc 2
out_has 'line 2'
out_has 'BAD KEY'
out_lacks 'supersecret-value-xyz'
absent_ok file "$WORK/out3.env"
no_temp "$WORK"

cat > "$WORK/in3b.env" <<'EOF'
bare-secret-token-without-key
EOF
run_render "$WORK/in3b.env" --output "$WORK/out3b.env"
assert_rc 2
out_has 'line 1'
out_lacks 'bare-secret-token'
absent_ok file "$WORK/out3b.env"

# ── case 4: atomic replace of a pre-existing target, no leftovers ──────────
echo '== case 4: pre-existing target replaced atomically =='
mkdir -p /opt/memo/env
printf 'OLD_KEY=stale-previous-render\n' > "$TARGET"
chmod 0644 "$TARGET"
find /opt/memo/env -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort > "$WORK/before.txt"
printf 'NEW_KEY=fresh-atomic-content\n' > "$WORK/in4.env"
run_render "$WORK/in4.env"
assert_rc 0
cmp_ok "$WORK/in4.env" "$TARGET"
mode_ok "$TARGET" 600
if grep -q -F 'OLD_KEY' "$TARGET"; then bad 'old content still present in target'
else ok 'old content gone'; fi
find /opt/memo/env -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort > "$WORK/after.txt"
if diff -u "$WORK/before.txt" "$WORK/after.txt" > /dev/null; then
  ok 'directory listing unchanged (no temp leftovers)'
else
  bad "directory gained/lost entries: $(diff -u "$WORK/before.txt" "$WORK/after.txt" || true)"
fi

# ── case 5: --output override (nested directories created) ─────────────────
echo '== case 5: --output override =='
run_render "$WORK/in1.env" --output "$WORK/custom/dir/custom.env"
assert_rc 0
cmp_ok "$WORK/in1.env" "$WORK/custom/dir/custom.env"
mode_ok "$WORK/custom/dir/custom.env" 600

# ── case 6: usage canon (0 help / 1 bad args) ──────────────────────────────
echo '== case 6: usage canon =='
run_render /dev/null --help
assert_rc 0
out_has 'Usage'
out_has 'Example'
run_render /dev/null --bogus
assert_rc 1
out_has 'Usage'
run_render /dev/null --output
assert_rc 1
out_has '--output'

# ── summary ────────────────────────────────────────────────────────────────
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
