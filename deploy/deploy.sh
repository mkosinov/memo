#!/usr/bin/env bash
# =============================================================================
# deploy/deploy.sh — production rollout on the VPS (GH #616, spec §4.2–4.3).
# =============================================================================
#
# Invoked by the release workflow (.github/workflows/deploy.yml, job
# `deploy`), which scp's deploy.sh + render-env.sh + docker-compose.prod.yml
# to /opt/memo/deploy/, renders the env file (see the note below) and runs
# `./deploy.sh <release-tag>`. May also be run manually on the VPS — that
# is the rollback path (spec §4.3): a CONSCIOUS re-run with the PREVIOUS
# release tag; there is no auto-rollback by design.
#
# Usage (cwd does not matter — the script cds next to itself, where the
# compose file lives):
#   ./deploy.sh <release-tag>
#
# The tag comes from $1; when $1 is omitted the MEMO_IMAGE_TAG env var is
# used (the workflow passes both, equal). A mismatch warns and prefers $1.
#
# Environment:
#   REGISTRY_TOKEN         optional read:packages PAT; non-empty → docker
#                          login (username = registry namespace: mkosinov
#                          for ghcr.io/mkosinov/memo) to pull PRIVATE
#                          images; empty → no login (public images).
#                          Never echoed (login reads it via --password-stdin).
#   MEMO_REGISTRY_PREFIX   compose image namespace, default
#                          ghcr.io/mkosinov/memo — must stay byte-equal to
#                          the compose/workflow defaults.
#   HEALTH_TIMEOUT_SECONDS health-wait budget, default 120.
#
# Env file note: /opt/memo/env/production.env is rendered by render-env.sh
# (scp'ed into the same dir by the workflow) BEFORE this script runs —
# values arrive on render-env.sh's STDIN and never appear in argv. This
# script never writes the env file; the preflight below only verifies the
# file exists.
#
# Operator pre-reqs (deploy/Dockerfile.backend header, runbook #619):
#   /opt/memo/env/production.env, /opt/memo/data, /opt/memo/media exist;
#   the two volume dirs chowned 1001:1001 (SQLite WAL in data/; avatar
#   writes at the media volume ROOT — root-owned mount points die as
#   EACCES).
#
# Exit codes (single canon — a health failure is NOT a migration failure):
#   0  success — stack up + /api/v1/health answered 2xx
#   1  usage / preflight — bad tag, compose CLI missing, python3 missing,
#      operator pre-req paths absent
#   2  migration failure (alembic upgrade head) — stack NOT started; the
#      previous release keeps running untouched
#   3  health timeout — stack is UP but never answered 2xx in time;
#      inspect with `docker compose logs backend` (see §4.3 for rollback)
#   4  registry failure — docker login or docker pull failed (DB untouched)
#   5  compose up -d failed
#
# Compose CLI: `docker compose` (v2 plugin) when available, else standalone
# `docker-compose` — the VPS docker vintage is unknown, both must work.
# =============================================================================

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
# The compose file is scp'ed next to this script by the workflow.
cd "$SCRIPT_DIR"
COMPOSE_FILE=docker-compose.prod.yml

die() { # die <exit-code> <message...>
  local code=$1
  shift
  printf 'deploy.sh: ERROR: %s\n' "$*" >&2
  exit "$code"
}
log() { printf 'deploy.sh: %s\n' "$1"; }

# ── compose CLI shim (orchestrator decision: plugin or standalone) ────────
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose -f "$COMPOSE_FILE" "$@"; }
else
  die 1 "neither 'docker compose' (plugin) nor 'docker-compose' (standalone) is available"
fi

# ── release tag & registry prefix ──────────────────────────────────────────
tag=${1:-${MEMO_IMAGE_TAG:-}}
case "$tag" in
  '') die 1 "usage: ./deploy.sh <release-tag> (or export MEMO_IMAGE_TAG)" ;;
  *[!A-Za-z0-9_.-]*) die 1 "invalid release tag: '$tag'" ;;
esac
if [ "$#" -ge 1 ] && [ -n "${MEMO_IMAGE_TAG:-}" ] && [ "$1" != "$MEMO_IMAGE_TAG" ]; then
  printf 'deploy.sh: WARNING: arg tag %s differs from MEMO_IMAGE_TAG %s — using the argument\n' \
    "$1" "$MEMO_IMAGE_TAG" >&2
fi

REGISTRY_PREFIX=${MEMO_REGISTRY_PREFIX:-ghcr.io/mkosinov/memo}
case "$REGISTRY_PREFIX" in
  */*) ;;
  *) die 1 "MEMO_REGISTRY_PREFIX must be <host>/<namespace>, got: '$REGISTRY_PREFIX'" ;;
esac

# Compose interpolates both (same defaults baked into the compose file).
export MEMO_IMAGE_TAG="$tag"
export MEMO_REGISTRY_PREFIX="$REGISTRY_PREFIX"

# Through edge — the only service publishing host ports (80): the wait
# then covers the whole nginx → backend → DB chain. Port 80 serves this
# exact path to loopback ONLY (exact-match location with allow 127.0.0.1
# in deploy/nginx.conf; GH #616).
HEALTH_URL=http://127.0.0.1/api/v1/health
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-120}

# ── preflight: operator pre-reqs ───────────────────────────────────────────
command -v python3 >/dev/null 2>&1 \
  || die 1 "python3 not found on the host — the health probe needs it (no curl in the images)"
for path in /opt/memo/env/production.env /opt/memo/data /opt/memo/media; do
  [ -e "$path" ] || die 1 "missing $path — operator pre-req (deploy/Dockerfile.backend header, runbook #619)"
done
# uid-1001 ownership is a WARNING, not an error: a remapped-uid setup
# (Dockerfile.backend header) is legitimate; a forgotten chown on a stock
# setup would otherwise surface as a cryptic health timeout (exit 3).
# media included: the backend writes avatars/ at the media volume ROOT
# (single media volume, spec §3.2 rev.6) — same uid-1001 failure mode.
for dir in /opt/memo/data /opt/memo/media; do
  if [ "$(stat -c %u "$dir")" != 1001 ]; then
    printf 'deploy.sh: WARNING: %s is not owned by uid 1001 — unless this is a remapped-uid setup, run: chown 1001:1001 %s\n' \
      "$dir" "$dir" >&2
  fi
done

# ── registry login (only when a token is provided — private images) ────────
registry_host=${REGISTRY_PREFIX%%/*}
if [ -n "${REGISTRY_TOKEN:-}" ]; then
  registry_user=${REGISTRY_PREFIX#*/}
  registry_user=${registry_user%%/*}
  log "docker login $registry_host (user $registry_user, read:packages PAT)"
  # --password-stdin: the token never appears in argv (ps) or script output.
  if ! printf '%s' "$REGISTRY_TOKEN" | docker login "$registry_host" \
      --username "$registry_user" --password-stdin >/dev/null; then
    die 4 "docker login to $registry_host failed — check REGISTRY_TOKEN (needs read:packages)"
  fi
fi

# ── pull the 3 tagged images BEFORE touching the DB (fail fast, exit 4) ────
for image in backend admin edge; do
  log "docker pull ${REGISTRY_PREFIX}/${image}:${tag}"
  docker pull "${REGISTRY_PREFIX}/${image}:${tag}" \
    || die 4 "docker pull ${REGISTRY_PREFIX}/${image}:${tag} failed"
done

# Drop the read PAT from the host's docker config as soon as pulls are done.
if [ -n "${REGISTRY_TOKEN:-}" ]; then
  docker logout "$registry_host" >/dev/null 2>&1 || true
fi

# ── migrations BEFORE up -d (spec §3.2/§4.2) ───────────────────────────────
log "migrations: compose run --rm backend alembic upgrade head"
# -T (no TTY) is mandatory over ssh without a client tty — docker-compose v1
# hard-fails with "the input device is not a TTY"; v2 tolerates both.
if ! compose run --rm -T backend alembic upgrade head; then
  die 2 "migrations failed — stack NOT started, the previous release keeps running; fix and re-deploy, or roll back (spec §4.3)"
fi

# ── up ─────────────────────────────────────────────────────────────────────
log "compose up -d"
if ! compose up -d; then
  die 5 "docker compose up -d failed"
fi

# ── health wait: python loop through edge's host-published port 80 ──────────
log "waiting for $HEALTH_URL (up to ${HEALTH_TIMEOUT_SECONDS}s)"
# The images ship python but no curl (spec §3.2); urlopen raises on non-2xx
# and on timeout → non-zero exit → retry until the deadline.
probe="import urllib.request; urllib.request.urlopen('$HEALTH_URL', timeout=3)"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if python3 -c "$probe" >/dev/null 2>&1; then
    log "healthy — deploy of tag '$tag' complete"
    exit 0
  fi
  sleep 2
done
die 3 "health timeout: $HEALTH_URL did not answer 2xx within ${HEALTH_TIMEOUT_SECONDS}s — stack is UP; inspect: compose logs backend; rollback = previous tag (spec §4.3)"
