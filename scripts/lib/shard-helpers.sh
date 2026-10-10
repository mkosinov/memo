# Sourced library for test-all.sh: shard orphan cleanup, build-dir wipe and
# the bounded EXIT-trap cleaner. NOT executable — always sourced:
#   source "$ROOT/scripts/lib/shard-helpers.sh"
#
# No `set -euo pipefail` here — the caller's flags apply (test-all.sh runs
# under `set -euo pipefail`). Every fallible command inside these functions
# is guarded (`|| true`, `if cmd;`) so `set -e` never aborts the caller from
# library code.
#
# Functions read shard ports from the caller's globals (no function
# arguments — tests override them before sourcing):
#   SHARD_FRONTEND_PORTS=(3002 3003)
#   SHARD_BACKEND_PORTS=(8001 8002)
#
# Feature #317 (run tag + dynamic shard ports), spec §3.1/§3.2:
#   gen_run_tag          — unique 6-hex run tag for the current run (stdout)
#   allocate_shard_ports — 4 pairwise-distinct free ports from the window
# Both print their RESULT on stdout (callers capture it); diagnostics go
# to stderr only.
#
# Feature #317, spec §3.3 (run leases + start-cleanup):
#   write_run_lease TAG PID P1 P2 P3 P4 — atomic one-line lease file
#   remove_run_lease TAG                — delete the run's own lease
#   sweep_dead_runs                     — start-cleanup: sweep dead-run
#     resources, report live-run ports on stdout (feed them to
#     allocate_shard_ports as busy args: allocate_shard_ports $(sweep_dead_runs)).

CLEANUP_BUDGET_S=10

# ── Feature #317 constants ─────────────────────────────────────────────────
# SHARD_RUNS_DIR — run-lease files (${TAG}.run) live here; written/parsed by
#   test-all.sh (Tasks 2+). gen_run_tag only CHECKS the path for collisions.
#   Default mirrors the LOG_DIR precedent in test-all.sh (${TMPDIR:-/tmp}).
# SHARD_PORT_WINDOW_* — the dynamic-port window. 28000-32700 sits BELOW the
#   Linux kernel ephemeral range 32768-60999 (the kernel never hands these
#   ports to outgoing connections), below macOS ephemeral (49152+), above
#   the privileged range, and clear of every repo service port (3000-3003,
#   8000-8002, 3100, 8101). Capacity: 4701 ports / 4 per run ≈ 1175 parallel
#   runs. NB: the dryrun harness's own allocate_port_triplet window
#   (38200-46099) is unrelated test plumbing and is NOT reused.
# SHARD_ALLOC_MAX_ATTEMPTS — shared bounded-retry budget (tag redraws and
#   port-allocation draws): every failure mode must terminate, never hang.
SHARD_RUNS_DIR="${SHARD_RUNS_DIR:-${TMPDIR:-/tmp}/memo-shard-runs}"
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
SHARD_ALLOC_MAX_ATTEMPTS=20

# ── Внутренний хелпер: выборка «порт + маска команды» ───────────────────────
# Использование: _masked_pids PORTS_VAR PGPATTERN GATE1 [GATE2 ...]
#   PORTS_VAR — имя глобала-массива портов (SHARD_FRONTEND_PORTS/...);
#   PGPATTERN — pgrep -f шаблон кандидатов (номинация, не приговор);
#   GATE*     — подстроки, хотя бы одна из которых должна быть в ps args.
# Выводит (stdout) pid'ы, прошедшие КОНЪЮНКЦИЮ: args содержит маску И pid
# держит порт из списка. Выборка слушающих — по-портовый `lsof -ti :PORT`
# (диапазонный синтаксис `lsof -i :a-b` непортабелен и запрещён, §3.3).
# Чистый finder: сигналов не посылает; pid выводится один раз (первое
# совпадение порта). bash 3.2-совместимо: имя массива читается через
# eval-косвенность.
_masked_pids() {
  local ports_var="$1" pgpat="$2"; shift 2
  local pid args port
  for pid in $(pgrep -f "$pgpat" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    local matched=false gate
    for gate in "$@"; do
      case "$args" in
        *"$gate"*) matched=true; break ;;
      esac
    done
    [ "$matched" = true ] || continue
    # Индирекция по имени: ports_var указывает на массив портов вызывающего.
    for port in $(eval "printf '%s\n' \"\${${ports_var}[@]}\""); do
      if lsof -ti :"$port" 2>/dev/null | grep -qx "$pid"; then
        printf '%s\n' "$pid"
        break
      fi
    done
  done
}

# _sweep_masked PORTS_VAR PGPATTERN GATE1 [GATE2 ...] — kill -9 каждому,
# кого выбрал _masked_pids. Убийство только при конъюнкции: args содержит
# маску И pid держит порт из списка. Голый lsof-килл без маски в уборщике
# запрещён (гонка с невиновным займётом порта); держатели без порта и порты
# без маски не трогаются.
_sweep_masked() {
  local pid
  for pid in $(_masked_pids "$@"); do
    kill -9 "$pid" 2>/dev/null || true
  done
}

# ── Kill orphan processes from previous runs ───────────────────────────────
# Previous pre-push runs may have left Next.js/uvicorn processes on shard
# ports. Kill them to avoid EADDRINUSE and corrupted state.
kill_port_orphans() {
  for port in "${SHARD_FRONTEND_PORTS[@]}" "${SHARD_BACKEND_PORTS[@]}"; do
    # Find PIDs listening on this port and kill them
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "    killing orphan processes on port $port: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
  done
  sleep 2

  # Also kill any orphan shard-stack processes from previous runs (worktrees
  # etc.). Shard frontends run `next dev -p 3002/3003`; the forked next-server
  # child loses the port from its cmdline (process title overwrites it with
  # "next-server (vX)"), so match the parent chain and kill its children.
  # NEVER `pkill -f "next-server"` — it matches EVERY Next.js dev server,
  # including the dev stack on :3000/:3001 and unrelated host instances.
  # ps-args gate: pkill -P fires only for PIDs whose args really contain the
  # shard mask, so a stray pgrep match (e.g. an editor grep buffer) never
  # gets its children murdered here.
  local pid args
  for pid in $(pgrep -f "next dev -p 300[2-3]" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *"next dev -p 300"[2-3]*)
        pkill -9 -P "$pid" 2>/dev/null || true   # forked next-server child
        kill -9 "$pid" 2>/dev/null || true       # pnpm wrapper / next dev parent
        ;;
    esac
  done
  sleep 1
}

# ── Remove stale shard build dirs (unconditional, fail-fast) ──────────────
# Each shard compiles into frontend/admin/.next-shard-N (NEXT_DIST_DIR).
# Wiping them on every start makes the run deterministic: chunks are never
# inherited across runs. Unconditional — independent of port state (shards
# own these dirs exclusively; nobody else can hold them). Empty match set
# (clean machine, first run) is SUCCESS — nothing to remove.
wipe_shard_dirs() {
  local wiped=false dir
  shopt -s nullglob
  for dir in "$ROOT"/frontend/admin/.next-shard-*; do
    wiped=true
    if ! rm -rf "$dir"; then
      shopt -u nullglob
      echo "❌ Failed to remove stale shard build dir: $dir" >&2
      exit 1
    fi
  done
  shopt -u nullglob
  if [ "$wiped" = false ]; then
    echo "  → no shard build dirs to wipe (clean run)"
  fi
}

# ── Cleanup function for shard stacks (EXIT trap) ─────────────────────────
# Bounded ladder: TERM wrappers → budgeted wait → KILL survivors →
# port+cmdline sweep → remove shard DBs. Every step is bounded; nothing in
# the trap can hang the run.
cleanup_shards() {
  echo ""
  echo "Cleaning up shard stacks..."

  # TERM the wrappers (SHARD_BACKEND_PIDS holds the background subshell PIDs
  # from test-all.sh). TERM to the wrapper cascade-TERMs its tracked children
  # (the FastAPI backend, the `next dev` parent), but NOT the grandchild
  # next-server — `next dev` re-execs into a next-server child it does not
  # propagate signals to. The only way to finish such a survivor is the sweep
  # below (step 4); extending e2e-shard-start.sh's tracking to cover it would
  # mean hidden PGID machinery, rejected by spec §3.3.
  local pid port pids args alive
  if [ -n "${SHARD_BACKEND_PIDS:-}" ]; then
    for pid in "${SHARD_BACKEND_PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi

  # Budgeted wait: poll liveness instead of unbounded `wait` (#122 — the
  # wrapper dies on TERM but the next-server grandchild can keep the wrapper's
  # wait from returning forever). Max CLEANUP_BUDGET_S seconds, 0.5s interval.
  local deadline=$((SECONDS + CLEANUP_BUDGET_S))
  alive=false
  if [ -n "${SHARD_BACKEND_PIDS:-}" ]; then
    while true; do
      alive=false
      for pid in "${SHARD_BACKEND_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
          alive=true
        fi
      done
      [ "$alive" = false ] && break
      [ "$SECONDS" -ge "$deadline" ] && break
      sleep 0.5
    done
  fi

  # Survivors get SIGKILL (kill -9 also breaks SIG_IGN-holding processes).
  if [ "$alive" = true ]; then
    for pid in "${SHARD_BACKEND_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  # Control sweep: port + command mask, never a bare port kill — if an
  # innocent process grabbed a shard port between our kills and the sweep,
  # a bare `lsof`-kill would murder it. Two-step match (pgrep -f cannot AND):
  # pgrep only *nominates* candidates; the ps-args gate + port-hold check is
  # the kill decision.
  #
  # Frontends: the socket-holding orphan grandchild rewrites its process
  # title (`process.title = "next-server (vX)"`) BEFORE server.listen(), so
  # its args contain NO "next dev" — the mask must also accept the title
  # form. Candidates come from both pgrep patterns; the gate for the dev-form
  # is derived from the port list (ps args contain `next dev -p <port>`),
  # so it matches real argv and honours test-override ports. The port hold
  # (lsof on a shard port) is the discriminator — a next-server holding NO
  # shard port is never touched. NEVER `pkill -f "next-server"` — a blanket
  # kill would take down every Next.js dev server, incl. :3000/:3001.
  local fgate=()
  for port in "${SHARD_FRONTEND_PORTS[@]}"; do
    fgate+=("next dev -p $port")
  done
  fgate+=("next-server (v")
  _sweep_masked SHARD_FRONTEND_PORTS "next dev -p 300[2-3]" "${fgate[@]}"
  _sweep_masked SHARD_FRONTEND_PORTS "next-server" "${fgate[@]}"

  # Backends: real shard backends run as `uv run uvicorn src.main:app ...`;
  # the test DB name lives in DATABASE_URL env, not in argv — so argv cannot
  # discriminate shard uvicorns from any other, and the port hold is the
  # discriminator (shard backends listen on SHARD_BACKEND_PORTS only).
  _sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"

  # Remove per-shard DB copies (master DB is kept)
  rm -f "$ROOT"/backend/test_memo_shard*.db
  # GH #262 — remove per-shard avatar dirs (FILES_DIR), same lifecycle as the DB
  rm -rf "$ROOT"/backend/test_files_shard*

  return 0
}

# ── Feature #317: run tag + dynamic shard ports (spec §3.1/§3.2) ───────────

# _tag_resource_exists TAG → does ANY run resource of this tag exist?
# Resource families mirror the spec §3.3 audit globs (naming from §3.1):
# shard DB copies (incl. canon siblings via the trailing *), photo dirs,
# build dirs, and the lease file. Pure check — creates nothing.
# bash 3.2: nullglob toggle, no compgen -G.
_tag_resource_exists() {
  local tag="$1" f hit=false
  if [ -e "${SHARD_RUNS_DIR}/${tag}.run" ]; then
    return 0
  fi
  shopt -s nullglob
  for f in "$ROOT"/backend/test_memo_shard*_"$tag"* \
           "$ROOT"/backend/test_files_shard*_"$tag" \
           "$ROOT"/frontend/admin/.next-shard-*_"$tag"; do
    hit=true
    break
  done
  shopt -u nullglob
  [ "$hit" = true ]
}

# gen_run_tag → stdout: a unique 6-hex run tag (e.g. "1a2b3c"); rc 1 on
# failure. Entropy: `openssl rand -hex 3` = 24 bits ($RANDOM is FORBIDDEN
# here — 15 bits make tag collisions realistic, and a shared tag means
# shared DBs/dirs, destroying the isolation guarantee). Fallback:
# `od -An -N3 -tx3 /dev/urandom`, normalized (od pads with spaces; hex
# case is platform-dependent — we always emit lowercase). The candidate
# is validated against ^[0-9a-f]{6}$ BEFORE use: the tag lands in paths
# and rm-globs, so foreign chars (`/`, `*`, `..`, spaces) are excluded by
# the format. Regenerated while ANY resource of the tag already exists
# (leftovers of a dead run with the same tag). Bounded retries
# (SHARD_ALLOC_MAX_ATTEMPTS), then fail-fast. stdout carries ONLY the
# tag; diagnostics go to stderr. bash 3.2: ERE via a variable (portable
# `=~` form — a quoted/inline literal RHS is not).
gen_run_tag() {
  local tag attempt=0
  local hex_re='^[0-9a-f]{6}$'
  while [ "$attempt" -lt "$SHARD_ALLOC_MAX_ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    tag=""
    if command -v openssl >/dev/null 2>&1; then
      tag="$(openssl rand -hex 3 2>/dev/null || true)"
    fi
    if ! [[ "$tag" =~ $hex_re ]]; then
      # openssl missing/broken/garbage → od fallback; tr strips the od
      # padding/newlines and lowercases the hex.
      tag="$(od -An -N3 -tx3 /dev/urandom 2>/dev/null | tr -d ' \n' | tr 'A-F' 'a-f' || true)"
    fi
    [[ "$tag" =~ $hex_re ]] || continue      # bad format → redraw
    if ! _tag_resource_exists "$tag"; then
      printf '%s\n' "$tag"
      return 0
    fi
  done
  echo "❌ gen_run_tag: no unique run tag after $SHARD_ALLOC_MAX_ATTEMPTS attempts (every candidate matched existing resources under $ROOT/backend, $ROOT/frontend/admin or $SHARD_RUNS_DIR). Remove stale test_memo_shard*/test_files_shard*/.next-shard-* leftovers or old ${SHARD_RUNS_DIR}/*.run leases, then re-run." >&2
  return 1
}

# allocate_shard_ports [BUSY_PORT ...] → stdout: 4 pairwise-distinct free
# ports from the window, space-separated on one line (draw order — the
# ports are equivalent; the caller assigns front1/back1/front2/back2 per
# spec §3.2); rc 1 on failure. Every candidate is checked with lsof
# (per-port `lsof -ti :PORT` — range syntax `lsof -i :a-b` is unportable
# and banned); BUSY_PORT args are treated as occupied without a check —
# the caller passes live-lease ports there ("порты живых лизов передаются
# как занятые"). Bounded: at most SHARD_ALLOC_MAX_ATTEMPTS candidate
# draws, then fail-fast with an actionable message. stdout carries ONLY
# the ports; diagnostics go to stderr.
allocate_shard_ports() {
  local busy_raw="$*"
  local busy=" $busy_raw "
  local picked=()
  local attempt=0 have=0 port ok listed
  while [ "$have" -lt 4 ]; do
    if [ "$attempt" -ge "$SHARD_ALLOC_MAX_ATTEMPTS" ]; then
      echo "❌ allocate_shard_ports: cannot find 4 free pairwise-distinct ports in window $SHARD_PORT_WINDOW_LOW-$SHARD_PORT_WINDOW_HIGH after $SHARD_ALLOC_MAX_ATTEMPTS attempts (got $have of 4; busy args:${busy_raw:+ $busy_raw}). Check listeners with 'lsof -nP -i TCP -sTCP:LISTEN', free the window or re-run test-all." >&2
      return 1
    fi
    attempt=$((attempt + 1))
    port=$((SHARD_PORT_WINDOW_LOW + RANDOM % (SHARD_PORT_WINDOW_HIGH - SHARD_PORT_WINDOW_LOW + 1)))
    ok=true
    case "$busy" in *" $port "*) ok=false ;; esac        # live-lease port
    listed="${picked[*]:-}"
    case " $listed " in *" $port "*) ok=false ;; esac    # already picked
    if [ "$ok" = true ] && lsof -ti :"$port" >/dev/null 2>&1; then
      ok=false                                          # someone listens
    fi
    if [ "$ok" = true ]; then
      picked+=("$port")
      have=$((have + 1))
    fi
  done
  printf '%s %s %s %s\n' "${picked[0]}" "${picked[1]}" "${picked[2]}" "${picked[3]}"
  return 0
}

# ── Feature #317, spec §3.3: run leases + start-cleanup (sweep_dead_runs) ───

# Порог старения лиза: штамп старше этого = мёртвый прогон, даже если PID
# отвечает (закрывает PID-перезанятие — реальный test-all не живёт сутки).
# Штамп ставит пишущий лиз (write_run_lease), формат — epoch-секунды.
SHARD_LEASE_MAX_AGE_S=86400

# Номинация процессов-ресурсов мёртвого прогона (НЕ приговор: решение —
# конъюнкция ps-args-гейта и держания порта, см. _masked_pids). Покрывает
# все три маски команды из §3.3: uvicorn-бэкенды, `next dev`-родителей и
# перетитулованного next-server-внука.
SHARD_DEAD_RUN_PGPAT='uvicorn|next dev|next-server'

# write_run_lease TAG PID P1 P2 P3 P4 → записать ${SHARD_RUNS_DIR}/${TAG}.run:
# ОДНА строка `pid tag port1 port2 port3 port4 started_epoch` (§3.3). Штамп
# ставится ЗДЕСЬ (пишущим), = `date +%s`. Атомарность: запись в скрытый
# tmp-файл + mv (rename внутри того же каталога) — параллельный читатель
# не видит частичную строку; tmp-имя с точкой не матчится glob'ом *.run.
# Валидация: TAG — 6 строчных hex (тег попадает в пути и rm-glob'ы — чужие
# символы исключены форматом), PID/порты — числовые, портов ровно 4; при
# нарушении rc 1 + сообщение в stderr. stdout пуст (контракт генератора,
# как у gen_run_tag). bash 3.2: ERE через переменную.
write_run_lease() {
  local tag="$1" rpid="$2"
  shift 2
  local hex_re='^[0-9a-f]{6}$' num_re='^[0-9]+$'
  if ! [[ "$tag" =~ $hex_re ]]; then
    echo "❌ write_run_lease: bad tag '$tag' (want 6 lowercase hex)" >&2
    return 1
  fi
  if ! [[ "$rpid" =~ $num_re ]]; then
    echo "❌ write_run_lease: bad pid '$rpid'" >&2
    return 1
  fi
  if [ "$#" -ne 4 ]; then
    echo "❌ write_run_lease: want exactly 4 ports, got $#: $*" >&2
    return 1
  fi
  local p
  for p in "$@"; do
    if ! [[ "$p" =~ $num_re ]]; then
      echo "❌ write_run_lease: bad port '$p'" >&2
      return 1
    fi
  done
  mkdir -p "$SHARD_RUNS_DIR" 2>/dev/null || true
  local tmp="${SHARD_RUNS_DIR}/.${tag}.run.$$"
  if printf '%s %s %s %s %s %s %s %s\n' "$rpid" "$tag" "$1" "$2" "$3" "$4" \
       "$(date +%s)" > "$tmp" 2>/dev/null \
     && mv -f "$tmp" "${SHARD_RUNS_DIR}/${tag}.run" 2>/dev/null; then
    return 0
  fi
  rm -f "$tmp" 2>/dev/null || true
  echo "❌ write_run_lease: cannot write ${SHARD_RUNS_DIR}/${tag}.run" >&2
  return 1
}

# remove_run_lease TAG → удалить ${SHARD_RUNS_DIR}/${TAG}.run — свой лиз
# убирает сам прогон на выходе (§3.3). Best-effort: rc 0 и когда файла уже
# нет (идемпотентно); TAG валидируется как в write_run_lease — непровали-
# дированная строка никогда не доходит до rm-пути (rc 1 + stderr).
remove_run_lease() {
  local tag="$1"
  local hex_re='^[0-9a-f]{6}$'
  if ! [[ "$tag" =~ $hex_re ]]; then
    echo "❌ remove_run_lease: bad tag '$tag' (want 6 lowercase hex)" >&2
    return 1
  fi
  rm -f "${SHARD_RUNS_DIR}/${tag}.run" 2>/dev/null || true
  return 0
}

# sweep_dead_runs → старт-чистка (§3.3 «Старт-чистка»; будущая замена
# kill_port_orphans — переподключение вызывающих сторон в Task 4). Читает
# все ${SHARD_RUNS_DIR}/*.run:
#   живой   = PID отвечает (kill -0) И штамп свежее SHARD_LEASE_MAX_AGE_S;
#   мёртвый = всё остальное (PID мёртв; перезанятие PID закрыто старением).
# Живой прогон → его 4 порта печатаются в stdout (разделители-пробелы;
# вызывающий передаёт их аллокатору как занятые:
#   allocate_shard_ports $(sweep_dead_runs)
# — контракт busy-args из §3.2) и полностью исключаются из любого свипа.
# Мёртвый прогон → лестница TERM → бюджет (CLEANUP_BUDGET_S, то же, что у
# cleanup_shards) → kill -9 через _sweep_masked по ЕГО 4 портам И маске
# команды (uvicorn / `next dev -p <port>` / `next-server (v`), затем —
# удаление тегированных файловых ресурсов тега и самого лиза.
# Порты вне лизов (dev 3000/3001/8000, playground 3100/8101, легаси
# 3002/3003/8001/8002) не входят ни в один лиз → не свипаются никогда.
# Битый/нечитаемый лиз → удаляется только файл лиза (порты неизвестны —
# свип невозможен); чужие *.run с не-6-hex тегом игнорируются нетронутыми
# (непровалидированный тег не доходит до rm-glob'ов). Пустой/отсутствующий
# каталог лизов (первый прогон) → no-op. Best-effort: rc 0; stdout несёт
# ТОЛЬКО порты живых лизов, диагностика — в stderr. bash 3.2: простые
# массивы + eval-косвенность (см. _masked_pids).
sweep_dead_runs() {
  local f tag now age
  local lpid ltag lp1 lp2 lp3 lp4 lstamp extra
  local hex_re='^[0-9a-f]{6}$' num_re='^[0-9]+$'
  now="$(date +%s 2>/dev/null || printf '%s' 0)"
  shopt -s nullglob
  for f in "$SHARD_RUNS_DIR"/*.run; do
    tag="${f##*/}"
    tag="${tag%.run}"
    if ! [[ "$tag" =~ $hex_re ]]; then
      echo "  ⚠️ sweep_dead_runs: ignoring foreign file $f (tag not 6-hex)" >&2
      continue
    fi
    lpid=""; ltag=""; lp1=""; lp2=""; lp3=""; lp4=""; lstamp=""; extra=""
    if ! read -r lpid ltag lp1 lp2 lp3 lp4 lstamp extra < "$f" 2>/dev/null \
       || [ -z "$lpid" ] || [ -z "$lp1" ] || [ -z "$lp2" ] || [ -z "$lp3" ] \
       || [ -z "$lp4" ] || [ -z "$lstamp" ] || [ -n "$extra" ] \
       || ! [[ "$lpid" =~ $num_re ]] || ! [[ "$lp1" =~ $num_re ]] \
       || ! [[ "$lp2" =~ $num_re ]] || ! [[ "$lp3" =~ $num_re ]] \
       || ! [[ "$lp4" =~ $num_re ]] || ! [[ "$lstamp" =~ $num_re ]]; then
      echo "  ⚠️ sweep_dead_runs: malformed lease $f — removing the lease only (no port sweep)" >&2
      rm -f "$f" 2>/dev/null || true
      continue
    fi
    age=$(( now - lstamp ))
    if kill -0 "$lpid" 2>/dev/null && [ "$age" -lt "$SHARD_LEASE_MAX_AGE_S" ]; then
      # Живой прогон: порта → busy-лист аллокатора; прогон не трогается.
      printf '%s %s %s %s\n' "$lp1" "$lp2" "$lp3" "$lp4"
      echo "  → live run $tag (pid=$lpid age=${age}s): ports $lp1 $lp2 $lp3 $lp4 bypassed" >&2
      continue
    fi
    echo "  → dead run $tag (pid=$lpid age=${age}s): sweeping ports $lp1 $lp2 $lp3 $lp4" >&2
    DEAD_RUN_PORTS=("$lp1" "$lp2" "$lp3" "$lp4")
    local p
    local gates=("uvicorn" "next-server (v")
    for p in "${DEAD_RUN_PORTS[@]}"; do
      gates+=("next dev -p $p")
    done
    # Лестница: TERM → бюджет → kill -9 (механика cleanup_shards, §3.3).
    # Список TERM-нутых фиксируется один раз; бюджет ждёт только их смерть
    # (kill -0 по списку, без перевыборки lsof в цикле); опоздавшие/выжившие
    # достаются контрольному _sweep_masked ниже.
    local termed=()
    local tp
    for tp in $(_masked_pids DEAD_RUN_PORTS "$SHARD_DEAD_RUN_PGPAT" "${gates[@]}"); do
      kill "$tp" 2>/dev/null || true
      termed+=("$tp")
    done
    local deadline=$(( SECONDS + CLEANUP_BUDGET_S ))
    local still=false
    while :; do
      still=false
      for tp in "${termed[@]}"; do
        if kill -0 "$tp" 2>/dev/null; then
          still=true
        fi
      done
      [ "$still" = false ] && break
      [ "$SECONDS" -ge "$deadline" ] && break
      sleep 0.5
    done
    _sweep_masked DEAD_RUN_PORTS "$SHARD_DEAD_RUN_PGPAT" "${gates[@]}"
    # Тегированные файловые ресурсы мёртвого тега + сам лиз (хвостовой *
    # покрывает canon.sql-собрата; путь — от корня репо, как в cleanup_shards).
    rm -f  "$ROOT"/backend/test_memo_shard*_"$tag"* 2>/dev/null || true
    rm -rf "$ROOT"/backend/test_files_shard*_"$tag" 2>/dev/null || true
    rm -rf "$ROOT"/frontend/admin/.next-shard-*_"$tag" 2>/dev/null || true
    rm -f  "$f" 2>/dev/null || true
  done
  shopt -u nullglob
  return 0
}
