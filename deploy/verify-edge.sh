#!/usr/bin/env bash
# Edge-image verification (GH #616 Task 3.3, RT-B1) — the RED/GREEN instrument
# for Dockerfile.edge + nginx.conf + nginx.smoke.conf. No pytest here: the
# checks are the conf-drift guard, the docker build, `nginx -t` for BOTH
# configs (prod conf gets throwaway self-signed certs placed at the paths
# the compose contract fixes), and a live serve check of the SPA index
# through the smoke conf.
#
# Run from the repo root of the worktree:
#   deploy/verify-edge.sh
#
# Requirements: working docker, openssl on the host.
#
# PROD_CONF / SMOKE_CONF env vars override the config paths (default:
# deploy/nginx.conf, deploy/nginx.smoke.conf next to this script) — used
# to point the drift stage at throwaway copies when proving it catches
# divergence.
#
# Configs/certs reach the container via `docker cp`, NOT bind mounts: the
# docker daemon in this environment only shares a subset of host paths (the
# worktree is not among them), while docker cp works regardless. The files
# still land at the exact container paths the compose contract fixes, so
# the verification is equivalent to the -v variant. Cleans up after itself
# (containers, temp certs); never commits anything.
set -euo pipefail

TAG="memo-edge:test"
PROD_CONF="${PROD_CONF:-$(cd "$(dirname "$0")" && pwd)/nginx.conf}"
SMOKE_CONF="${SMOKE_CONF:-$(cd "$(dirname "$0")" && pwd)/nginx.smoke.conf}"

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

# --- 1/6 Conf drift guard: nginx.smoke.conf mirrors nginx.conf routing ------
# The two confs duplicate the routing by hand (KEEP IN SYNC headers); this
# stage makes the sync mechanically checkable. extract_locations() parses
# an nginx conf and emits one line per location stanza:
#     <80|443>|<modifier-and-path>|<directive;directive;...>
# (server tag by listen port; comments stripped, whitespace squeezed;
# ROUTING directives only: set/proxy_pass/proxy_set_header/alias/
# try_files/root/default_type/return/add_header/client_max_body_size —
# TLS/ssl and resolver infrastructure lines are ignored by design).
# The comparison then enforces:
#   - every location of the prod 443 server appears in the smoke conf
#     VERBATIM — same path/modifier and the same directive sequence;
#   - the deploy health route `= /api/v1/health` is PRESENT in the smoke
#     conf and mirrors the prod :80 server's health stanza directive-for-
#     directive (deleting it must fail the guard, not pass silently);
#   - beyond that, the smoke conf carries NO location the prod 443 server
#     does not have;
#   - the :80-only pieces of nginx.conf (ACME webroot location, the
#     301-to-https fallback) are deliberately NOT required in the smoke
#     conf (TLS-off world has neither).
# What it does NOT catch: server-level drift outside locations (ssl_*,
# gzip posture, headers), comment drift, and re-formatting that the
# normalization erases. Coarse structural diff by design — nginx -t
# below still gates syntax and the serve stage gates behavior.
extract_locations() { # extract_locations <conf>
    awk '
      function emit() { printf "%s|%s|%s\n", tag, locpath, dirs }
      {
          line = $0
          sub(/#.*/, "", line) # strip comments
          gsub(/[ \t]+/, " ", line); sub(/^ | $/, "", line)
          if (line == "") next
          opens = gsub(/{/, "{", line); closes = gsub(/}/, "}", line)
          newdepth = depth + opens - closes
          if (in_loc && depth == 2 && newdepth <= 1) { # stanza closes
              emit(); in_loc = 0
          } else if (in_server && !in_loc && depth == 1 && line ~ /^listen /) {
              split(line, f, " ")
              if (f[2] ~ /443/) tag = "443"; else if (tag == "") tag = "80"
          } else if (in_server && !in_loc && depth == 1 && line ~ /^location /) {
              n = split(line, f, " ")
              if (f[n] == "{") n-- # drop the opening brace token
              if (f[2] ~ /^\//) locpath = f[2]; else locpath = f[2] " " f[3]
              in_loc = 1; dirs = ""
          } else if (depth == 0 && line ~ /^server[ {]/) {
              in_server = 1; tag = ""
          } else if (in_server && !in_loc && depth == 1 && newdepth == 0) {
              in_server = 0 # server closes
          } else if (in_loc && depth == 2) {
              # routing directive inside the stanza: first token allowlist
              split(line, f, " ")
              if (f[1] == "set" || f[1] == "proxy_pass" || f[1] == "proxy_set_header" \
               || f[1] == "alias" || f[1] == "try_files" || f[1] == "root" \
               || f[1] == "default_type" || f[1] == "return" || f[1] == "add_header" \
               || f[1] == "client_max_body_size") {
                  sub(/;[ ]*$/, "", line); sub(/}$/, "", line)
                  gsub(/[ \t]+$/, "", line)
                  dirs = dirs (dirs == "" ? "" : ";") line
              }
          }
          depth = newdepth
      }' "$1"
}

note "1/6 conf drift guard (nginx.conf 443 routing vs nginx.smoke.conf)"
PROD_443=$(extract_locations "$PROD_CONF" | grep '^443|' | cut -d'|' -f2-)
PROD_80_HEALTH=$(extract_locations "$PROD_CONF" | grep '^80|= /api/v1/health|' | cut -d'|' -f2-)
SMOKE_ALL=$(extract_locations "$SMOKE_CONF" | cut -d'|' -f2-)
if [ -z "$PROD_443" ] || [ -z "$SMOKE_ALL" ]; then
    note "FAIL: extracted no locations — conf parsing broke (prod443: ${#PROD_443} chars, smoke: ${#SMOKE_ALL} chars)"
    exit 1
fi
if [ -z "$PROD_80_HEALTH" ]; then
    note "FAIL: prod :80 server has no '= /api/v1/health' location to mirror"
    exit 1
fi
drift=0
while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    if printf '%s\n' "$SMOKE_ALL" | grep -qFx -- "$rec"; then continue; fi
    note "FAIL: prod 443 location missing or diverged in the smoke conf:"
    note "      $rec"
    drift=1
done <<EOF
$PROD_443
EOF
EXTRAS=$(comm -23 <(printf '%s\n' "$SMOKE_ALL" | LC_ALL=C sort -u) \
                    <(printf '%s\n' "$PROD_443" | LC_ALL=C sort -u))
while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    case $rec in
        '= /api/v1/health|')
            note "FAIL: deploy health location present but EMPTY of routing directives in the smoke conf"
            drift=1 ;;
        "$PROD_80_HEALTH")
            : ;; # the documented extra: mirrors the prod :80 health stanza
        *)
            note "FAIL: smoke conf carries a location the prod 443 server does not have:"
            note "      $rec"
            drift=1 ;;
    esac
done <<EOF
$EXTRAS
EOF
# Presence assert: the deploy health route must EXIST in the smoke conf.
# Without it, deleting the stanza would pass silently — the required-set
# loop above only knows about prod-443 locations, and the extras loop
# above only flags locations that ARE there.
if ! printf '%s\n' "$SMOKE_ALL" | grep -qFx -- "$PROD_80_HEALTH"; then
    note "FAIL: deploy health route '= /api/v1/health' missing or diverged in the smoke conf (must mirror the prod :80 stanza):"
    note "      $PROD_80_HEALTH"
    drift=1
fi
[ "$drift" = 0 ] || exit 1
note "    routing mirrors in sync (443 locations verbatim + health route)"

# --- 2/6 Image builds from the repo-root context -----------------------------
note "2/6 docker build -f deploy/Dockerfile.edge -t $TAG ."
docker build -f deploy/Dockerfile.edge -t "$TAG" .

# --- 3/6 nginx -t: PROD conf with throwaway certs at the contract paths ------
note "3/6 nginx -t (prod conf + self-signed certs at /etc/nginx/certs)"
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

# --- 4/6 nginx -t: SMOKE conf as-is (no TLS, no certs) ------------------------
note "4/6 nginx -t (smoke conf as-is)"
SMOKE_C="memo-edge-verify-smoke"
docker create --name "$SMOKE_C" "$TAG" nginx -t >/dev/null
docker cp "$SMOKE_CONF" "$SMOKE_C:/etc/nginx/conf.d/default.conf"
docker start -a "$SMOKE_C"
docker rm "$SMOKE_C" >/dev/null && SMOKE_C=""

# --- 5/6 Serve check: smoke conf, SPA index over HTTP ------------------------
# /api and /admin have no backends in this one-container check — connection
# refused for them is EXPECTED and not tested; only the static SPA is.
# Probed via `docker exec curl 127.0.0.1:80` inside the container: the local
# daemon does not publish ports onto this shell's network namespace, and
# the image ships curl — so the check needs no host networking at all. Host
# port publishing is compose's concern, not this image's.
note "5/6 serve / (smoke conf, curl inside the container)"
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

note "6/6 all green: drift guard, build, nginx -t x2, SPA serve"
