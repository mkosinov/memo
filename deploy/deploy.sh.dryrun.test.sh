#!/usr/bin/env bash
# Dry-run test for deploy/deploy.sh (GH #616, spec §4.2–4.3).
#
# deploy.sh targets the production VPS (registry login, docker pull, compose,
# loopback health port); here every external command is stubbed on PATH and
# the control flow is asserted against an append-only journal:
#   - call ORDER: login → pull ×3 → logout → alembic run → up -d → health
#   - the exit-code canon: 0 ok / 1 usage+preflight / 2 migrations /
#     3 health timeout / 4 login+pull / 5 up -d
#   - REGISTRY_TOKEN handling: login only when set, value never echoed
#   - compose CLI shim: v2 plugin → standalone docker-compose fallback
#   - compose file pin (-f docker-compose.prod.yml) and MEMO_IMAGE_TAG
#     propagation into compose (tag=<tag> in the journal)
#
# Staging note: deploy.sh preflight-checks the absolute VPS paths
# /opt/memo/env/production.env (fixture created by earlier #616 tasks),
# /opt/memo/{data,media} and the edge bind sources
# /opt/memo/{media/public,acme,certs} (+ the TLS pair inside certs/).
# This test creates whatever is missing and removes ONLY what it created.
#
# Run: bash deploy/deploy.sh.dryrun.test.sh

set -euo pipefail

SRC_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST=$SRC_DIR/deploy.sh
WORK=$(mktemp -d /tmp/memo-deploy-dryrun.XXXXXX)
JOURNAL=$WORK/journal.log
OUT=$WORK/out.log
export JOURNAL

pass=0 fail=0
ok()  { printf '  ok  %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s\n' "$1" >&2; fail=$((fail + 1)); }

# ── /opt/memo staging (only what is missing; only that gets cleaned up) ────
if [ ! -f /opt/memo/env/production.env ]; then
  echo "SKIP: /opt/memo/env/production.env fixture missing (earlier #616 task creates it)." >&2
  exit 0
fi
created_data=0 created_media=0 created_media_public=0 created_acme=0 created_certs=0
if [ ! -d /opt/memo/data ]; then mkdir -p /opt/memo/data; created_data=1; fi
if [ ! -d /opt/memo/media ]; then mkdir -p /opt/memo/media; created_media=1; fi
if [ ! -d /opt/memo/media/public ]; then mkdir -p /opt/memo/media/public; created_media_public=1; fi
if [ ! -d /opt/memo/acme ]; then mkdir -p /opt/memo/acme; created_acme=1; fi
# certs: dummy pair — deploy.sh only checks existence (-f), never parses.
if [ ! -d /opt/memo/certs ]; then
  mkdir -p /opt/memo/certs
  : > /opt/memo/certs/fullchain.pem
  : > /opt/memo/certs/privkey.pem
  created_certs=1
fi

cleanup() {
  rm -rf "$WORK"
  # Restore the moved-aside fixture dirs first (case 9/12 die mid-run).
  if [ -d /opt/memo/media.dryrun-held ]; then mv /opt/memo/media.dryrun-held /opt/memo/media; fi
  if [ -d /opt/memo/certs.dryrun-held ]; then mv /opt/memo/certs.dryrun-held /opt/memo/certs; fi
  if [ "$created_certs" = 1 ] && [ -d /opt/memo/certs ]; then rm -rf /opt/memo/certs; fi
  if [ "$created_acme" = 1 ] && [ -d /opt/memo/acme ]; then rm -rf /opt/memo/acme; fi
  if [ "$created_media_public" = 1 ] && [ -d /opt/memo/media/public ]; then rm -rf /opt/memo/media/public; fi
  if [ "$created_media" = 1 ] && [ -d /opt/memo/media ]; then rm -rf /opt/memo/media; fi
  if [ "$created_data" = 1 ] && [ -d /opt/memo/data ]; then rm -rf /opt/memo/data; fi
}
trap cleanup EXIT

# ── stubs: docker / docker-compose / python3 ──────────────────────────────
mkdir -p "$WORK/bin" "$WORK/tree/deploy"
cp "$UNDER_TEST" "$SRC_DIR/docker-compose.prod.yml" "$WORK/tree/deploy/"
chmod +x "$WORK/tree/deploy/deploy.sh"

cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -u
J=${JOURNAL:?stub misconfigured}
if [ "${1:-}" = compose ] && [ "${2:-}" = version ]; then
  if [ "${STUB_NO_COMPOSE_PLUGIN:-0}" = 1 ]; then exit 1; fi
  exit 0
fi
if [ "${1:-}" = compose ]; then
  shift
  f='<no-f>'
  if [ "${1:-}" = -f ]; then f=$2; shift 2; fi
  printf 'COMPOSE f=%s tag=%s %s\n' "$f" "${MEMO_IMAGE_TAG:-<unset>}" "$*" >> "$J"
  case "$*" in
    'run --rm -T backend alembic upgrade head') exit "${STUB_RUN_RC:-0}" ;;
    'up -d') exit "${STUB_UP_RC:-0}" ;;
  esac
  exit 0
fi
case "${1:-}" in
  login)
    token=$(cat)
    printf 'LOGIN host=%s user=%s token=%s\n' "$2" "$4" "$token" >> "$J"
    exit "${STUB_LOGIN_RC:-0}"
    ;;
  pull)
    printf 'PULL %s\n' "$2" >> "$J"
    exit "${STUB_PULL_RC:-0}"
    ;;
  logout)
    printf 'LOGOUT %s\n' "$2" >> "$J"
    exit 0
    ;;
esac
exit 0
STUB

cat > "$WORK/bin/docker-compose" <<'STUB'
#!/usr/bin/env bash
set -u
J=${JOURNAL:?stub misconfigured}
f='<no-f>'
if [ "${1:-}" = -f ]; then f=$2; shift 2; fi
printf 'COMPOSE f=%s tag=%s %s\n' "$f" "${MEMO_IMAGE_TAG:-<unset>}" "$*" >> "$J"
case "$*" in
  'run --rm -T backend alembic upgrade head') exit "${STUB_RUN_RC:-0}" ;;
  'up -d') exit "${STUB_UP_RC:-0}" ;;
esac
exit 0
STUB

cat > "$WORK/bin/python3" <<'STUB'
#!/usr/bin/env bash
set -u
J=${JOURNAL:?stub misconfigured}
printf 'PY %s\n' "$*" >> "$J"
case "$*" in
  *urlopen*) exit "${STUB_HEALTH_RC:-0}" ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/"*

ORIG_PATH=$PATH

run_deploy() {
  # run_deploy <cwd> <tag-arg-or-empty> — always invokes by absolute path,
  # so one case can run from an unrelated cwd (cwd-independence check).
  : > "$JOURNAL"
  set +e
  (cd "$1" && PATH="$WORK/bin:$ORIG_PATH" "$WORK/tree/deploy/deploy.sh" ${2:+"$2"}) > "$OUT" 2>&1
  rc=$?
  set -e
}

assert_rc() {
  if [ "$rc" = "$1" ]; then ok "exit $1"
  else bad "exit: want $1, got $rc — output: $(tr '\n' '|' < "$OUT")"; fi
}
j_has()   { if grep -q -- "$1" "$JOURNAL"; then ok "journal: $1"
            else bad "journal missing '$1' — have: $(tr '\n' '|' < "$JOURNAL")"; fi; }
j_lacks() { if grep -q -- "$1" "$JOURNAL"; then bad "journal must NOT contain '$1'"
            else ok "journal: no $1"; fi; }
out_has() { if grep -q -- "$1" "$OUT"; then ok "out: $1"
            else bad "output missing '$1' — have: $(tr '\n' '|' < "$OUT")"; fi; }
line_of() { grep -n -- "$1" "$JOURNAL" | head -1 | cut -d: -f1 || true; }
assert_before() { # assert_before <pattern-1> <pattern-2>
  local a b
  a=$(line_of "$1"); b=$(line_of "$2")
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then ok "order: $1 < $2"
  else bad "order broken: '$1' (line ${a:-none}) before '$2' (line ${b:-none})"; fi
}
j_count_min() { # j_count_min <min> <pattern>
  local n; n=$(grep -c -- "$2" "$JOURNAL" || true)
  if [ "${n:-0}" -ge "$1" ]; then ok "journal ≥$1× $2"
  else bad "want ≥$1× '$2', got ${n:-0}"; fi
}

# ── case 1: happy path — private registry (token), compose plugin ─────────
echo '== case 1: happy path (token, compose plugin, ordered journal) =='
export REGISTRY_TOKEN='dryrun-token-xyz' STUB_HEALTH_RC=0
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 0
j_has '^LOGIN host=ghcr.io user=mkosinov token=dryrun-token-xyz$'
j_has '^PULL ghcr.io/mkosinov/memo/backend:v9.9.9$'
j_has '^PULL ghcr.io/mkosinov/memo/admin:v9.9.9$'
j_has '^PULL ghcr.io/mkosinov/memo/edge:v9.9.9$'
j_has '^COMPOSE f=docker-compose.prod.yml tag=v9.9.9 run --rm -T backend alembic upgrade head$'
j_has '^COMPOSE f=docker-compose.prod.yml tag=v9.9.9 up -d$'
j_has '^PY -c .*urlopen.*127.0.0.1/api/v1/health'
j_has '^LOGOUT ghcr.io$'
assert_before '^LOGIN ' '^PULL '
assert_before '^PULL ' 'run --rm -T'
assert_before 'run --rm -T' 'up -d$'
assert_before 'up -d$' '^PY '
if grep -q 'dryrun-token-xyz' "$OUT"; then bad 'REGISTRY_TOKEN leaked into script output'
else ok 'token never echoed'; fi
# Ownership warnings must cover BOTH volume dirs (root-owned staging): data
# (SQLite WAL) and media (backend avatar writes at the volume root).
out_has '/opt/memo/data is not owned by uid 1001'
out_has '/opt/memo/media is not owned by uid 1001'
if grep -q '/opt/memo/files' "$OUT"; then bad 'stale /opt/memo/files reference in deploy.sh output'
else ok 'no stale /opt/memo/files references in output'; fi
unset REGISTRY_TOKEN STUB_HEALTH_RC

# ── case 2: public images (no token), unrelated cwd ───────────────────────
echo '== case 2: no token, run from unrelated cwd =='
run_deploy "$WORK" v9.9.9
assert_rc 0
j_lacks '^LOGIN'
j_lacks '^LOGOUT'
j_has 'run --rm -T backend alembic upgrade head$'
j_has 'up -d$'

# ── case 3: standalone docker-compose fallback ─────────────────────────────
echo '== case 3: standalone docker-compose (no v2 plugin) =='
export STUB_NO_COMPOSE_PLUGIN=1
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 0
j_has '^COMPOSE f=docker-compose.prod.yml tag=v9.9.9 up -d$'
unset STUB_NO_COMPOSE_PLUGIN

# ── case 4: migration failure → exit 2, stack NOT started ──────────────────
echo '== case 4: alembic fails → exit 2, no up / no health =='
export STUB_RUN_RC=1
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 2
j_has 'run --rm -T'
j_lacks 'up -d'
j_lacks '^PY '
out_has 'migrations failed'
unset STUB_RUN_RC

# ── case 5: health timeout → exit 3 (stack up) ─────────────────────────────
echo '== case 5: health never 2xx → exit 3 =='
export STUB_HEALTH_RC=1 HEALTH_TIMEOUT_SECONDS=2
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 3
j_has 'up -d$'
j_count_min 1 '^PY '
out_has 'health timeout'
unset STUB_HEALTH_RC HEALTH_TIMEOUT_SECONDS

# ── case 6: pull failure → exit 4, DB untouched ────────────────────────────
echo '== case 6: docker pull fails → exit 4, no migrations =='
export STUB_PULL_RC=1
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 4
j_has '^PULL '
j_lacks 'run --rm'
j_lacks 'up -d'
unset STUB_PULL_RC

# ── case 7: login failure → exit 4, no pull ────────────────────────────────
echo '== case 7: docker login fails → exit 4, no pull =='
export REGISTRY_TOKEN=tok STUB_LOGIN_RC=1
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 4
j_has '^LOGIN '
j_lacks '^PULL '
unset REGISTRY_TOKEN STUB_LOGIN_RC

# ── case 8: no tag argument → exit 1 (usage) ───────────────────────────────
echo '== case 8: missing tag → exit 1, usage =='
run_deploy "$WORK/tree/deploy" ''
assert_rc 1
out_has 'usage: ./deploy.sh'

# ── case 9: preflight — missing volume dir → exit 1 ────────────────────────
echo '== case 9: missing /opt/memo/media → exit 1 (preflight) =='
mv /opt/memo/media /opt/memo/media.dryrun-held
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 1
out_has '/opt/memo/media'
mv /opt/memo/media.dryrun-held /opt/memo/media

# ── case 10: compose up -d failure → exit 5 ────────────────────────────────
echo '== case 10: up -d fails → exit 5 =='
export STUB_UP_RC=1
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 5
j_has 'up -d$'
out_has 'up -d failed'
unset STUB_UP_RC

# ── case 11: custom MEMO_REGISTRY_PREFIX → host/user/images follow it ──────
echo '== case 11: custom registry prefix (login user = namespace) =='
export REGISTRY_TOKEN=tok MEMO_REGISTRY_PREFIX=ghcr.io/acme/memo
run_deploy "$WORK/tree/deploy" v1.0.0
assert_rc 0
j_has '^LOGIN host=ghcr.io user=acme token=tok$'
j_has '^PULL ghcr.io/acme/memo/backend:v1.0.0$'
unset REGISTRY_TOKEN MEMO_REGISTRY_PREFIX

# ── case 12: preflight — missing edge bind source → exit 1 ──────────────────
echo '== case 12: missing /opt/memo/certs → exit 1 (preflight) =='
mv /opt/memo/certs /opt/memo/certs.dryrun-held
run_deploy "$WORK/tree/deploy" v9.9.9
assert_rc 1
out_has '/opt/memo/certs'
mv /opt/memo/certs.dryrun-held /opt/memo/certs

# ── summary ────────────────────────────────────────────────────────────────
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
