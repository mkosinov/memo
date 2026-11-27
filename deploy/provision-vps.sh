#!/usr/bin/env bash
# =============================================================================
# deploy/provision-vps.sh — one-shot host provisioning for the production VPS
# (GH #574, spec «Требования»).
# =============================================================================
#
# Run ONCE as root on a brand-new Ubuntu 24.04 VM, right after the IP
# whitelist check (spec «Готовность к белым спискам» — that check is the
# FIRST manual step and happens BEFORE this script). Safe to RE-RUN: every
# block is idempotent, and the script PAUSES (exit 10) when an owner action
# is still missing instead of failing.
#
# Usage:
#   sudo bash provision-vps.sh --user <deploy-user> \
#        [--pubkey <ssh-public-key-file-or-literal>] [--email <le-email>]
#   provision-vps.sh --help
#
# What it prepares (blocks 1–8, each prints the next manual step):
#   1. non-root sudo user + SSH hardening (key-only login, no root, no
#      passwords; validated drop-in + `sshd -t` + reload — lock-out safe)
#   2. ufw: limit 22/tcp, allow 80/443
#   3. 2 GB swapfile + vm.swappiness=10
#   4. Docker CE from the official repo + compose v2 plugin + python3
#   5. certbot from snap (+ stock snap.certbot.renew.timer)
#   6. host paths + ownership:
#        /opt/memo/env      deploy user — render-env.sh renders production.env
#                           over ssh as this user, no sudo (deploy.yml)
#        /opt/memo/deploy   deploy user — the workflow ssh-mkdirs + scp's
#                           deploy.sh / render-env.sh / compose here
#        /opt/memo/data     1001:1001 — backend runtime uid (Dockerfile.backend
#                           `USER memo`); SQLite memo.db + -wal/-shm
#        /opt/memo/media    1001:1001, 0755 — backend writes avatars/ at the
#        /opt/memo/media/public  volume ROOT; edge mounts public/ read-only
#        /opt/memo/certs    root:root — TLS pair (fullchain.pem+privkey.pem),
#        /opt/memo/acme     root:root — ACME webroot; edge mounts both ro
#      These are exactly the paths deploy.sh preflights (its header contract).
#   7. bootstrap certificate: the edge container refuses to start without the
#      TLS pair, so BEFORE the first deploy a temporary `python3 -m http.server
#      80` serves the ACME webroot for a certbot webroot issuance; the pair is
#      copied into /opt/memo/certs. Renewals after the deploy go webroot via
#      the edge ACME location (same host path /opt/memo/acme).
#   8. certbot deploy hook: on renewal re-copies the pair from
#      /etc/letsencrypt/live/colourmountains.ru/ into /opt/memo/certs (a
#      renewal does NOT touch the bind-mounted copy) and reloads edge nginx.
#
# NOT in scope (manual steps, Task 4): VM creation, the three DNS A records,
# GitHub secrets (DEPLOY_SSH_HOST/USER/KEY), the deploy itself.
# /opt/memo/env/production.env is rendered per deploy by deploy/render-env.sh
# from GitHub Secrets — never by this script (the mandatory ENV=production
# value is a literal in deploy.yml's render step).
#
# Exit codes:
#   0   all eight blocks done
#   1   usage error / lock-out guard / block failure
#   2   wrong host: not root, or /etc/os-release ID != ubuntu
#   10  PAUSED — DNS A records for the three names do not resolve yet; do the
#       printed manual step, then RE-RUN this script (not an error)
#   11  port 80 already in use — never fights a running edge/web server
#
# Test seams (defaults are the real VM paths; override ONLY in hermetic tests,
# see deploy/provision-vps.sh.test.sh):
#   PROVISION_ETC_ROOT   default /etc  — root for all /etc writes AND the
#                        os-release read
#   PROVISION_OPT_ROOT   default /opt
#   PROVISION_SWAPFILE   default /swapfile
# =============================================================================

set -euo pipefail

# ── seams (see header) ───────────────────────────────────────────────────────
readonly PROVISION_ETC_ROOT=${PROVISION_ETC_ROOT:-/etc}
readonly PROVISION_OPT_ROOT=${PROVISION_OPT_ROOT:-/opt}
readonly PROVISION_SWAPFILE=${PROVISION_SWAPFILE:-/swapfile}

readonly MEMO_ROOT="$PROVISION_OPT_ROOT/memo"
readonly SUDOERS_DIR="$PROVISION_ETC_ROOT/sudoers.d"
readonly SSHD_DROPIN_DIR="$PROVISION_ETC_ROOT/ssh/sshd_config.d"
readonly SSHD_DROPIN="$SSHD_DROPIN_DIR/00-memo-hardening.conf"
readonly SYSCTL_CONF="$PROVISION_ETC_ROOT/sysctl.d/90-memo-swap.conf"
readonly DOCKER_KEYRING="$PROVISION_ETC_ROOT/apt/keyrings/docker.asc"
readonly DOCKER_SOURCES="$PROVISION_ETC_ROOT/apt/sources.list.d/docker.list"
readonly CERT_NAME='colourmountains.ru'
readonly -a CERT_DOMAINS=(
  colourmountains.ru
  www.colourmountains.ru
  xn--b1acfa3biol7a6ce.xn--p1ai
)
readonly LE_LIVE="$PROVISION_ETC_ROOT/letsencrypt/live/$CERT_NAME"
readonly CERTS_DIR="$MEMO_ROOT/certs"
readonly ACME_DIR="$MEMO_ROOT/acme"
readonly HOOK_PATH="$PROVISION_ETC_ROOT/letsencrypt/renewal-hooks/deploy/memo-edge-reload.sh"

deploy_user=''
pubkey_arg=''
le_email=''
acme_server_pid=''

usage() {
  cat <<'USAGE'
Usage: provision-vps.sh --user <deploy-user> [--pubkey <file-or-literal-key>] [--email <le-email>]
   or:  provision-vps.sh --help
Run as root, on a fresh Ubuntu 24.04 VM — once, then re-runs are safe.

  --user    REQUIRED: non-root sudo user to create; becomes DEPLOY_SSH_USER
            (GitHub secret) — the deploy runs plain `docker` as this user.
  --pubkey  SSH public key: a FILE path or a literal "ssh-ed25519 AAAA..." line.
            Omitted: keys are copied from the invoking user's
            ~/.ssh/authorized_keys (under sudo that is root's home).
            NO usable key anywhere → abort BEFORE touching sshd (lock-out guard).
  --email   Let's Encrypt account e-mail; omitted → register without one.

Exit codes:
  0   all eight blocks done
  1   usage error / lock-out guard / block failure
  2   wrong host: not root, or /etc/os-release ID != ubuntu
  10  PAUSED — DNS A records for the three names do not resolve yet; do the
      printed manual step, then RE-RUN this script (not an error)
  11  port 80 already in use — never fights a running edge/web server

Test seams (defaults are the real VM paths; override ONLY in hermetic tests):
  PROVISION_ETC_ROOT   (default /etc) — root for all /etc writes and the
                       os-release read
  PROVISION_OPT_ROOT   (default /opt)
  PROVISION_SWAPFILE   (default /swapfile)

Blocks (each idempotent, each prints the next manual step):
  1 non-root sudo user + SSH hardening (key-only, no root, no passwords)
  2 ufw: limit 22/tcp, allow 80/443, enable
  3 2 GB swapfile + vm.swappiness=10
  4 Docker CE (official repo) + compose v2 + python3
  5 certbot from snap (+ stock snap.certbot.renew.timer)
  6 /opt/memo/{env,deploy,data,media,media/public,certs,acme} + ownership
  7 bootstrap certificate (temporary :80 webroot server → certbot certonly)
  8 certbot deploy hook: re-copy certs into /opt/memo/certs + reload edge

NOT here (manual steps): VM creation, DNS A records, GitHub secrets, the
deploy itself. /opt/memo/env/production.env is rendered per deploy by
deploy/render-env.sh from GitHub Secrets — never by this script.
USAGE
}

log()       { printf 'provision-vps.sh: %s\n' "$*"; }
next_step() { printf 'provision-vps.sh: NEXT MANUAL STEP: %s\n' "$*"; }
die() { # die <code> <message>
  local code=$1
  shift
  printf 'provision-vps.sh: ERROR: %s\n' "$*" >&2
  exit "$code"
}

parse_args() {
  while [ $# -gt 0 ]; do
    case $1 in
      --user)
        [ $# -ge 2 ] || { printf 'provision-vps.sh: --user requires an argument\n' >&2; usage >&2; exit 1; }
        deploy_user=$2
        shift 2
        ;;
      --pubkey)
        [ $# -ge 2 ] || { printf 'provision-vps.sh: --pubkey requires an argument\n' >&2; usage >&2; exit 1; }
        pubkey_arg=$2
        shift 2
        ;;
      --email)
        [ $# -ge 2 ] || { printf 'provision-vps.sh: --email requires an argument\n' >&2; usage >&2; exit 1; }
        le_email=$2
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        printf 'provision-vps.sh: unknown argument: %s\n' "$1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
  if [ -z "$deploy_user" ]; then
    printf 'provision-vps.sh: --user <name> is required\n' >&2
    usage >&2
    exit 1
  fi
}

preflight() {
  [ "$(id -u)" -eq 0 ] || die 2 "must run as root (sudo bash $0 ...) — refusing to provision"
  # shellcheck disable=SC1091  # host-provided file, deliberately not in repo
  . "$PROVISION_ETC_ROOT/os-release"
  [ "${ID:-}" = ubuntu ] || die 2 "supported host is Ubuntu 24.04 (os-release ID=ubuntu); found ID=${ID:-unset}"
  [ -n "${VERSION_CODENAME:-}" ] || die 1 'VERSION_CODENAME missing from os-release — cannot pin the Docker repo'
}

# Always stop the temporary ACME server, whatever happens (wired via `trap
# ... EXIT` in main before the blocks run).
cleanup_acme_server() {
  if [ -n "$acme_server_pid" ]; then
    kill "$acme_server_pid" 2>/dev/null || true
    wait "$acme_server_pid" 2>/dev/null || true
    acme_server_pid=''
  fi
  return 0
}

# ── block 1: non-root sudo user + SSH hardening ──────────────────────────────
# Lock-out safety is the hard rule: resolve a usable public key BEFORE any
# sshd change; validate sudoers with visudo BEFORE installing it.
resolve_keys() { # $1: --pubkey value ('' → invoking user's authorized_keys)
  local arg=${1:-}
  local raw=''
  if [ -n "$arg" ]; then
    if [ -f "$arg" ]; then
      raw=$(cat -- "$arg" 2>/dev/null || true)
    else
      raw=$arg # literal key line
    fi
  elif [ -f "$HOME/.ssh/authorized_keys" ]; then
    raw=$(cat -- "$HOME/.ssh/authorized_keys" 2>/dev/null || true)
  fi
  local keyre='^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh|ecdsa)-[A-Za-z0-9@.-]+)[[:space:]]+[A-Za-z0-9+/=]+([[:space:]]|$)'
  local line valid=''
  while IFS= read -r line || [ -n "$line" ]; do
    # shellcheck disable=SC2254  # regex is a fixed literal above
    [[ $line =~ $keyre ]] && valid+="$line"$'\n'
  done <<< "$raw"
  printf '%s' "${valid%$'\n'}"
}

install_sudoers() {
  local sudoers="$SUDOERS_DIR/90-$deploy_user"
  local content="$deploy_user ALL=(ALL) NOPASSWD:ALL"
  if [ -f "$sudoers" ] && [ "$(cat -- "$sudoers")" = "$content" ]; then
    log "sudoers entry already present: $sudoers"
    return 0
  fi
  mkdir -p -- "$SUDOERS_DIR"
  local tmp="$SUDOERS_DIR/.90-$deploy_user.provision-tmp.$$"
  printf '%s\n' "$content" | tee -- "$tmp" >/dev/null
  # validate BEFORE installing: one broken sudoers.d file breaks sudo itself
  visudo -cf "$tmp" >/dev/null
  chmod 0440 -- "$tmp"
  mv -f -- "$tmp" "$sudoers"
  log "passwordless sudo installed: $sudoers (0440, visudo-validated — a key-only user has no password)"
}

install_authorized_keys() { # $1 home, $2 keys (newline-separated, no trailing \n)
  local user_home=$1
  local keys=$2
  local ak="$user_home/.ssh/authorized_keys"
  if [ -f "$ak" ] && [ "$(cat -- "$ak")" = "$keys" ]; then
    log 'authorized_keys already up to date'
    return 0
  fi
  mkdir -p -- "$user_home/.ssh"
  chmod 0700 -- "$user_home/.ssh"
  printf '%s\n' "$keys" | tee -- "$ak" >/dev/null
  chmod 0600 -- "$ak"
  chown -R "$deploy_user:$deploy_user" -- "$user_home/.ssh"
  log "authorized_keys installed for $deploy_user ($(printf '%s\n' "$keys" | grep -c .) key(s))"
}

install_sshd_hardening() {
  local content='PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
KbdInteractiveAuthentication no'
  if [ -f "$SSHD_DROPIN" ] && [ "$(cat -- "$SSHD_DROPIN")" = "$content" ]; then
    log 'sshd hardening drop-in already present'
    return 0
  fi
  mkdir -p -- "$SSHD_DROPIN_DIR"
  # The 00- prefix must sort before cloud-init's 50- drop-in: sshd uses
  # FIRST-value-wins, and the main sshd_config Includes sshd_config.d/*.conf.
  printf '%s\n' "$content" | tee -- "$SSHD_DROPIN" >/dev/null
  sshd -t
  systemctl reload ssh
  log "sshd hardened: $SSHD_DROPIN (key-only, no root, no passwords) — sshd -t ok, ssh reloaded"
}

block1_user_ssh() {
  log '[1/8] non-root sudo user + SSH hardening'
  local keys
  keys=$(resolve_keys "$pubkey_arg")
  if [ -z "$keys" ]; then
    die 1 "no usable SSH public key found (--pubkey file/literal, or the invoking user's ~/.ssh/authorized_keys) — refusing to touch sshd: key-only login would lock everyone out"
  fi
  if ! id -u "$deploy_user" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$deploy_user"
    log "user created: $deploy_user"
  fi
  if ! id -nG "$deploy_user" 2>/dev/null | grep -qw sudo; then
    usermod -aG sudo "$deploy_user"
    log "added $deploy_user to the sudo group"
  fi
  local user_home
  user_home=$(getent passwd "$deploy_user" | cut -d: -f6)
  install_sudoers
  install_authorized_keys "$user_home" "$keys"
  install_sshd_hardening
  next_step "open a SECOND ssh session as '$deploy_user' (ssh $deploy_user@<vm-ip>), confirm key login and 'sudo -n true' — only then close this root session"
}

# ── block 2: ufw ─────────────────────────────────────────────────────────────
block2_ufw() {
  log '[2/8] firewall: ufw limit 22/tcp, allow 80/443'
  if ! command -v ufw >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ufw
    log 'ufw installed'
  fi
  ufw limit 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  log 'ufw active: 22/tcp rate-limited (ssh brute-force guard), 80+443 open for edge'
  next_step 'no manual step — review any time with: ufw status verbose'
}

# ── block 3: swap ────────────────────────────────────────────────────────────
block3_swap() {
  log '[3/8] swap: 2 GB swapfile + vm.swappiness=10'
  if swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
    log 'swap already active — skipping swapfile creation'
  else
    if ! fallocate -l 2G "$PROVISION_SWAPFILE" 2>/dev/null; then
      log 'fallocate failed (filesystem without extent support?) — falling back to dd'
      dd if=/dev/zero of="$PROVISION_SWAPFILE" bs=1M count=2048 status=none
    fi
    chmod 600 -- "$PROVISION_SWAPFILE"
    mkswap "$PROVISION_SWAPFILE" >/dev/null
    swapon "$PROVISION_SWAPFILE"
    log "swapfile active: $PROVISION_SWAPFILE (2G)"
  fi
  if ! grep -qF -- "$PROVISION_SWAPFILE " "$PROVISION_ETC_ROOT/fstab" 2>/dev/null; then
    printf '%s none swap sw 0 0\n' "$PROVISION_SWAPFILE" | tee -a -- "$PROVISION_ETC_ROOT/fstab" >/dev/null
    log 'fstab entry added (swap survives reboot)'
  else
    log 'fstab entry already present'
  fi
  if [ -f "$SYSCTL_CONF" ] && [ "$(cat -- "$SYSCTL_CONF")" = 'vm.swappiness=10' ]; then
    log 'vm.swappiness already 10'
  else
    mkdir -p -- "$PROVISION_ETC_ROOT/sysctl.d"
    printf 'vm.swappiness=10\n' | tee -- "$SYSCTL_CONF" >/dev/null
    sysctl --system >/dev/null
    log 'vm.swappiness=10 applied (sysctl.d/90-memo-swap.conf + sysctl --system)'
  fi
  next_step 'no manual step — verify any time with: swapon --show; cat /proc/sys/vm/swappiness'
}

# ── block 4: Docker CE + compose v2 + python3 ────────────────────────────────
block4_docker_python() {
  log '[4/8] Docker CE (official repo) + compose v2 + python3'
  if command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1; then
    log 'docker already present — skipping repository setup and install'
  else
    if [ ! -f "$DOCKER_KEYRING" ] || [ ! -f "$DOCKER_SOURCES" ]; then
      apt-get update
      apt-get install -y ca-certificates curl
      # 0755 on the leaf dir (keyrings) only; parents keep the umask default —
      # same deliberate choice as deploy/render-env.sh for the env dir.
      # shellcheck disable=SC2174
      mkdir -p -m 0755 -- "$PROVISION_ETC_ROOT/apt/keyrings"
      mkdir -p -- "$PROVISION_ETC_ROOT/apt/sources.list.d"
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$DOCKER_KEYRING"
      chmod a+r -- "$DOCKER_KEYRING"
      printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/ubuntu %s stable\n' \
        "$(dpkg --print-architecture)" "$DOCKER_KEYRING" "$VERSION_CODENAME" \
        | tee -- "$DOCKER_SOURCES" >/dev/null
      log 'official Docker apt repository configured (keyring + signed-by sources entry)'
    fi
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    log 'docker-ce + compose v2 plugin installed from download.docker.com'
  fi
  # docker-group membership is root-equivalent — acceptable for this
  # single-purpose VM: the deploy must run plain `docker` over ssh (GH #616).
  if ! id -nG "$deploy_user" 2>/dev/null | grep -qw docker; then
    usermod -aG docker "$deploy_user"
    log "added $deploy_user to the docker group (plain docker, no sudo — applies at next login)"
  else
    log "$deploy_user is already in the docker group"
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    apt-get install -y python3
    log 'python3 installed (the deploy.sh health probe needs it)'
  fi
  docker --version
  docker compose version
  python3 --version
  next_step 'no manual step — docker works without sudo for the deploy user from its NEXT ssh session'
}

# ── block 5: certbot from snap ───────────────────────────────────────────────
block5_certbot_snap() {
  log '[5/8] certbot from snap (+ stock renew timer)'
  if ! command -v snap >/dev/null 2>&1; then
    apt-get update
    apt-get install -y snapd
  fi
  systemctl enable --now snapd.service
  # a fresh VM's snapd answers "too early for operation, device not yet seeded"
  snap wait system seed.loaded
  if snap list certbot >/dev/null 2>&1; then
    log 'certbot snap already installed'
  else
    snap install core
    snap refresh core
    snap install --classic certbot
    log 'certbot installed from snap --classic (the apt certbot 2.9.0 is too old)'
  fi
  ln -sf /snap/bin/certbot /usr/local/bin/certbot
  certbot --version
  log 'stock renewal timer status (snap.certbot.renew.timer):'
  systemctl is-enabled snap.certbot.renew.timer || true
  systemctl is-active snap.certbot.renew.timer || true
  next_step 'no manual step — renewals run via the stock snap.certbot.renew.timer; the deploy hook (block 8) reloads edge'
}

# ── block 6: host paths + ownership ──────────────────────────────────────────
block6_host_paths() {
  log '[6/8] host paths under /opt/memo + ownership'
  mkdir -p -- "$MEMO_ROOT" "$MEMO_ROOT/env" "$MEMO_ROOT/deploy" "$MEMO_ROOT/data" \
    "$MEMO_ROOT/media" "$MEMO_ROOT/media/public" "$CERTS_DIR" "$ACME_DIR"
  # Ownership rule: a path WRITTEN by the deploy user over ssh is owned by
  # that user; a path written by a container is owned by the container's
  # runtime uid (verified against render-env.sh, .github/workflows/deploy.yml,
  # docker-compose.prod.yml and Dockerfile.backend).
  chown "$deploy_user:$deploy_user" -- "$MEMO_ROOT/env" "$MEMO_ROOT/deploy"
  chown 1001:1001 -- "$MEMO_ROOT/data" "$MEMO_ROOT/media" "$MEMO_ROOT/media/public"
  chmod 0755 -- "$MEMO_ROOT/media" "$MEMO_ROOT/media/public"
  chown root:root -- "$CERTS_DIR" "$ACME_DIR"
  log 'paths ready: env+deploy → deploy user; data+media(+public) → 1001:1001 (0755); certs+acme → root'
  next_step 'no manual step — every deploy scp renders env/ and fills deploy/ as this user (workflow steps: scp, render prod env)'
}

# ── block 7: bootstrap certificate ───────────────────────────────────────────
copy_cert() { # $1 src, $2 dst, $3 mode — dereference live/ symlinks; temp file
              # in the SAME dir + atomic mv: nginx never sees a half-written cert
  local src=$1
  local dst=$2
  local mode=$3
  local tmp
  tmp="$CERTS_DIR/.$(basename -- "$dst").new.$$"
  cp -L -- "$src" "$tmp"
  chmod "$mode" -- "$tmp"
  mv -f -- "$tmp" "$dst"
}

ensure_cert_copies() {
  # only-copy-never-reissue: a certbot renewal does NOT touch this
  # bind-mounted copy — keeping it fresh is the deploy hook's job (block 8)
  [ -f "$CERTS_DIR/fullchain.pem" ] || copy_cert "$LE_LIVE/fullchain.pem" "$CERTS_DIR/fullchain.pem" 0644
  [ -f "$CERTS_DIR/privkey.pem" ] || copy_cert "$LE_LIVE/privkey.pem" "$CERTS_DIR/privkey.pem" 0600
}

block7_bootstrap_cert() {
  log '[7/8] bootstrap TLS certificate (SAN: 3 names) via webroot on a temporary :80 server'
  if [ -f "$LE_LIVE/fullchain.pem" ]; then
    ensure_cert_copies
    log "certificate already issued — host copies verified in $CERTS_DIR"
    next_step 'deploy the stack next (GitHub release workflow / ./deploy.sh) — renewals then flow through the edge ACME location'
    return 0
  fi
  # The plan creates the three DNS A records AFTER this script's first run:
  # an HTTP-01 challenge cannot succeed before they resolve. Pause (10).
  local name
  for name in "${CERT_DOMAINS[@]}"; do
    if ! getent ahostsv4 "$name" >/dev/null 2>&1; then
      next_step "create the three A records (@, www, xn--b1acfa3biol7a6ce.xn--p1ai → this VM's public IP) in the Yandex DNS panel, wait for propagation, then RE-RUN this script (exit 10 = paused, not an error)"
      exit 10
    fi
  done
  log 'DNS check ok: all three names resolve'
  if ss -ltn 2>/dev/null | grep -qE '[:.]80[[:space:]]'; then
    die 11 'port 80 is already in use (is an edge/web server already running?) — refusing to fight it; stop it first'
  fi
  log 'starting temporary ACME webroot server (python3 -m http.server 80)'
  python3 -m http.server 80 --directory "$ACME_DIR" --bind 0.0.0.0 >/dev/null 2>&1 &
  acme_server_pid=$!
  local ready=0
  for _ in {1..20}; do
    if ss -ltn 2>/dev/null | grep -qE '[:.]80[[:space:]]'; then ready=1; break; fi
    sleep 0.25
  done
  [ "$ready" -eq 1 ] || die 1 'temporary ACME webroot server never started listening on :80'
  local email_args=(--register-unsafely-without-email)
  if [ -n "$le_email" ]; then
    email_args=(-m "$le_email")
  fi
  certbot certonly --non-interactive --webroot -w "$ACME_DIR" \
    -d colourmountains.ru -d www.colourmountains.ru -d xn--b1acfa3biol7a6ce.xn--p1ai \
    --agree-tos "${email_args[@]}"
  cleanup_acme_server
  log 'temporary server stopped; certificate issued'
  ensure_cert_copies
  log "bootstrap pair copied to $CERTS_DIR (fullchain.pem 0644, privkey.pem 0600)"
  next_step 'deploy the stack next: fill GitHub Secrets (DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_KEY) and run the release workflow — deploy.sh preflights exactly these paths'
}

# ── block 8: certbot deploy hook ─────────────────────────────────────────────
block8_deploy_hook() {
  log '[8/8] certbot deploy hook: refresh /opt/memo/certs + reload edge nginx'
  local content
  content=$(cat <<'HOOK'
#!/usr/bin/env bash
# certbot deploy hook — provisioned by deploy/provision-vps.sh (GH #574).
# A renewal writes new files under /etc/letsencrypt/archive/ and re-points
# the live/ symlinks; the bind-mounted copy in /opt/memo/certs is NOT touched
# by certbot itself. So this hook FIRST re-copies the pair (dereferences the
# live/ symlinks, temp file + atomic mv — nginx never sees a half-written
# cert) and THEN validates and reloads edge nginx. Renewals run webroot via
# the edge ACME location after the first deploy.
set -euo pipefail

copy_pair() {
  # $1 src, $2 dst, $3 mode — atomic replace in the destination directory
  tmp="$(dirname "$2")/.$(basename "$2").new.$$"
  cp -L "$1" "$tmp"
  chmod "$3" "$tmp"
  mv -f "$tmp" "$2"
}
trap 'rm -f /opt/memo/certs/.fullchain.pem.new.* /opt/memo/certs/.privkey.pem.new.*' EXIT

copy_pair /etc/letsencrypt/live/colourmountains.ru/fullchain.pem /opt/memo/certs/fullchain.pem 0644
copy_pair /etc/letsencrypt/live/colourmountains.ru/privkey.pem /opt/memo/certs/privkey.pem 0600

docker exec edge nginx -t && docker exec edge nginx -s reload
HOOK
)
  if [ -f "$HOOK_PATH" ] && [ "$(cat -- "$HOOK_PATH")" = "$content" ]; then
    log 'deploy hook already up to date'
  else
    mkdir -p -- "$(dirname -- "$HOOK_PATH")"
    printf '%s\n' "$content" | tee -- "$HOOK_PATH" >/dev/null
    chmod 0755 -- "$HOOK_PATH"
    log "deploy hook installed (0755): $HOOK_PATH"
  fi
  next_step 'after the FIRST deploy, verify renewal + reload end-to-end: certbot renew --dry-run --run-deploy-hooks'
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  preflight
  trap cleanup_acme_server EXIT
  log "provisioning start: user=$deploy_user (etc=$PROVISION_ETC_ROOT opt=$PROVISION_OPT_ROOT swap=$PROVISION_SWAPFILE)"
  block1_user_ssh
  block2_ufw
  block3_swap
  block4_docker_python
  block5_certbot_snap
  block6_host_paths
  block7_bootstrap_cert
  block8_deploy_hook
  log 'provisioning COMPLETE — next: the Task 4 manual steps (GitHub secrets DEPLOY_SSH_HOST/USER/KEY, then the release deploy)'
}
main "$@"
