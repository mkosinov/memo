#!/usr/bin/env bash
# Edge-image verification (GH #616 Task 3.3, RT-B1) — the RED/GREEN instrument
# for Dockerfile.edge + nginx.conf + nginx.smoke.conf. No pytest here: the
# checks are the docker build, `nginx -t` for BOTH configs (prod conf gets
# throwaway self-signed certs placed at the paths the compose contract fixes),
# and a live serve check of the SPA index through the smoke conf.
#
# Run from the repo root of the worktree:
#   deploy/verify-edge.sh
#
# Requirements: working docker, free port 18080, openssl on the host.
#
# Configs/certs reach the container via `docker cp`, NOT bind mounts: the
# docker daemon in this environment only shares a subset of host paths (the
# worktree is not among them), while docker cp works regardless. The files
# still land at the exact container paths the compose contract fixes, so the
# verification is equivalent to the -v variant. Cleans up after itself
# (containers, temp certs); never commits anything.
set -euo pipefail

TAG="memo-edge:test"
PROD_CONF="$(cd "$(dirname "$0")" && pwd)/nginx.conf"
SMOKE_CONF="$(cd "$(dirname "$0")" && pwd)/nginx.smoke.conf"

note() { printf '[verify-edge] %s\n' "$*"; }

PROD_C=""
SMOKE_C=""
SERVE_C=""
CERTDIR=""
cleanup() {
    local c
    for c in "$PROD_C" "$SMOKE_C" "$SERVE_C"; do
        [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true
    done
    [ -n "$CERTDIR" ] && rm -rf "$CERTDIR"
}
trap cleanup EXIT

# --- 1. Image builds from the repo-root context -----------------------------
note "1/5 docker build -f deploy/Dockerfile.edge -t $TAG ."
docker build -f deploy/Dockerfile.edge -t "$TAG" .

# --- 2. nginx -t: PROD conf with throwaway certs at the contract paths ------
note "2/5 nginx -t (prod conf + self-signed certs at /etc/nginx/certs)"
CERTDIR="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "$CERTDIR/privkey.pem" -out "$CERTDIR/fullchain.pem" \
    -subj "/CN=edge-verify.local" >/dev/null 2>&1
PROD_C="memo-edge-verify-prod"
docker create --name "$PROD_C" "$TAG" nginx -t >/dev/null
docker cp "$PROD_CONF" "$PROD_C:/etc/nginx/conf.d/default.conf"
docker cp "$CERTDIR" "$PROD_C:/etc/nginx/certs"
docker start -a "$PROD_C"
docker rm "$PROD_C" >/dev/null && PROD_C=""

# --- 3. nginx -t: SMOKE conf as-is (no TLS, no certs) ------------------------
note "3/5 nginx -t (smoke conf as-is)"
SMOKE_C="memo-edge-verify-smoke"
docker create --name "$SMOKE_C" "$TAG" nginx -t >/dev/null
docker cp "$SMOKE_CONF" "$SMOKE_C:/etc/nginx/conf.d/default.conf"
docker start -a "$SMOKE_C"
docker rm "$SMOKE_C" >/dev/null && SMOKE_C=""

# --- 4/5 Serve check: smoke conf, SPA index over HTTP ------------------------
# /api and /admin have no backends in this one-container check — connection
# refused for them is EXPECTED and not tested; only the static SPA is.
# Probed via `docker exec curl 127.0.0.1:80` inside the container: the local
# daemon does not publish ports onto this shell's network namespace, and the
# image ships curl — so the check needs no host networking at all. Host port
# publishing is compose's concern, not this image's.
note "4/5 serve / (smoke conf, curl inside the container)"
SERVE_C="memo-edge-verify-serve"
docker create --name "$SERVE_C" "$TAG" >/dev/null
docker cp "$SMOKE_CONF" "$SERVE_C:/etc/nginx/conf.d/default.conf"
docker start "$SERVE_C" >/dev/null

BODY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
    if BODY="$(docker exec "$SERVE_C" curl -fsS http://127.0.0.1:80/ 2>/dev/null)"; then break; fi
    sleep 1
done
[ -n "$BODY" ] || { note "FAIL: no response from /"; exit 1; }
printf '%s' "$BODY" | grep -qi '<!doctype html' || { note "FAIL: / did not return the SPA index"; exit 1; }
docker rm -f "$SERVE_C" >/dev/null && SERVE_C=""

note "5/5 all green: build, nginx -t x2, SPA serve"
