#!/usr/bin/env bash
# =============================================================================
# scripts/prod-smoke.sh — local production smoke (GH #616, spec §5 + §7).
# =============================================================================
#
# Raises the FULL prod topology (deploy/docker-compose.prod.yml: edge →
# backend/admin, spec §3.2) on the local docker daemon against a throwaway
# temp dir — the canonical E2E stand-in for the infra feature until the VPS
# exists (#574). Round 2 (rev.6 topology):
#
#   - env: the DUMMY smoke env is rendered by deploy/render-env.sh into the
#     CANONICAL path /opt/memo/env/production.env — the base compose
#     env_file. Compose UNION-merges env_file across merged files (round-1
#     lesson), so an override can never take that path over: the canonical
#     path must simply HAVE a file, and rendering it there is the ONLY env
#     mechanism the smoke uses (same renderer as deploy.sh and the CI
#     PR-smoke job — render-env.sh is the single render path, spec §3.3).
#   - override: replaces round-1's sed-generated port-adapted base copy.
#     The base compose is used VERBATIM; the generated override redirects
#     the volume binds into SMOKE_DIR and collapses edge to ONE published
#     port via the `!override` YAML tag (compose ≥ 2.24, version-gated at
#     preflight) — which also drops the certs/acme binds wholesale (no
#     certs on a dev machine, no stray /opt/memo dirs created by docker's
#     bind-mkdir). nginx.smoke.conf (the TLS-off routing mirror) rides in
#     a NAMED volume, populated daemon-side from stdin (see below).
#
#   - daemon-sharing agnosticism (round-1 lesson, made structural): on
#     docker-in-VM daemons NOTHING on the smoke shell's filesystem is
#     shared — /root-style paths are refused, /tmp-style binds silently
#     land in daemon-local directories (a file bind even fails outright:
#     docker auto-creates a DIRECTORY at the unseen source and dies on
#     the file/dir type mismatch). Therefore:
#       * the smoke conf is piped through stdin into a named volume
#         (`docker run --rm -i -v <vol>:/c … 'cat > /c/default.conf'
#         < deploy/nginx.smoke.conf`) and mounted ro at
#         /etc/nginx/conf.d — identical mechanics on native, Docker
#         Desktop and VM daemons, no file-sharing assumption at all;
#       * the media sentinels are planted host-side FIRST (the natural
#         path on shared daemons — the imac, CI runners, the future VPS)
#         and, if the backend container cannot see them after up, re-
#         planted via `docker exec` (idempotent ensure) — the same
#         host-primary / in-container-fallback pattern the HTTP probes
#         and volume asserts have used since round 1.
#   - volumes: temp SMOKE_DIR/{data,media} replace /opt/memo/{data,media}
#     (backend mounts the media ROOT rw; edge mounts ONLY media/public ro —
#     the rev.6 privacy boundary is the MOUNT level, exercised below).
#   - checks: ALL through edge, plain http (nginx.smoke.conf has no TLS):
#     /api/v1/health proves the nginx→backend→DB chain, / the static SPA,
#     /admin the admin shell, anonymous /api/v1/my must be 401, and the
#     /images/public/ alias must serve the media volume byte-exact while
#     a sentinel planted OUTSIDE the public subtree stays unreachable.
#
# Env privilege handling (spec §5: the imac needs a one-time
# `sudo mkdir -p /opt/memo/env`): if /opt/memo/env is writable by the
# current user, render-env.sh runs plainly; otherwise the script tries
# `sudo -n` (passwordless); if that is unavailable too, it dies with the
# exact command to run once.
#
# SAFETY GUARD — pre-existing canonical env file: prod-smoke must NEVER
# clobber a real /opt/memo/env/production.env silently. If the target
# exists before the run it is moved away to
# /opt/memo/env/production.env.pre-smoke.bak — BESIDE the target, never
# inside the disposable SMOKE_DIR: a crash between the backup and the
# teardown restore must not orphan the real env in a temp dir (the NEXT
# run would then find no target, render dummies and silently leave the
# machine without its production env). Same directory = same filesystem,
# mv preserves mode and content (e.g. the 0600 root:root contract);
# teardown restores it byte-exact. A failed backup aborts the run BEFORE
# anything is rendered, and a STALE .bak found at startup (a previous run
# crashed before restoring it) aborts too — the operator restores by
# hand; data we cannot account for is never overwritten. When NO file
# pre-existed, teardown REMOVES the canonical dummy (best effort, sudo
# fallback) — the machine is left as found either way.
#
# Usage:
#   scripts/prod-smoke.sh                # default: spec §7 scenario 3 —
#                                        # clean dir → env render →
#                                        # migrations → up → checks through
#                                        # edge → WAL → teardown
#   scripts/prod-smoke.sh --rollback     # + spec §7 scenario 2 — a SECOND
#                                        # deploy with the PREVIOUS tag on
#                                        # the SAME volumes (no down in
#                                        # between): health green again via
#                                        # edge, memo.db NOT recreated
#                                        # (inode).
#   scripts/prod-smoke.sh --no-secrets   # spec §7 scenario 4 — canonical
#                                        # env rendered WITHOUT
#                                        # SECRET_KEY/OTP_PEPPER lines
#                                        # (same render-env.sh, fewer
#                                        # lines): the backend container
#                                        # must refuse to start
#                                        # (image-level fail-fast,
#                                        # exit != 0 + message in logs).
#   scripts/prod-smoke.sh -h | --help    # usage summary
#
# Knobs (environment):
#   PROD_SMOKE_TAG             current image tag, default "test" — expects
#                              locally built memo-{backend,admin,edge}:<tag>
#                              (contexts: backend/ for the backend image,
#                              repo root for admin/edge — see the Dockerfile
#                              headers).
#   PROD_SMOKE_PREV_TAG        rollback tag, default = PROD_SMOKE_TAG (with
#                              only one local tag the rollback mechanics —
#                              same volumes, redeploy, DB untouched — are
#                              still exercised; set a real previous tag
#                              when one exists).
#   PROD_SMOKE_HEALTH_TIMEOUT  health-wait budget, seconds, default 120.
#   PROD_SMOKE_DIR             smoke root (volumes + override + env backup);
#                              default: fresh mktemp dir, removed on exit.
#   SMOKE_EDGE_PORT            the ONE published host port — edge :80,
#                              default 8080. Round-1's three per-service
#                              knobs are GONE: in this topology backend and
#                              admin publish nothing, edge is the only
#                              entry point.
#
# Compose merge notes: edge volumes/ports use `!override` to REPLACE the
# base lists wholesale (single published port; certs/acme binds dropped);
# backend volumes MERGE by target path — the temp binds replace
# /opt/memo/{data,media} 1:1. The override carries NO env_file key
# anywhere: the canonical file rendered above IS the base env_file —
# substituting it is exactly the union-merge bug round 1 survived.
#
# HTTP probing: HOST curl against the published edge port is the primary
# path (that is how it works on the imac). On docker-in-VM hosts
# published-port loopback can be unreachable from the host shell, so every
# probe FALLS BACK automatically to running the request from INSIDE the
# backend container over the compose network (docker exec + python3, URL
# http://edge:80). NOT from the edge container: nginx:alpine ships busybox
# wget without -S (HTTP errors collapse to rc 1 — no status codes) and no
# python, while the backend image has python3 — exact 200/401/not-200
# asserts keep working in the fallback. Mode is auto-detected per probe;
# once the in-network path answers it is locked in for the run.
#
# Volume asserts (WAL files, the rollback inode) likewise docker-exec
# INSIDE the running backend container (storage-agnostic, no host-file-
# sharing assumption). memo.db lives at the env-contract path
# /opt/memo/data/memo.db by construction.
#
# Teardown ALWAYS runs (EXIT trap): canonical env restored/removed, compose
# down -v --remove-orphans, the conf volume removed by name, temp dir
# removed, then a leftover sweep — any surviving container/volume/network
# of this compose project fails the run (exit 8). Failed runs dump the
# last 100 log lines of every service BEFORE the teardown.
#
# Exit codes:
#   0  success — every scenario assert green, teardown left nothing
#   1  usage / preflight — bad flags, docker/compose missing or < 2.24,
#      local images for the requested tags absent, bad port number, env
#      path unwritable (and no passwordless sudo), env backup failed
#   2  migrations failed (compose run alembic upgrade head)
#   3  compose up -d failed (incl. host port already allocated)
#   4  HTTP/media/WAL contract broken — health timeout, anonymous API not
#      401, SPA/admin not served, /images/public alias wrong bytes,
#      non-public media leaked, WAL files absent, memo.db recreated during
#      rollback
#   5  --no-secrets assertion failed — backend did NOT refuse to start
#   8  teardown leftovers — containers/volumes/networks survived down -v,
#      or the pre-existing canonical env could not be restored
#
# Compose CLI: `docker compose` (v2 plugin) when available, else standalone
# `docker-compose` (same shim as deploy/deploy.sh) — either way ≥ 2.24
# (the `!override` tag; version-gated at preflight, parsed numerically —
# BSD sort has no -V). One smoke at a time: the stack pins the
# 172.16.0.0/24 subnet (edge's static IP 172.16.0.10 is the backend trust
# boundary).
# =============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
PROD_COMPOSE=$SCRIPT_DIR/../deploy/docker-compose.prod.yml
RENDER_ENV=$SCRIPT_DIR/../deploy/render-env.sh
SMOKE_CONF_SRC=$SCRIPT_DIR/../deploy/nginx.smoke.conf

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
  scripts/prod-smoke.sh                scenario 3: clean temp dir → env
                                       rendered by render-env.sh to the
                                       canonical /opt/memo/env/production.env
                                       → migrations → up -d → checks THROUGH
                                       EDGE (health, /, /admin, 401
                                       anonymous, /images/public alias) →
                                       WAL on the volume → teardown
  scripts/prod-smoke.sh --rollback     + scenario 2: second deploy with the
                                       previous tag on the SAME volumes;
                                       health green via edge, memo.db not
                                       recreated
  scripts/prod-smoke.sh --no-secrets   scenario 4: canonical env WITHOUT
                                       SECRET_KEY/OTP_PEPPER → backend
                                       refuses to start
  scripts/prod-smoke.sh --help         this text

Knobs (environment):
  PROD_SMOKE_TAG             image tag (default "test"; expects locally
                             built memo-backend/admin/edge:<tag>)
  PROD_SMOKE_PREV_TAG        rollback tag (default = PROD_SMOKE_TAG)
  PROD_SMOKE_HEALTH_TIMEOUT  health budget seconds (default 120)
  PROD_SMOKE_DIR             smoke root dir (default: fresh mktemp, removed)
  SMOKE_EDGE_PORT            the ONE published host port — edge :80
                             (default 8080)
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

# The ONE published port: host half of the edge :80 mapping.
EDGE_HOST_PORT=${SMOKE_EDGE_PORT:-8080}
case $EDGE_HOST_PORT in
  '' | *[!0-9]*) die 1 "SMOKE_EDGE_PORT must be a number, got: '$EDGE_HOST_PORT'" ;;
esac
if [ "$EDGE_HOST_PORT" -lt 1 ] || [ "$EDGE_HOST_PORT" -gt 65535 ]; then
  die 1 "SMOKE_EDGE_PORT out of range 1-65535: '$EDGE_HOST_PORT'"
fi

# ── compose CLI shim (deploy.sh precedent: plugin or standalone) ────────────
command -v docker >/dev/null 2>&1 || die 1 "docker not found"
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  die 1 "neither 'docker compose' (plugin) nor 'docker-compose' (standalone) is available"
fi

# The override uses the `!override` YAML tag (compose ≥ 2.24): gate the
# version at preflight instead of dying mid-run. Parsed numerically —
# BSD/macOS sort has no -V, and this script must run on the imac.
compose_version=$("${COMPOSE_CMD[@]}" version --short 2>/dev/null || true)
compose_version=${compose_version%%[+-]*} # strip build suffixes like +desktop
compose_version=${compose_version#v}
case $compose_version in
  *[!0-9.]*) die 1 "cannot parse compose version '${compose_version:-<empty>}' — !override needs compose >= 2.24" ;;
esac
compose_maj=${compose_version%%.*}
compose_min=${compose_version#*.}
compose_min=${compose_min%%.*}
if [ "$compose_maj" -lt 2 ] || { [ "$compose_maj" -eq 2 ] && [ "$compose_min" -lt 24 ]; }; then
  die 1 "compose $compose_version is too old for the !override tag (needs >= 2.24)"
fi

# The base file interpolates ${MEMO_IMAGE_TAG:?} BEFORE the override replaces
# image: — any non-empty value works; the real names come from the override
# (test.yml prod-build precedent).
export MEMO_IMAGE_TAG=smoke

# compose() is defined after $OVERRIDE_FILE exists (SMOKE_DIR prep below);
# bash functions resolve their variables at CALL time, and no compose
# command runs before then.
compose() { "${COMPOSE_CMD[@]}" -p "$PROJECT" -f "$PROD_COMPOSE" -f "$OVERRIDE_FILE" "$@"; }

# ── preflight: local images ─────────────────────────────────────────────────
image_tags=$TAG
if [ "$MODE" = rollback ] && [ "$PREV_TAG" != "$TAG" ]; then
  image_tags="$TAG $PREV_TAG"
fi
# shellcheck disable=SC2086  # word-split of the tag list is intended
for tag in $image_tags; do
  for svc in backend admin edge; do
    if [ "$MODE" = no_secrets ] && [ "$svc" != backend ]; then continue; fi
    docker image inspect "memo-$svc:$tag" >/dev/null 2>&1 \
      || die 1 "image memo-$svc:$tag not found locally — build it first, e.g.
  docker build -f deploy/Dockerfile.backend -t memo-backend:test backend/
  docker build -f deploy/Dockerfile.admin  -t memo-admin:test  .
  docker build -f deploy/Dockerfile.edge   -t memo-edge:test   ."
  done
done

rand_hex() { # 32 random bytes as hex — openssl (imac/linux), od fallback
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

# ── smoke root: fresh temp dir with the volume mounts ───────────────────────
# Bind mounts replace /opt/memo/{data,media}; chmod 0777 because the backend
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
OVERRIDE_FILE=$SMOKE_DIR/override.yml
mkdir -p "$SMOKE_DIR/data" "$SMOKE_DIR/media/public/services" "$SMOKE_DIR/media/private"
chmod 0777 "$SMOKE_DIR/data" "$SMOKE_DIR/media" "$SMOKE_DIR/media/public"

# Media alias fixtures (rev.6 contract), planted BEFORE up:
#   - the POSITIVE sentinel inside the public subtree → must come back
#     byte-exact through /images/public/;
#   - the NEGATIVE sentinel on the media ROOT (backend-writable, NOT
#     mounted into edge) → must NEVER be served. Both are random per run
#     so a stale file from an earlier smoke can never satisfy the assert.
# No trailing newline: the byte-exact compare below survives $() capture.
# On unshared VM daemons these host-side files are invisible to containers
# — ensure_media_fixtures re-plants them daemon-side after up (header).
MEDIA_SENTINEL="smoke-media-$(rand_hex)"
NEG_SENTINEL="smoke-private-$(rand_hex)"
printf '%s' "$MEDIA_SENTINEL" > "$SMOKE_DIR/media/public/services/smoke-media-check.txt"
printf '%s' "$NEG_SENTINEL" > "$SMOKE_DIR/media/private/x.txt"

# ── canonical env: privilege + backup guard + render (render-env.sh) ────────
ENV_DIR=/opt/memo/env
ENV_TARGET=$ENV_DIR/production.env
ENV_BACKUP=$ENV_DIR/production.env.pre-smoke.bak # BESIDE the target (SAFETY GUARD in the header)
ENV_MOVED=0    # 1 once THIS run moved the real env into the backup slot
ENV_RENDERED=0 # 1 once THIS run rendered the canonical dummy
ENV_PRIV=''    # '' = current user writes; 'sudo -n' = privileged writes

env_do() { # env_do <cmd...> — run cmd with the resolved env privilege
  if [ -n "$ENV_PRIV" ]; then sudo -n "$@"; else "$@"; fi
}

resolve_env_privilege() {
  mkdir -p "$ENV_DIR" >/dev/null 2>&1 || true # plain attempt (root / writable /opt)
  if [ -d "$ENV_DIR" ] && [ -w "$ENV_DIR" ]; then
    ENV_PRIV=''
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    ENV_PRIV='sudo -n' # imac case (spec §5: one-time sudo mkdir -p /opt/memo/env)
  else
    die 1 "cannot write $ENV_DIR as $(id -un) and passwordless sudo is unavailable — run ONCE:
  sudo mkdir -p $ENV_DIR
then either hand it over (sudo chown \$(id -un) $ENV_DIR) or keep sudo -n passwordless"
  fi
}

env_backup_if_present() { # SAFETY GUARD: never clobber a real canonical file
  # A stale backup BESIDE the target means an earlier run died between its
  # own backup and restore — the real env is sitting in the .bak while the
  # canonical path is missing (or holds leftovers). That state cannot be
  # reconciled automatically: ABORT and let the operator restore by hand.
  # Never overwrite data we cannot account for.
  if [ -f "$ENV_BACKUP" ]; then
    die 1 "env guard: stale backup $ENV_BACKUP — a previous run crashed before restoring it.
Restore it manually (drop the leading sudo when /opt/memo/env is yours):
  sudo mv -f $ENV_BACKUP $ENV_TARGET
then re-run the smoke."
  fi
  if [ -f "$ENV_TARGET" ]; then
    log "env guard: pre-existing $ENV_TARGET — backing up to $ENV_BACKUP (restored at teardown)"
    env_do mv -f -- "$ENV_TARGET" "$ENV_BACKUP" \
      || die 1 "env guard: backing up the pre-existing $ENV_TARGET failed — aborting BEFORE touching it"
    ENV_MOVED=1
    [ -f "$ENV_BACKUP" ] \
      || die 1 "env guard: backup verification failed ($ENV_BACKUP missing after mv)"
  fi
}

render_env() { # render_env <with-secrets:1|0> — dummy env → canonical path
  # Container-internal paths stay verbatim (spec §3.3) so the DATABASE_URL
  # contract is exercised for real: alembic env.py and uvicorn consume the
  # CANONICAL file through the base compose env_file.
  local with_secrets=$1
  {
    echo 'ENV=production'
    if [ "$with_secrets" = 1 ]; then
      echo "SECRET_KEY=$(rand_hex)"
      echo "OTP_PEPPER=$(rand_hex)"
    fi
    echo 'DATABASE_URL=sqlite+aiosqlite:////opt/memo/data/memo.db'
    echo 'FILES_DIR=/opt/memo/media'
  } | env_do bash "$RENDER_ENV" \
    || die 1 "render-env.sh failed for $ENV_TARGET (see its stderr above)"
  ENV_RENDERED=1
  log "env: dummy env rendered (secrets=$with_secrets) → $ENV_TARGET"
}

# ── teardown: ALWAYS (trap), zero leftovers (DoD) ───────────────────────────
STACK_UP=0
COMPOSE_TOUCHED=0
# shellcheck disable=SC2317,SC2329  # TEARDOWN runs only via the EXIT trap;
# ^ SC2317 (shellcheck <0.11) / SC2329 (>=0.11: "not invoked") — same nit.
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
  # The conf volume is created by a plain `docker run` (no compose project
  # label) — `down -v` and the label-filtered sweep below cannot see it;
  # remove explicitly and fail the run if it survives.
  if docker volume inspect "$NGINX_CONF_VOL" >/dev/null 2>&1; then
    if docker volume rm "$NGINX_CONF_VOL" >/dev/null 2>&1; then
      log "teardown: conf volume $NGINX_CONF_VOL removed"
    else
      printf 'prod-smoke: ERROR: conf volume %s survived teardown\n' "$NGINX_CONF_VOL" >&2
      if [ "$rc" -eq 0 ]; then rc=8; fi
    fi
  fi
  # Canonical env: restore the pre-existing file (SAFETY GUARD above) or
  # remove the dummy this run rendered (machine left as found; best effort
  # by design). The backup lives BESIDE the target
  # (/opt/memo/env/production.env.pre-smoke.bak), never in the temp dir.
  if [ "$ENV_MOVED" = 1 ] && [ -f "$ENV_BACKUP" ]; then
    if env_do mv -f -- "$ENV_BACKUP" "$ENV_TARGET"; then
      log "env guard: pre-existing $ENV_TARGET restored (mv — byte-exact, mode preserved)"
    else
      printf 'prod-smoke: ERROR: could not restore the pre-existing %s from %s\n' \
        "$ENV_TARGET" "$ENV_BACKUP" >&2
      if [ "$rc" -eq 0 ]; then rc=8; fi
    fi
  elif [ "$ENV_RENDERED" = 1 ] && [ -f "$ENV_TARGET" ]; then
    if env_do rm -f -- "$ENV_TARGET"; then
      log "env: canonical dummy $ENV_TARGET removed — machine left as found"
    else
      printf 'prod-smoke: WARNING: could not remove the canonical dummy %s — remove it manually\n' \
        "$ENV_TARGET" >&2
    fi
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

resolve_env_privilege

# Smoke conf target: a named volume mounted ro at /etc/nginx/conf.d,
# populated daemon-side from stdin (header: no file-sharing assumption).
# Fixed name → deterministic teardown (compose down -v only removes
# project-LABELLED volumes; this one is created by a plain `docker run`
# first, so teardown removes it explicitly and the sweep checks the name).
NGINX_CONF_VOL=memo-prod-smoke-nginxconf

populate_nginx_conf() { # pipe deploy/nginx.smoke.conf into the conf volume
  log "nginx smoke conf: populating volume $NGINX_CONF_VOL (stdin → /default.conf)"
  docker run --rm -i -v "$NGINX_CONF_VOL":/c "memo-edge:${TAG}" \
    sh -c 'cat > /c/default.conf' < "$SMOKE_CONF_SRC" \
    || die 3 "populating $NGINX_CONF_VOL with $SMOKE_CONF_SRC failed"
}

# write_override <tag> [restart-no:1] — local image names (not GHCR), temp
# volume binds, the conf volume and the SINGLE published edge port.
# `!override` REPLACES the base edge lists wholesale (drops certs/acme,
# collapses ports — see the header); backend volumes merge by target path.
# NO env_file key anywhere: the canonical file rendered above IS the base
# env_file. `restart: "no"` only in --no-secrets mode so the fail-fast exit
# is observable as a plain exited(≠0) state instead of a restart-policy
# loop. container_name pins the backend for the docker exec fallback probe.
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
    container_name: ${BACKEND_CONTAINER}
${restart_line}    volumes:
      - ${SMOKE_DIR}/data:/opt/memo/data
      - ${SMOKE_DIR}/media:/opt/memo/media
  admin:
    image: memo-admin:${tag}
  edge:
    image: memo-edge:${tag}
    volumes: !override
      - ${SMOKE_DIR}/media/public:/var/www/media-public:ro
      - ${NGINX_CONF_VOL}:/etc/nginx/conf.d:ro
    ports: !override
      - "${EDGE_HOST_PORT}:80"
volumes:
  memo-prod-smoke-nginxconf:
    name: ${NGINX_CONF_VOL}
YAML
}

# ── HTTP probes: host curl primary, in-network fallback ────────────────────
# HTTP_MODE: auto (try host first) → host | net once decided. All probes go
# THROUGH EDGE (the only published service): host-side URL is the published
# edge port; the in-network fallback execs python3 INSIDE the backend
# container and asks http://edge:80 by compose DNS (edge itself ships only
# busybox wget — no status codes, no python; header comment).
#
# Results land in the PROBE_CODE / PROBE_BODY globals — the callers must NOT
# run these under `$( )`: command substitution is a subshell and would lose
# the HTTP_MODE lock-in (2026-11-22 smoke-debugging lesson).
HTTP_MODE=auto
PROBE_CODE=000
PROBE_BODY=''

net_probe() { # net_probe <code|body> <path>
  local what=$1 path=$2
  docker exec -i "$BACKEND_CONTAINER" python3 - "$what" "http://edge:80${path}" <<'PY' 2>/dev/null || true
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

http_code() { # http_code <path> → sets PROBE_CODE (3-digit | 000)
  local path=$1
  PROBE_CODE=000
  if [ "$HTTP_MODE" != net ] && command -v curl >/dev/null 2>&1; then
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      "http://127.0.0.1:${EDGE_HOST_PORT}${path}" 2>/dev/null) || code=000
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
  probed=$(net_probe code "$path")
  if [ -n "$probed" ] && [ "$probed" != 000 ]; then HTTP_MODE=net; fi
  PROBE_CODE=${probed:-000}
}

http_body() { # http_body <path> → sets PROBE_BODY
  local path=$1
  PROBE_BODY=''
  if [ "$HTTP_MODE" != net ] && command -v curl >/dev/null 2>&1; then
    local body
    body=$(curl -s --max-time 5 "http://127.0.0.1:${EDGE_HOST_PORT}${path}" 2>/dev/null) || body=''
    if [ -n "$body" ]; then
      HTTP_MODE=host
      PROBE_BODY=$body
      return 0
    fi
    if [ "$HTTP_MODE" = host ]; then return 0; fi
  fi
  PROBE_BODY=$(net_probe body "$path")
}

wait_http() { # wait_http <path> <label> — 0 on 2xx in time
  local path=$1 label=$2 code=000
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    http_code "$path"
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
  compose up -d || die 3 'compose up -d failed (host port taken? — see SMOKE_EDGE_PORT)'
  STACK_UP=1
}

# Full scenario-3 contract against the running stack, ALL through edge.
assert_http_contract() {
  wait_http /api/v1/health 'edge /api/v1/health (nginx→backend→DB chain)' \
    || die 4 'health wait failed'

  local code body
  http_code /api/v1/my
  code=$PROBE_CODE
  [ "$code" = 401 ] \
    || die 4 "anonymous GET /api/v1/my through edge: want 401, got $code (auth must refuse anonymous API reads)"
  log 'anonymous API read refused through edge: GET /api/v1/my → 401'

  wait_http / 'edge / (static SPA)' || die 4 'static SPA wait failed'

  wait_http /admin 'edge /admin (admin shell)' || die 4 'admin shell wait failed'
  http_body /admin
  body=$PROBE_BODY
  printf '%s' "$body" | grep -qiE '<!doctype html|<html' \
    || die 4 '/admin answered 2xx but the body has no HTML shell marker'
  log 'admin shell served through edge (HTML shell; data stays behind the 401)'

  # /images/public/ alias (rev.6): the public subtree of the single media
  # volume, byte-exact through the edge ro-mount.
  http_code /images/public/services/smoke-media-check.txt
  code=$PROBE_CODE
  [ "$code" = 200 ] \
    || die 4 "GET /images/public/services/smoke-media-check.txt: want 200, got $code (edge media alias broken)"
  http_body /images/public/services/smoke-media-check.txt
  body=$PROBE_BODY
  [ "$body" = "$MEDIA_SENTINEL" ] \
    || die 4 "media alias served wrong bytes (want the planted sentinel, got ${#body} chars) — volume/mount mismatch"
  log 'media alias byte-exact: /images/public/services/smoke-media-check.txt → sentinel served'

  # Negative (rev.6 privacy boundary): the sentinel planted on the media
  # ROOT — backend-writable, NOT inside the edge ro-mount — must never come
  # back. A 404 is fine, and so is the SPA fallback (try_files serves the
  # shell with 200): the assert is on the BYTES, not the status — edge
  # physically cannot reach non-public media.
  http_code /images/private/x.txt
  code=$PROBE_CODE
  http_body /images/private/x.txt
  body=$PROBE_BODY
  if [ "$code" = 200 ] && [ "$body" = "$NEG_SENTINEL" ]; then
    die 4 'PRIVACY BOUNDARY BROKEN: /images/private/x.txt served the sentinel planted OUTSIDE the public subtree (edge mount must be public-only)'
  fi
  log "negative media check: /images/private/x.txt → HTTP $code, non-public sentinel NOT served (404/SPA fallback — bytes cannot leak)"
}

# Volume asserts exec INSIDE the running backend (header: storage-agnostic —
# no host-file-sharing assumption). memo.db lives at the env-contract path
# /opt/memo/data/memo.db by construction.
backend_ls_data() { # prints the data-volume listing
  docker exec "$BACKEND_CONTAINER" ls /opt/memo/data 2>/dev/null || true
}

ensure_media_fixtures() { # sentinels reachable on the media volume in-container
  # Host-primary / in-container-fallback (round-1 probe pattern, header):
  # on shared daemons the host-planted files are already there; on unshared
  # VM daemons the backend container sees empty daemon-local dirs — plant
  # the same bytes through docker exec (uid 0: docker-created dirs are
  # root-owned; the app itself never writes these fixture paths).
  local visible
  visible=$(docker exec "$BACKEND_CONTAINER" cat /opt/memo/media/public/services/smoke-media-check.txt 2>/dev/null || true)
  if [ "$visible" = "$MEDIA_SENTINEL" ]; then
    log 'media fixtures: host-planted sentinel visible in-container (shared daemon)'
    return 0
  fi
  log 'media fixtures: host-planted sentinel NOT visible (unshared daemon) — planting via docker exec'
  docker exec -u 0 "$BACKEND_CONTAINER" sh -c \
    "mkdir -p /opt/memo/media/public/services /opt/memo/media/private \
 && printf '%s' '$MEDIA_SENTINEL' > /opt/memo/media/public/services/smoke-media-check.txt \
 && printf '%s' '$NEG_SENTINEL' > /opt/memo/media/private/x.txt" \
    || die 4 'planting media fixtures inside the backend container failed'
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
log "mode=$MODE tag=$TAG prev=$PREV_TAG edge-port=$EDGE_HOST_PORT root=$SMOKE_DIR env=$ENV_TARGET"
env_backup_if_present

if [ "$MODE" != no_secrets ]; then
  render_env 1
  write_override "$TAG"
  populate_nginx_conf
  run_migrations
  stack_up
  ensure_media_fixtures
  assert_http_contract
  assert_wal
  log 'scenario 3 GREEN: clean dir → canonical env → migrations → health → 401 anonymous → SPA + /admin shell → media alias → WAL'
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
  ensure_media_fixtures
  assert_http_contract
  assert_wal
  db_inode_after=$(memo_db_inode)
  [ -n "$db_inode_after" ] \
    || die 4 'memo.db disappeared from the volume during rollback'
  [ "$db_inode_before" = "$db_inode_after" ] \
    || die 4 "rollback recreated memo.db (inode $db_inode_before → $db_inode_after) — DB must stay untouched"
  log "scenario 2 GREEN: previous-tag redeploy healthy through edge, memo.db untouched (inode $db_inode_after)"
fi

# ── mode: --no-secrets (spec §7 scenario 4, image-level fail-fast) ─────────
if [ "$MODE" = no_secrets ]; then
  render_env 0
  write_override "$TAG" 1 # restart: "no" → observable exited(≠0), no restart loop
  log 'no-secrets: up backend only (canonical env WITHOUT SECRET_KEY/OTP_PEPPER lines)'
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
