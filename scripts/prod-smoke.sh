#!/usr/bin/env bash
# =============================================================================
# scripts/prod-smoke.sh — local production smoke (GH #616, spec §5 + §7).
# =============================================================================
#
# Raises the FULL prod stack (deploy/docker-compose.prod.yml) on the local
# docker daemon against a throwaway temp dir — the canonical E2E stand-in
# for the infra feature until the VPS exists (#574). Never touches
# /opt/memo: the VPS env/volume contract (spec §3.3) is swapped for temp
# paths via a generated compose override (same trick as the test.yml
# `prod-build` job). NB: compose UNIONS `env_file` across merged files even
# in string form — an override does NOT replace it wholesale — which is why
# the generated port-adapted copy of the base file also strips the base
# env_file line (the sed below); without that strip, a local
# /opt/memo/env/production.env would leak into the smoke containers.
#
# Usage:
#   scripts/prod-smoke.sh                # default: spec §7 scenario 3 —
#                                        # clean dir → migrations → up →
#                                        # health → 401 anonymous → /admin
#                                        # shell → WAL files → teardown
#   scripts/prod-smoke.sh --rollback     # + spec §7 scenario 2 — a SECOND
#                                        # deploy with the PREVIOUS tag on
#                                        # the SAME volumes (no teardown in
#                                        # between): health green again,
#                                        # memo.db NOT recreated (inode).
#   scripts/prod-smoke.sh --no-secrets   # spec §7 scenario 4 — env file
#                                        # WITHOUT SECRET_KEY/OTP_PEPPER:
#                                        # the backend container must refuse
#                                        # to start (image-level fail-fast,
#                                        # exit != 0 + message in logs).
#   scripts/prod-smoke.sh -h | --help    # usage summary
#
# Knobs (environment):
#   PROD_SMOKE_TAG             current image tag, default "test" — expects
#                              locally built memo-backend/admin/web:<tag>
#                              (build commands in the Dockerfile headers).
#   PROD_SMOKE_PREV_TAG        rollback tag, default = PROD_SMOKE_TAG (with
#                              only one local tag the rollback mechanics —
#                              same volumes, redeploy, DB untouched — are
#                              still exercised; set a real previous tag
#                              when one exists).
#   PROD_SMOKE_HEALTH_TIMEOUT  health-wait budget, seconds, default 120.
#   PROD_SMOKE_DIR             smoke root (env file + data/files volumes);
#                              default: fresh mktemp dir, removed on exit.
#   SMOKE_BACKEND_PORT         HOST-side published ports of the three
#   SMOKE_ADMIN_PORT           services, defaults = the compose contract
#   SMOKE_WEB_PORT             8000/3000/8080 (imac runs defaults). On a
#                              SHARED docker daemon (sandbox hosts that
#                              keep long-lived infra containers on 3000/
#                              8000) republish to free ports instead.
#                              Container-side listeners stay fixed at
#                              8000/3000/8080 — only the host halves of
#                              the mappings move. Implemented via a
#                              port-adapted COPY of the prod compose file:
#                              compose MERGES ports (append), so an
#                              override file cannot replace a mapping, and
#                              the `!override` tag needs compose ≥2.24 —
#                              older than the docker-compose fallback this
#                              script promises to support.
#
# HTTP probing: HOST curl against the compose loopback ports is the primary
# path (that is how it works on the imac). On docker-in-VM hosts (linuxkit)
# published-port loopback is unreachable from the host shell for ANY image,
# so every probe FALLS BACK automatically to running the request from
# inside the backend container over the compose network (docker exec +
# python3 — the images ship python, not curl). Mode is auto-detected per
# probe; once the in-network path answers it is locked in for the run.
#
# Volume asserts (WAL files, the rollback inode) likewise run `docker exec`
# INSIDE the running backend container instead of host-side `ls`: on
# VM-backed daemons without host file sharing the bind source visible to
# the smoke shell is NOT the one containers write to, while docker exec is
# storage-agnostic (and identical on the imac).
#
# Teardown ALWAYS runs (EXIT trap): compose down -v --remove-orphans, temp
# dir removed, then a leftover sweep — any surviving container/volume/
# network of this compose project fails the run (exit 8). Failed runs dump
# the last 100 log lines of every service BEFORE the teardown.
#
# Exit codes:
#   0  success — every scenario assert green, teardown left nothing
#   1  usage / preflight — bad flags, docker/compose missing, local images
#      for the requested tags absent, bad port numbers
#   2  migrations failed (compose run alembic upgrade head)
#   3  compose up -d failed (incl. host port already allocated)
#   4  HTTP/WAL contract broken — health timeout, anonymous API not 401,
#      /admin shell not served, WAL files absent, memo.db recreated during
#      rollback
#   5  --no-secrets assertion failed — backend did NOT refuse to start
#   8  teardown leftovers — containers/volumes/networks survived down -v
#
# Compose CLI: `docker compose` (v2 plugin) when available, else standalone
# `docker-compose` (same shim as deploy/deploy.sh). One smoke at a time:
# the stack pins the 172.16.0.0/24 subnet (host ports are knob-able above).
# =============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
PROD_COMPOSE=$SCRIPT_DIR/../deploy/docker-compose.prod.yml

PROJECT=memo-prod-smoke
BACKEND_CONTAINER=memo-prod-smoke-backend

die() { # die <exit-code> <message...>
  local code=$1
  shift
  printf 'prod-smoke: ERROR: %s\n' "$*" >&2
  exit "$code"
}
log() { printf 'prod-smoke: %s\n' "$1"; }

usage() {
  cat <<'EOF'
scripts/prod-smoke.sh — local production smoke (GH #616, spec §5 + §7)

Usage:
  scripts/prod-smoke.sh                scenario 3: clean temp dir → migrations
                                       → up -d → health → 401 anonymous API →
                                       /admin shell → WAL on the volume →
                                       teardown
  scripts/prod-smoke.sh --rollback     + scenario 2: second deploy with the
                                       previous tag on the SAME volumes;
                                       health green, memo.db not recreated
  scripts/prod-smoke.sh --no-secrets   scenario 4: env without SECRET_KEY/
                                       OTP_PEPPER → backend refuses to start
  scripts/prod-smoke.sh --help         this text

Knobs (environment):
  PROD_SMOKE_TAG             image tag (default "test"; expects locally built
                             memo-backend/admin/web:<tag>)
  PROD_SMOKE_PREV_TAG        rollback tag (default = PROD_SMOKE_TAG)
  PROD_SMOKE_HEALTH_TIMEOUT  health budget seconds (default 120)
  PROD_SMOKE_DIR             smoke root dir (default: fresh mktemp, removed)
  SMOKE_BACKEND_PORT         host-side published ports (defaults 8000/3000/
  SMOKE_ADMIN_PORT           8080 = the compose contract; republish on a
  SMOKE_WEB_PORT             shared daemon where those are held by others)
EOF
}

# ── args ────────────────────────────────────────────────────────────────────
MODE=default
case "${1:-}" in
  '') ;;
  --rollback) MODE=rollback ;;
  --no-secrets) MODE=no_secrets ;;
  -h | --help) usage; exit 0 ;;
  *) die 1 "unknown option: ${1} (see --help)" ;;
esac
[ "$#" -le 1 ] || die 1 "at most one mode flag expected, got: $* (see --help)"

TAG=${PROD_SMOKE_TAG:-test}
PREV_TAG=${PROD_SMOKE_PREV_TAG:-$TAG}
HEALTH_TIMEOUT=${PROD_SMOKE_HEALTH_TIMEOUT:-120}
case "$TAG$PREV_TAG" in
  *[!A-Za-z0-9_.-]*) die 1 "invalid image tag: '$TAG' / '$PREV_TAG'" ;;
esac
case "$HEALTH_TIMEOUT" in
  '' | *[!0-9]*) die 1 "PROD_SMOKE_HEALTH_TIMEOUT must be a number, got: '$HEALTH_TIMEOUT'" ;;
esac

# Host-side ports (defaults = compose contract; see the header for why a
# plain override cannot rebind them). Container listeners stay 8000/3000/8080.
BACKEND_HOST_PORT=${SMOKE_BACKEND_PORT:-8000}
ADMIN_HOST_PORT=${SMOKE_ADMIN_PORT:-3000}
WEB_HOST_PORT=${SMOKE_WEB_PORT:-8080}
for p in "$BACKEND_HOST_PORT" "$ADMIN_HOST_PORT" "$WEB_HOST_PORT"; do
  case $p in
    '' | *[!0-9]*) die 1 "port knobs must be numbers, got: '$p'" ;;
  esac
  if [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then
    die 1 "port knob out of range 1-65535: '$p'"
  fi
done

# ── compose CLI shim (deploy.sh precedent: plugin or standalone) ────────────
command -v docker >/dev/null 2>&1 || die 1 "docker not found"
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose -p "$PROJECT" -f "$COMPOSE_BASE" -f "$OVERRIDE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose -p "$PROJECT" -f "$COMPOSE_BASE" -f "$OVERRIDE_FILE" "$@"; }
else
  die 1 "neither 'docker compose' (plugin) nor 'docker-compose' (standalone) is available"
fi
# The base file interpolates ${MEMO_IMAGE_TAG:?} BEFORE the override replaces
# image: — any non-empty value works; the real names come from the override
# (test.yml prod-build precedent).
export MEMO_IMAGE_TAG=smoke

# ── preflight: local images ─────────────────────────────────────────────────
image_tags=$TAG
if [ "$MODE" = rollback ] && [ "$PREV_TAG" != "$TAG" ]; then
  image_tags="$TAG $PREV_TAG"
fi
# shellcheck disable=SC2086  # word-split of the tag list is intended
for tag in $image_tags; do
  for svc in backend admin web; do
    if [ "$MODE" = no_secrets ] && [ "$svc" != backend ]; then continue; fi
    docker image inspect "memo-$svc:$tag" >/dev/null 2>&1 \
      || die 1 "image memo-$svc:$tag not found locally — build it first, e.g.
  docker build -f deploy/Dockerfile.backend -t memo-backend:test backend/
  docker build -f deploy/Dockerfile.admin  -t memo-admin:test  .
  docker build -f deploy/Dockerfile.web    -t memo-web:test    ."
  done
done

# ── smoke root: fresh temp dir with the two volume mounts ──────────────────
# Bind mounts replace /opt/memo/{data,files}; chmod 0777 because the backend
# writes as uid 1001 (Dockerfile.backend ownership contract) while the smoke
# host user is arbitrary (imac uid 501, CI runner, root container) — the
# test.yml prod-build job uses the same trick.
if [ -n "${PROD_SMOKE_DIR:-}" ]; then
  SMOKE_DIR=$PROD_SMOKE_DIR
  SMOKE_DIR_CREATED=0
else
  SMOKE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/memo-prod-smoke.XXXXXX")
  SMOKE_DIR_CREATED=1
fi
ENV_FILE=$SMOKE_DIR/memo-smoke.env
OVERRIDE_FILE=$SMOKE_DIR/override.yml
COMPOSE_BASE=$SMOKE_DIR/docker-compose.prod.ports.yml
mkdir -p "$SMOKE_DIR/data" "$SMOKE_DIR/files"
chmod 0777 "$SMOKE_DIR/data" "$SMOKE_DIR/files"

# Port-adapted copy of the prod compose (header: compose append-merges ports,
# so an override cannot rebind; `!override` needs ≥2.24). Two rewrites:
#   1. the three published HOST halves — everything else (env contract
#      shape, volumes, healthcheck, the pinned 172.16.0.0/24 trust
#      boundary) stays verbatim; with the default knobs this is the
#      identity;
#   2. the base `env_file:` line is DELETED — docker-compose UNIONS
#      env_file across files (empirically: string form does NOT replace,
#      docker-compose v2.32.1 standalone, 2026-11-22), so the base
#      /opt/memo/env/production.env would leak into the smoke containers
#      wherever that file exists (this machine keeps the Task-3 validation
#      fixture there — its placeholder SECRET_KEY/OTP_PEPPER silently
#      defeated the --no-secrets scenario). The override's temp env file
#      is then the ONLY env source: the smoke fully owns the contract.
sed -e "s|127.0.0.1:8000:8000|127.0.0.1:${BACKEND_HOST_PORT}:8000|" \
  -e "s|127.0.0.1:3000:3000|127.0.0.1:${ADMIN_HOST_PORT}:3000|" \
  -e "s|127.0.0.1:8080:8080|127.0.0.1:${WEB_HOST_PORT}:8080|" \
  -e '/^    env_file: /d' \
  "$PROD_COMPOSE" > "$COMPOSE_BASE"

rand_hex() { # 32 random bytes as hex — openssl (imac/linux), od fallback
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

# write_env <with-secrets:1|0> — throwaway stand-in for the VPS env contract
# (spec §3.3): the container-internal paths stay verbatim so the DATABASE_URL
# contract is exercised for real (alembic env.py consumes it → temp-volume DB).
write_env() {
  local with_secrets=$1
  umask 077
  {
    echo 'ENV=production'
    if [ "$with_secrets" = 1 ]; then
      echo "SECRET_KEY=$(rand_hex)"
      echo "OTP_PEPPER=$(rand_hex)"
    fi
    echo 'DATABASE_URL=sqlite+aiosqlite:////opt/memo/data/memo.db'
    echo 'FILES_DIR=/opt/memo/files'
  } > "$ENV_FILE"
  umask 022
}

# write_override <tag> [restart-no:1] — image: replacement (local tags, not
# GHCR), env_file/volumes → temp dir, pinned container name for the docker
# exec fallback probe. `restart: "no"` only in --no-secrets mode so the
# fail-fast exit is observable as a plain exited(≠0) state instead of a
# restart-policy loop (the policy is orthogonal to what scenario 4 asserts).
write_override() {
  local tag=$1 restart_line=''
  if [ "${2:-}" = 1 ]; then
    restart_line='    restart: "no"
'
  fi
  cat > "$OVERRIDE_FILE" <<YAML
services:
  backend:
    image: memo-backend:${tag}
    env_file: ${ENV_FILE}
    container_name: ${BACKEND_CONTAINER}
${restart_line}    volumes:
      - ${SMOKE_DIR}/data:/opt/memo/data
      - ${SMOKE_DIR}/files:/opt/memo/files
  admin:
    image: memo-admin:${tag}
  web:
    image: memo-web:${tag}
YAML
}

# ── teardown: ALWAYS (trap), zero leftovers (DoD) ───────────────────────────
STACK_UP=0
COMPOSE_TOUCHED=0
# shellcheck disable=SC2317  # invoked only via the EXIT trap below
TEARDOWN() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$STACK_UP" = 1 ]; then
    compose logs --no-color --tail 100 2>/dev/null || true
  fi
  if [ "$COMPOSE_TOUCHED" = 1 ]; then
    # down even when up never succeeded: `compose run` alone already creates
    # the project network — the leftover sweep below would flag it.
    log 'teardown: compose down -v --remove-orphans'
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  if [ "$SMOKE_DIR_CREATED" = 1 ]; then rm -rf "$SMOKE_DIR"; fi
  # Leftover sweep — the DoD is "teardown leaves no containers/volumes".
  local left='' kind
  for kind in 'ps -aq' 'volume ls -q' 'network ls -q'; do
    # shellcheck disable=SC2086  # intentional: docker subcommand + flags
    left=$(docker $kind --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
    if [ -n "$left" ]; then
      printf 'prod-smoke: ERROR: teardown left artifacts (%s): %s\n' "$kind" "$left" >&2
      if [ "$rc" -eq 0 ]; then rc=8; fi
    fi
  done
  exit "$rc"
}
trap TEARDOWN EXIT

# ── HTTP probes: host curl primary, in-network fallback ────────────────────
# HTTP_MODE: auto (try host first) → host | net once decided. The in-network
# probe execs python3 INSIDE the backend container (images ship python, not
# curl) — backend by loopback, admin/web by compose service DNS. Host-side
# URLs use the (knob-able) published ports; in-network URLs the FIXED
# container listeners.
#
# Results land in the PROBE_CODE / PROBE_BODY globals — the callers must NOT
# run these under `$( )`: command substitution is a subshell and would lose
# the HTTP_MODE lock-in (2026-11-22 smoke-debugging lesson).
HTTP_MODE=auto
PROBE_CODE=000
PROBE_BODY=''

host_port() { # published host half of <service>'s mapping
  case $1 in
    backend) printf '%s' "$BACKEND_HOST_PORT" ;;
    admin) printf '%s' "$ADMIN_HOST_PORT" ;;
    web) printf '%s' "$WEB_HOST_PORT" ;;
  esac
}

container_port() { # fixed container-side listener (images bind these)
  case $1 in
    backend) printf '%s' 8000 ;;
    admin) printf '%s' 3000 ;;
    web) printf '%s' 8080 ;;
  esac
}

net_probe() { # net_probe <code|body> <service> <path>
  local what=$1 service=$2 path=$3 url
  case $service in
    backend) url="http://127.0.0.1:$(container_port backend)${path}" ;;
    *) url="http://${service}:$(container_port "$service")${path}" ;;
  esac
  docker exec -i "$BACKEND_CONTAINER" python3 - "$what" "$url" <<'PY' 2>/dev/null || true
import sys
what, url = sys.argv[1], sys.argv[2]
import urllib.error
import urllib.request
try:
    r = urllib.request.urlopen(url, timeout=5)
    body = r.read().decode("utf-8", "replace")
    if what == "code":
        print(r.status)
    else:
        sys.stdout.write(body)
except urllib.error.HTTPError as e:  # 401 etc. still carry a status/body
    body = e.read().decode("utf-8", "replace")
    if what == "code":
        print(e.code)
    else:
        sys.stdout.write(body)
except Exception:
    if what == "code":
        print(000)
PY
}

http_code() { # http_code <service> <path> → sets PROBE_CODE (3-digit | 000)
  local service=$1 path=$2
  PROBE_CODE=000
  if [ "$HTTP_MODE" != net ] && command -v curl >/dev/null 2>&1; then
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      "http://127.0.0.1:$(host_port "$service")${path}" 2>/dev/null) || code=000
    if [ -n "$code" ] && [ "$code" != 000 ]; then
      HTTP_MODE=host
      PROBE_CODE=$code
      return 0
    fi
    # Host gave nothing. If host curl EVER answered, stay honest with 000
    # (service booting); otherwise this may be the loopback-unreachable VM
    # case — try the in-network probe below.
    if [ "$HTTP_MODE" = host ]; then return 0; fi
  fi
  local probed
  probed=$(net_probe code "$service" "$path")
  if [ -n "$probed" ] && [ "$probed" != 000 ]; then HTTP_MODE=net; fi
  PROBE_CODE=${probed:-000}
}

http_body() { # http_body <service> <path> → sets PROBE_BODY
  local service=$1 path=$2
  PROBE_BODY=''
  if [ "$HTTP_MODE" != net ] && command -v curl >/dev/null 2>&1; then
    local body
    body=$(curl -s --max-time 5 "http://127.0.0.1:$(host_port "$service")${path}" 2>/dev/null) || body=''
    if [ -n "$body" ]; then
      HTTP_MODE=host
      PROBE_BODY=$body
      return 0
    fi
    if [ "$HTTP_MODE" = host ]; then return 0; fi
  fi
  PROBE_BODY=$(net_probe body "$service" "$path")
}

wait_http() { # wait_http <service> <path> <label> — 0 on 2xx in time
  local service=$1 path=$2 label=$3 code=000
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    http_code "$service" "$path"
    code=$PROBE_CODE
    case $code in
      2*) log "$label ready (HTTP $code via ${HTTP_MODE} path)"; return 0 ;;
    esac
    sleep 2
  done
  printf 'prod-smoke: ERROR: %s never answered 2xx at %s within %ss (last %s)\n' \
    "$label" "$path" "$HEALTH_TIMEOUT" "$code" >&2
  return 1
}

# ── deploy legs (deploy.sh ordering: migrations BEFORE up -d) ───────────────
run_migrations() {
  log 'migrations: compose run --rm -T backend alembic upgrade head'
  COMPOSE_TOUCHED=1
  compose run --rm -T backend alembic upgrade head \
    || die 2 'migrations failed (alembic upgrade head)'
}

stack_up() {
  log 'compose up -d'
  compose up -d || die 3 'compose up -d failed (a host port may be taken — see SMOKE_*_PORT knobs)'
  STACK_UP=1
}

# Full scenario-3 contract against the running stack.
assert_http_contract() {
  wait_http backend /api/v1/health 'backend /api/v1/health' \
    || die 4 'health wait failed'

  local code
  http_code backend /api/v1/my
  code=$PROBE_CODE
  [ "$code" = 401 ] \
    || die 4 "anonymous GET /api/v1/my: want 401, got $code (auth must refuse anonymous API reads)"
  log 'anonymous API read refused: GET /api/v1/my → 401'

  wait_http admin /admin 'admin /admin' || die 4 'admin shell wait failed'
  local body
  http_body admin /admin
  body=$PROBE_BODY
  printf '%s' "$body" | grep -qiE '<!doctype html|<html' \
    || die 4 '/admin answered 2xx but the body has no HTML shell marker'
  log 'admin shell served on /admin (HTML shell; data stays behind the 401)'
}

# Volume asserts exec INSIDE the running backend (header: storage-agnostic —
# no host-file-sharing assumption). memo.db lives at the env-contract path
# /opt/memo/data/memo.db by construction.
backend_ls_data() { # prints the data-volume listing
  docker exec "$BACKEND_CONTAINER" ls /opt/memo/data 2>/dev/null || true
}

assert_wal() { # Task-1 criterion: WAL pragmas live → -wal/-shm exist on the volume
  local listing f
  listing=$(backend_ls_data)
  for f in memo.db-wal memo.db-shm; do
    printf '%s\n' "$listing" | grep -qx "$f" \
      || die 4 "WAL file missing on the data volume: /opt/memo/data/$f (Task 1 WAL pragmas not in effect; volume has: $(printf '%s' "$listing" | tr '\n' ' '))"
  done
  log "WAL present on the data volume (memo.db-wal + memo.db-shm): $(printf '%s' "$listing" | tr '\n' ' ')"
}

memo_db_inode() { # prints memo.db's inode (GNU stat inside the container)
  docker exec "$BACKEND_CONTAINER" stat -c '%i' /opt/memo/data/memo.db 2>/dev/null || true
}

# ── mode: default (spec §7 scenario 3) + rollback leg (scenario 2) ─────────
log "mode=$MODE tag=$TAG prev=$PREV_TAG ports=$BACKEND_HOST_PORT/$ADMIN_HOST_PORT/$WEB_HOST_PORT root=$SMOKE_DIR"
write_env 1
write_override "$TAG"

if [ "$MODE" != no_secrets ]; then
  run_migrations
  stack_up
  assert_http_contract
  assert_wal
  log 'scenario 3 GREEN: clean dir → migrations → health → 401 anonymous → /admin shell → WAL'
fi

if [ "$MODE" = rollback ]; then
  db_inode_before=$(memo_db_inode)
  [ -n "$db_inode_before" ] \
    || die 4 'memo.db not found on the volume after the first deploy'
  log "rollback leg: redeploy previous tag '$PREV_TAG' on the SAME volumes (memo.db inode $db_inode_before)"
  # deploy.sh semantics: NO down in between — migrations + up -d recreate the
  # containers against the persisted volume.
  write_override "$PREV_TAG"
  run_migrations
  stack_up
  assert_http_contract
  assert_wal
  db_inode_after=$(memo_db_inode)
  [ -n "$db_inode_after" ] \
    || die 4 'memo.db disappeared from the volume during rollback'
  [ "$db_inode_before" = "$db_inode_after" ] \
    || die 4 "rollback recreated memo.db (inode $db_inode_before → $db_inode_after) — DB must stay untouched"
  log "scenario 2 GREEN: previous-tag redeploy healthy, memo.db untouched (inode $db_inode_after)"
fi

# ── mode: --no-secrets (spec §7 scenario 4, image-level fail-fast) ─────────
if [ "$MODE" = no_secrets ]; then
  write_env 0
  write_override "$TAG" 1 # restart: "no" → observable exited(≠0), no restart loop
  log 'no-secrets: up backend only (ENV=production, no SECRET_KEY/OTP_PEPPER)'
  COMPOSE_TOUCHED=1
  compose up -d backend || die 3 'compose up -d backend failed'
  STACK_UP=1
  deadline=$((SECONDS + 30))
  status=''
  while (( SECONDS < deadline )); do
    status=$(docker inspect -f '{{.State.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || true)
    if [ "$status" = exited ]; then
      container_rc=$(docker inspect -f '{{.State.ExitCode}}' "$BACKEND_CONTAINER")
      [ "$container_rc" != 0 ] \
        || die 5 'backend exited with code 0 without secrets — the fail-fast did NOT fire'
      docker logs "$BACKEND_CONTAINER" 2>&1 \
        | grep -q 'SECRET_KEY must be set when ENV=production' \
        || die 5 'backend exited non-zero but the SECRET_KEY fail-fast message is absent from logs'
      log "scenario 4 GREEN: backend refused to start without secrets (exit $container_rc, fail-fast message in logs)"
      exit 0
    fi
    sleep 2
  done
  die 5 "backend container never refused to start (status '$status' after 30s) — the secrets fail-fast did not fire"
fi

exit 0
