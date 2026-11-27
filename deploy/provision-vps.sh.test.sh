#!/usr/bin/env bash
# =============================================================================
# Hermetic dry-run test for deploy/provision-vps.sh (GH #574).
# =============================================================================
# provision-vps.sh targets a REAL Ubuntu VM as root (useradd, sshd, ufw, swap,
# apt, snap, certbot); here EVERY system command the script invokes is a PATH
# shim that journals its mutations and keeps state in a per-scenario state
# dir, and every filesystem write lands under per-scenario seam roots:
#     PROVISION_ETC_ROOT / PROVISION_OPT_ROOT / PROVISION_SWAPFILE
# so the suite runs as ANY user, needs no network / docker / sudo, and writes
# nothing outside its own mktemp dir (removed by a trap).
#
# Covered (plan assertions T1–T10):
#   T1  first run: exit 0; block + command order (useradd → sshd drop-in →
#       sshd -t → reload; mkswap → swapon; http.server start → certbot
#       certonly → server stop; docker-ce install; usermod -aG docker;
#       snap install --classic certbot)
#   T2  second run on the same state: exit 0, NO mutating command re-executed
#   T3  ≥ 8 "NEXT MANUAL STEP" lines on the first run
#   T4  lock-out guard: no key source → non-zero exit, sshd untouched
#   T5  DNS gate: getent fails → exit EXACTLY 10, no certbot certonly, the
#       manual step names the three A records
#   T6  port 80 occupied → non-zero exit, no certbot certonly
#   T7  usage: missing --user / unknown option / --help
#   T8  deploy hook: mode 0755, re-copies BOTH files from live/, contains the
#       exact docker exec reload command, not rewritten on run 2
#   T9  cert copies: REGULAR files (live/ symlinks dereferenced), key 0600
#   T10 host paths: 8 dirs; chown 1001:1001 data; deploy-user chown env+deploy
#
# Shims journal MUTATIONS only: read-only probes (id, getent, ss,
# `swapon --show`, `snap list`, `docker --version`, `certbot --version`,
# is-enabled/is-active) read the state dir and stay out of the journal, so
# T2's "nothing re-executed" is precise. Positive controls (ufw/ln lines ARE
# re-journaled on run 2) guard against a false pass from a crashed script.
#
# Run: bash deploy/provision-vps.sh.test.sh
# =============================================================================

set -euo pipefail

SRC_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST=$SRC_DIR/provision-vps.sh
WORK=$(mktemp -d /tmp/memo-provision-dryrun.XXXXXX)

pass=0 fail=0
ok()  { printf '  ok  %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s\n' "$1" >&2; fail=$((fail + 1)); }

cleanup() {
  # PROVISION_TEST_KEEP=1 keeps the workdir for debugging (must be removed
  # manually; it contains only stub state).
  if [ "${PROVISION_TEST_KEEP:-0}" = 1 ]; then
    printf 'kept workdir for debugging: %s\n' "$WORK" >&2
    return 0
  fi
  local pidf
  for pidf in "$WORK"/scen-*/state/http_server_pid; do
    [ -f "$pidf" ] || continue
    kill "$(cat "$pidf")" 2>/dev/null || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── PATH shims (installed once; state per scenario via STUB_STATE) ───────────
BIN=$WORK/bin
mkdir -p "$BIN"

# id: `id -u` → root; `id -u NAME` / `id -nG NAME` → state-driven
cat > "$BIN/id" <<'EOF'
S=${STUB_STATE:?}
case "${1:-}" in
  -u) if [ $# -eq 1 ]; then printf '0\n'; exit 0; fi
      if [ -f "$S/users/${2:-}" ]; then printf '1000\n'; exit 0; fi
      exit 1 ;;
  -nG) n=${2:-}
       [ -f "$S/users/$n" ] || exit 1
       g="$n"
       [ -f "$S/user_groups_$n" ] && g="$g $(tr '\n' ' ' < "$S/user_groups_$n")"
       printf '%s\n' "$g"
       exit 0 ;;
  *) if [ -f "$S/users/${2:-$1}" ]; then exit 0; fi
     exit 2 ;;
esac
EOF

# getent: DNS ahostsv4 + passwd (home under STUB_HOME_ROOT → inside seams)
cat > "$BIN/getent" <<'EOF'
S=${STUB_STATE:?}
case "${1:-}" in
  ahostsv4) if [ -f "$S/dns_ok" ]; then
              printf '203.0.113.10     STREAM %s\n' "$2"
              printf '203.0.113.10     pkt4    %s\n' "$2"
              exit 0
            fi
            exit 2 ;;
  passwd)   if [ -f "$S/users/$2" ]; then
              printf '%s:x:1000:1000::%s/%s:/bin/bash\n' "$2" "${STUB_HOME_ROOT:?}" "$2"
              exit 0
            fi
            exit 2 ;;
esac
exit 2
EOF

# useradd / usermod: journal + state
cat > "$BIN/useradd" <<'EOF'
J=${JOURNAL:?}; S=${STUB_STATE:?}
printf '%s\n' "useradd $*" >> "$J"
mkdir -p "$S/users"
n=${@: -1}
: > "$S/users/$n"
exit 0
EOF
cat > "$BIN/usermod" <<'EOF'
J=${JOURNAL:?}; S=${STUB_STATE:?}
printf '%s\n' "usermod $*" >> "$J"
u=${@: -1}
printf '%s\n' "$2" >> "$S/user_groups_$u"
exit 0
EOF

# visudo / sshd / ufw / sysctl / chown / ln: journal-only
for shim in visudo sshd ufw sysctl chown ln; do
cat > "$BIN/$shim" <<EOF
J=\${JOURNAL:?}
printf '%s\n' "$shim \$*" >> "\$J"
exit 0
EOF
done

# systemctl: journal mutations; is-enabled/is-active answer like a healthy host
cat > "$BIN/systemctl" <<'EOF'
J=${JOURNAL:?}
case "${1:-}" in
  is-enabled) printf 'enabled\n' ;;
  is-active)  printf 'active\n' ;;
  *)          printf '%s\n' "systemctl $*" >> "$J" ;;
esac
exit 0
EOF

# apt-get: journal; installing docker-ce flips the "docker present" state
cat > "$BIN/apt-get" <<'EOF'
J=${JOURNAL:?}; S=${STUB_STATE:?}
printf '%s\n' "apt-get $*" >> "$J"
case " $* " in
  *" install "*docker-ce*) : > "$S/docker_installed" ;;
esac
exit 0
EOF

cat > "$BIN/dpkg" <<'EOF'
[ "${1:-}" = --print-architecture ] && { printf 'amd64\n'; exit 0; }
exit 0
EOF

# curl: journal + write the requested -o target (keyring fetch simulation)
cat > "$BIN/curl" <<'EOF'
J=${JOURNAL:?}
printf '%s\n' "curl $*" >> "$J"
out=
while [ $# -gt 0 ]; do
  if [ "$1" = -o ] && [ $# -ge 2 ]; then out=$2; break; fi
  shift
done
if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  printf 'STUB-DOCKER-REPO-KEY\n' > "$out"
fi
exit 0
EOF

# docker: --version / compose version fail until apt-get installed docker-ce
cat > "$BIN/docker" <<'EOF'
S=${STUB_STATE:?}
if [ "${1:-}" = --version ]; then
  if [ -f "$S/docker_installed" ]; then printf 'Docker version 27.3.1, build stub\n'; exit 0; fi
  exit 1
fi
if [ "${1:-}" = compose ] && [ "${2:-}" = version ]; then
  if [ -f "$S/docker_installed" ]; then printf 'Docker Compose version v2.29.1\n'; exit 0; fi
  exit 1
fi
exit 0
EOF

# snap: list is state-driven; install/refresh journal (+ certbot marker)
cat > "$BIN/snap" <<'EOF'
S=${STUB_STATE:?}; J=${JOURNAL:?}
case "${1:-}" in
  list) if [ "${2:-}" = certbot ] && [ -f "$S/snap_certbot" ]; then
          printf 'certbot  2.11.0-1  latest/stable  canonical  classic\n'
          exit 0
        fi
        exit 1 ;;
  wait) exit 0 ;;
  install|refresh)
        printf '%s\n' "snap $*" >> "$J"
        case " $* " in *" certbot "*) : > "$S/snap_certbot" ;; esac
        exit 0 ;;
esac
exit 0
EOF

# certbot: --version; certonly creates archive files + live/ symlinks (like LE)
cat > "$BIN/certbot" <<'EOF'
S=${STUB_STATE:?}; J=${JOURNAL:?}
case "${1:-}" in
  --version) printf 'certbot 2.11.0\n'; exit 0 ;;
  certonly)
    printf '%s\n' "certbot $*" >> "$J"
    E=${PROVISION_ETC_ROOT:?}
    mkdir -p "$E/letsencrypt/archive/colourmountains.ru" "$E/letsencrypt/live/colourmountains.ru"
    printf 'ARCHIVE-FULLCHAIN-1\n' > "$E/letsencrypt/archive/colourmountains.ru/fullchain1.pem"
    printf 'ARCHIVE-CHAIN-1\n'    > "$E/letsencrypt/archive/colourmountains.ru/chain1.pem"
    printf 'ARCHIVE-PRIVKEY-1\n'  > "$E/letsencrypt/archive/colourmountains.ru/privkey1.pem"
    # real certbot symlinks live/<name>/X.pem -> ../../archive/<name>/X<N>.pem
    command -p ln -sfn ../../archive/colourmountains.ru/fullchain1.pem "$E/letsencrypt/live/colourmountains.ru/fullchain.pem"
    command -p ln -sfn ../../archive/colourmountains.ru/chain1.pem    "$E/letsencrypt/live/colourmountains.ru/chain.pem"
    command -p ln -sfn ../../archive/colourmountains.ru/privkey1.pem  "$E/letsencrypt/live/colourmountains.ru/privkey.pem"
    : > "$S/certbot_issued"
    exit 0 ;;
esac
exit 0
EOF

# python3: --version; http.server journals the start, flips ss state to
# "listening on :80", stays alive until killed — then journals the stop
cat > "$BIN/python3" <<'EOF'
S=${STUB_STATE:?}; J=${JOURNAL:?}
if [ "${1:-}" = --version ]; then printf 'Python 3.12.3\n'; exit 0; fi
if [ "${1:-}" = -m ] && [ "${2:-}" = http.server ]; then
  printf '%s\n' "python3 $*" >> "$J"
  printf 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*\n' >> "$S/ss_ltn"
  printf '%s\n' "$$" > "$S/http_server_pid"
  trap 'rm -f "$S/ss_ltn"; printf "%s\n" "python3 http.server stopped" >> "$J"; exit 0' TERM INT
  # sleep in background + wait: a TERM during a FOREGROUND sleep would only
  # run the trap after sleep finishes (hours); `wait` is interruptible.
  while :; do command -p sleep 3600 & wait $!; done
fi
exit 0
EOF

# ss: read-only, state-driven listener table
cat > "$BIN/ss" <<'EOF'
S=${STUB_STATE:?}
[ -f "$S/ss_ltn" ] && command -p cat "$S/ss_ltn"
exit 0
EOF

# swapon: --show is a state-driven read (not journaled); activation journals
cat > "$BIN/swapon" <<'EOF'
S=${STUB_STATE:?}; J=${JOURNAL:?}
case "${1:-}" in
  --show*) [ -f "$S/swapon" ] && command -p cat "$S/swapon"; exit 0 ;;
esac
printf '%s\n' "swapon $*" >> "$J"
printf '%s\n' "${@: -1}" > "$S/swapon"
exit 0
EOF

cat > "$BIN/mkswap" <<'EOF'
J=${JOURNAL:?}
printf '%s\n' "mkswap $*" >> "$J"
exit 0
EOF

cat > "$BIN/fallocate" <<'EOF'
J=${JOURNAL:?}
printf '%s\n' "fallocate $*" >> "$J"
: > "${@: -1}"
exit 0
EOF

cat > "$BIN/dd" <<'EOF'
J=${JOURNAL:?}
printf '%s\n' "dd $*" >> "$J"
for a in "$@"; do
  case $a in of=*) : > "${a#of=}" ;; esac
done
exit 0
EOF

# tee: journal + hand through to the REAL tee (writes stay under seam roots)
cat > "$BIN/tee" <<'EOF'
J=${JOURNAL:?}
printf '%s\n' "tee $*" >> "$J"
command -p tee "$@"
EOF

chmod +x "$BIN"/*

# ── scenario runner ──────────────────────────────────────────────────────────
SCEN=
SCEN_DIR=
JOURNAL=
OUT=
RC=0

new_scenario() {
  SCEN=$1
  SCEN_DIR=$WORK/scen-$SCEN
  mkdir -p "$SCEN_DIR/state" "$SCEN_DIR/etc" "$SCEN_DIR/opt" "$SCEN_DIR/home" "$SCEN_DIR/home_root"
  printf 'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\nNAME="Ubuntu"\n' > "$SCEN_DIR/etc/os-release"
  JOURNAL=$SCEN_DIR/state/journal.log
  : > "$JOURNAL"
  OUT=$SCEN_DIR/out.log
  : > "$OUT"
  RC=0
}

run_provision() {
  set +e
  env PATH="$BIN:$PATH" \
      HOME="$SCEN_DIR/home" \
      JOURNAL="$JOURNAL" \
      STUB_STATE="$SCEN_DIR/state" \
      STUB_HOME_ROOT="$SCEN_DIR/home_root" \
      PROVISION_ETC_ROOT="$SCEN_DIR/etc" \
      PROVISION_OPT_ROOT="$SCEN_DIR/opt" \
      PROVISION_SWAPFILE="$SCEN_DIR/swapfile" \
      bash "$UNDER_TEST" "$@" >"$OUT" 2>&1
  RC=$?
  set -e
}

# ── assertion helpers ────────────────────────────────────────────────────────
check()     { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
check_not() { local d=$1; shift; if "$@"; then bad "$d"; else ok "$d"; fi; }
jhas()      { grep -Eq "$1" "$JOURNAL"; }
jhasnt()    { ! grep -Eq "$1" "$JOURNAL"; }
jline()     { grep -nE "$1" "$JOURNAL" | head -1 | cut -d: -f1; }
outline()   { grep -nE "$1" "$OUT" | head -1 | cut -d: -f1; }
obefore()   { local a b; a=$(outline "$1"); b=$(outline "$2"); [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; }
jbefore()   { local a b; a=$(jline "$1"); b=$(jline "$2"); [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; }
mode_is()   { [ "$(stat -c %a "$1")" = "$2" ]; }
file_has()  { grep -qF -- "$2" "$1"; }
steps_ge()  { local n; n=$(grep -c 'NEXT MANUAL STEP' "$OUT" || true); [ "${n:-0}" -ge "$1" ]; }

KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStubKeyMaterialForDryRunOnly owner@host'

# =============================================================================
# Scenario A — happy path: run 1 (T1, T3, T8 content, T9, T10), then run 2
# on the SAME state with a truncated journal (T2 + T8 no-rewrite).
# =============================================================================
new_scenario A
printf '# a comment line the resolver must skip\n%s\n' "$KEY" > "$SCEN_DIR/pubkey.txt"
mkdir -p "$SCEN_DIR/home/.ssh"
printf '%s\n' "$KEY" > "$SCEN_DIR/home/.ssh/authorized_keys"
printf 'dns ok\n' > "$SCEN_DIR/state/dns_ok"

run_provision --user deploy --pubkey "$SCEN_DIR/pubkey.txt"

check 'T1: first run exits 0'                    test "$RC" -eq 0
check 'T1: blocks [1/8] before [2/8]'            obefore '\[1/8\]' '\[2/8\]'
check 'T1: [2/8] before [3/8]'                   obefore '\[2/8\]' '\[3/8\]'
check 'T1: [3/8] before [4/8]'                   obefore '\[3/8\]' '\[4/8\]'
check 'T1: [4/8] before [5/8]'                   obefore '\[4/8\]' '\[5/8\]'
check 'T1: [5/8] before [6/8]'                   obefore '\[5/8\]' '\[6/8\]'
check 'T1: [6/8] before [7/8]'                   obefore '\[6/8\]' '\[7/8\]'
check 'T1: [7/8] before [8/8]'                   obefore '\[7/8\]' '\[8/8\]'
check 'T1: useradd ran'                          jhas '^useradd -m -s /bin/bash deploy'
check 'T1: useradd before sshd drop-in write'    jbefore '^useradd ' 'tee .*00-memo-hardening'
check 'T1: drop-in write before sshd -t'         jbefore 'tee .*00-memo-hardening' '^sshd -t'
check 'T1: sshd -t before ssh reload'            jbefore '^sshd -t' '^systemctl reload ssh'
check 'T1: ufw limit 22/tcp'                     jhas '^ufw limit 22/tcp'
check 'T1: ufw allow 80/tcp'                     jhas '^ufw allow 80/tcp'
check 'T1: ufw allow 443/tcp'                    jhas '^ufw allow 443/tcp'
check 'T1: ufw enabled'                          jhas '^ufw --force enable'
check 'T1: mkswap before swapon'                 jbefore '^mkswap ' '^swapon /'
check 'T1: fallocate created the swapfile'       jhas '^fallocate -l 2G'
check 'T1: fstab got the swap line'              file_has "$SCEN_DIR/etc/fstab" "$SCEN_DIR/swapfile"
check 'T1: swappiness conf written'              file_has "$SCEN_DIR/etc/sysctl.d/90-memo-swap.conf" 'vm.swappiness=10'
check 'T1: docker sources carry signed-by'       file_has "$SCEN_DIR/etc/apt/sources.list.d/docker.list" 'signed-by='
check 'T1: sources pinned to noble'              file_has "$SCEN_DIR/etc/apt/sources.list.d/docker.list" 'download.docker.com/linux/ubuntu noble'
check 'T1: docker keyring fetched'               test -f "$SCEN_DIR/etc/apt/keyrings/docker.asc"
check 'T1: apt-get install docker-ce + compose plugin' \
  jhas '^apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
check 'T1: usermod -aG docker deploy'            jhas '^usermod -aG docker deploy'
check 'T1: sudo group membership added'          jhas '^usermod -aG sudo deploy'
check 'T1: snap install --classic certbot'       jhas '^snap install --classic certbot'
check 'T1: http.server start before certbot'     jbefore 'python3 -m http.server 80' '^certbot certonly'
check 'T1: certonly webroot + all three -d names (IDN punycode)' \
  jhas '^certbot certonly .*--webroot -w .* -d colourmountains\.ru -d www\.colourmountains\.ru -d xn--b1acfa3biol7a6ce\.xn--p1ai'
check 'T1: temp server stopped after certbot'    jbefore '^certbot certonly' 'python3 http.server stopped'

check 'T3: at least 8 NEXT MANUAL STEP lines on run 1' steps_ge 8

check 'T10: /opt/memo exists'                    test -d "$SCEN_DIR/opt/memo"
check 'T10: env dir'                             test -d "$SCEN_DIR/opt/memo/env"
check 'T10: deploy dir'                          test -d "$SCEN_DIR/opt/memo/deploy"
check 'T10: data dir'                            test -d "$SCEN_DIR/opt/memo/data"
check 'T10: media dir'                           test -d "$SCEN_DIR/opt/memo/media"
check 'T10: media/public dir'                    test -d "$SCEN_DIR/opt/memo/media/public"
check 'T10: certs dir'                           test -d "$SCEN_DIR/opt/memo/certs"
check 'T10: acme dir'                            test -d "$SCEN_DIR/opt/memo/acme"
check 'T10: chown 1001:1001 journaled for data'  jhas 'chown 1001:1001 .*memo/data'
check 'T10: deploy-user chown journaled for env' jhas 'chown deploy:deploy .*memo/env'
check 'T10: deploy-user chown for deploy dir'    jhas 'chown deploy:deploy .*memo/deploy'

check 'T9: certs/fullchain.pem regular, not a symlink' test -f "$SCEN_DIR/opt/memo/certs/fullchain.pem" -a ! -L "$SCEN_DIR/opt/memo/certs/fullchain.pem"
check 'T9: certs/privkey.pem regular, not a symlink'   test -f "$SCEN_DIR/opt/memo/certs/privkey.pem" -a ! -L "$SCEN_DIR/opt/memo/certs/privkey.pem"
check 'T9: fullchain holds the ARCHIVE content'        file_has "$SCEN_DIR/opt/memo/certs/fullchain.pem" 'ARCHIVE-FULLCHAIN-1'
check 'T9: privkey holds the ARCHIVE content'          file_has "$SCEN_DIR/opt/memo/certs/privkey.pem" 'ARCHIVE-PRIVKEY-1'
check 'T9: privkey.pem mode 0600'                      mode_is "$SCEN_DIR/opt/memo/certs/privkey.pem" 600

HOOK=$SCEN_DIR/etc/letsencrypt/renewal-hooks/deploy/memo-edge-reload.sh
check 'T8: hook exists'                          test -f "$HOOK"
check 'T8: hook mode 0755'                       mode_is "$HOOK" 755
check 'T8: hook copies live fullchain.pem'       file_has "$HOOK" '/etc/letsencrypt/live/colourmountains.ru/fullchain.pem'
check 'T8: hook copies live privkey.pem'         file_has "$HOOK" '/etc/letsencrypt/live/colourmountains.ru/privkey.pem'
check 'T8: hook contains the exact reload cmd'   file_has "$HOOK" 'docker exec edge nginx -t && docker exec edge nginx -s reload'
check '(extra) sudoers 90-deploy mode 0440'      mode_is "$SCEN_DIR/etc/sudoers.d/90-deploy" 440
check '(extra) sudoers grants NOPASSWD'          file_has "$SCEN_DIR/etc/sudoers.d/90-deploy" 'deploy ALL=(ALL) NOPASSWD:ALL'
check '(extra) authorized_keys installed'        file_has "$SCEN_DIR/home_root/deploy/.ssh/authorized_keys" "$KEY"
check '(extra) authorized_keys mode 0600'        mode_is "$SCEN_DIR/home_root/deploy/.ssh/authorized_keys" 600

# — run 2 on the SAME state, journal truncated (mutations must NOT repeat) —
: > "$JOURNAL"
run_provision --user deploy --pubkey "$SCEN_DIR/pubkey.txt"

check 'T2: second run exits 0'                       test "$RC" -eq 0
check 'T2 control: blocks re-ran (ufw journaled)'    jhas '^ufw limit 22/tcp'
check 'T2 control: blocks re-ran (ln journaled)'     jhas '^ln -sf'
check 'T2: no useradd'                               jhasnt '^useradd '
check 'T2: no mkswap'                                jhasnt '^mkswap '
check 'T2: no swapon activation'                     jhasnt '^swapon /'
check 'T2: no snap install'                          jhasnt '^snap install'
check 'T2: no certbot certonly'                      jhasnt '^certbot certonly'
check 'T2: no apt-get install at all'                jhasnt '^apt-get install'
check 'T2: no docker-ce install'                     jhasnt 'apt-get .*docker-ce'
check 'T2: no sshd reload'                           jhasnt '^systemctl reload ssh'
check 'T2: no sshd -t'                               jhasnt '^sshd -t'
check 'T8: hook NOT rewritten on run 2'              jhasnt 'tee .*memo-edge-reload\.sh'

# =============================================================================
# Scenario B — T4 lock-out guard: no --pubkey, no ~/.ssh/authorized_keys.
# =============================================================================
new_scenario B
run_provision --user deployer

check 'T4: exits non-zero'                      test "$RC" -ne 0
check 'T4: clear message names the key problem' grep -Eq 'public key|pubkey|authorized_keys' "$OUT"
check 'T4: NO sshd drop-in write'               jhasnt 'tee .*00-memo-hardening'
check 'T4: NO sshd -t'                          jhasnt '^sshd -t'
check 'T4: NO ssh reload'                       jhasnt '^systemctl reload ssh'

# =============================================================================
# Scenario C — T5 DNS gate: a name does not resolve → exit EXACTLY 10.
# (Uses the ~/.ssh/authorized_keys fallback — no --pubkey.)
# =============================================================================
new_scenario C
mkdir -p "$SCEN_DIR/home/.ssh"
printf '%s\n' "$KEY" > "$SCEN_DIR/home/.ssh/authorized_keys"
# NOTE: no state/dns_ok → the getent shim fails ahostsv4 for every name
run_provision --user deploy

check 'T5: exit code is exactly 10'             test "$RC" -eq 10
check 'T5: NO certbot certonly'                 jhasnt '^certbot certonly'
check 'T5: manual step names the three A records' grep -Fq 'three A records' "$OUT"
check 'T5: manual step names the punycode name' grep -Fq 'xn--b1acfa3biol7a6ce.xn--p1ai' "$OUT"
check '(extra) fallback keys honored: user created' jhas '^useradd -m -s /bin/bash deploy'

# =============================================================================
# Scenario D — T6 port 80 occupied → non-zero exit, no certbot certonly.
# =============================================================================
new_scenario D
mkdir -p "$SCEN_DIR/home/.ssh"
printf '%s\n' "$KEY" > "$SCEN_DIR/home/.ssh/authorized_keys"
printf 'dns ok\n' > "$SCEN_DIR/state/dns_ok"
printf 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*\n' > "$SCEN_DIR/state/ss_ltn"
run_provision --user deploy

check 'T6: exits non-zero'                      test "$RC" -ne 0
check 'T6: exit code is NOT the DNS pause (10)' test "$RC" -ne 10
check 'T6: NO certbot certonly'                 jhasnt '^certbot certonly'
check 'T6: temp server never started'           jhasnt 'python3 -m http.server'

# =============================================================================
# Scenario E — (extra) preflight: non-Ubuntu host → exit 2, nothing done.
# =============================================================================
new_scenario E
printf 'ID=debian\nVERSION_CODENAME=bookworm\n' > "$SCEN_DIR/etc/os-release"
run_provision --user deploy

check 'preflight: non-ubuntu exits 2'           test "$RC" -eq 2
check 'preflight: nothing was done'             test ! -s "$JOURNAL"

# =============================================================================
# T7 — usage: missing --user / unknown option / --help (plain env: the parser
# must exit BEFORE any preflight or filesystem access).
# =============================================================================
t7_run() { # args... → sets T7_RC, T7_OUT
  T7_OUT=$WORK/t7.log
  set +e
  HOME="$WORK" bash "$UNDER_TEST" "$@" >"$T7_OUT" 2>&1
  T7_RC=$?
  set -e
}

t7_run
check 'T7: missing --user exits non-zero'       test "$T7_RC" -ne 0
check 'T7: missing --user prints usage'         grep -q 'Usage:' "$T7_OUT"

t7_run --wat
check 'T7: unknown option exits non-zero'       test "$T7_RC" -ne 0
check 'T7: unknown option prints usage'         grep -q 'Usage:' "$T7_OUT"

t7_run --help
check 'T7: --help exits 0'                      test "$T7_RC" -eq 0
check 'T7: --help prints usage'                 grep -q 'Usage:' "$T7_OUT"
check 'T7: usage documents the test seams'      grep -q 'PROVISION_ETC_ROOT' "$T7_OUT"
check 'T7: usage documents exit code 10 (pause)' grep -Eq '10.*PAUSED|PAUSED' "$T7_OUT"
check 'T7: usage documents --user as required'  grep -q -- '--user' "$T7_OUT"

# =============================================================================
printf 'PASS %d / FAIL %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
