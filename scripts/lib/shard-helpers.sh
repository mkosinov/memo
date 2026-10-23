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
# arguments — tests override them before sourcing). Since #317 the
# orchestrator fills them from allocate_shard_ports (dynamic window
# 28000-32700); they are declared empty before sourcing and filled
# before the first call that reads them (cleanup_shards — trap-time):
#   SHARD_FRONTEND_PORTS=("$front1" "$front2")
#   SHARD_BACKEND_PORTS=("$back1" "$back2")
#
# Feature #317 (run tag + dynamic shard ports), spec §3.1/§3.2:
#   gen_run_tag          — unique 6-hex run tag for the current run (stdout)
#   allocate_shard_ports — 4 pairwise-distinct free ports from the window
# Both print their RESULT on stdout (callers capture it); diagnostics go
# to stderr only.
#
# Feature #317, spec §3.3 (run leases + start-cleanup + tail audit):
#   write_run_lease TAG PID P1 P2 P3 P4 — atomic one-line lease file
#   remove_run_lease TAG                — delete the run's own lease
#   sweep_dead_runs                     — start-cleanup: sweep dead-run
#     resources, report live-run ports on stdout (feed them to
#     allocate_shard_ports as busy args: allocate_shard_ports $(sweep_dead_runs)).
#   audit_orphan_tagged [CURRENT_TAG]   — tail audit (anti-accumulation):
#     tagged file resources with no live lease = garbage (removed, no
#     grace); log dirs run-<tag> only when the tag is dead > 24 h.
#
# Feature #448, spec §3.1/§3.2 (/proc port resolver — Task 1 primitives +
# Task 2 migration of the five lsof call sites onto them):
#   listen_pairs       — ONE sample per call: «pid port» lines from
#     /proc/net/tcp{,6} LISTEN rows + a single /proc/[0-9]*/fd/* scan;
#     unattributable holder → «- port» (fail-closed busy); unreadable
#     /proc/net/tcp → one stderr warning + rc 1 (callers keep lsof).
#   _listen_busy_ports — busy-port SET from ONE listen_pairs sample
#     (allocate_shard_ports' «порт ∈ сэмплу» filter).
#   _listener_on PORT…— «does ANY of these ports have a listener?» probe
#     behind _legacy_ports_free and test-all.sh's TOCTOU recheck /
#     .next-wipe guard; ONE sample per call; the non-Linux fallback keeps
#     the legacy per-port `lsof -ti :PORT` (byte-for-byte pre-#448).
#   _watch_interval_s  — normalize SHARD_STACK_WATCH_S / SHARD_RUN_WATCH_S
#     (default 5 s, hard max 600 s).
#   run_watchdog / stop_run_watchdog (#448 Task 4, §3.2) — fail-fast слой
#     оркестратора: фоновый цикл kill-0 по PID стек-обёрток; смерть обёртки →
#     диагноз + маркер + TERM обеим Playwright-стадиям с эскалацией
#     TERM → грейс → SIGKILL (жёсткая форма rev4); останов — родителем.

CLEANUP_BUDGET_S=10

# ── Feature #317 constants ─────────────────────────────────────────────────
# SHARD_RUNS_DIR — run-lease files (${TAG}.run) live here; written/parsed by
#   test-all.sh (Tasks 2+). gen_run_tag only CHECKS the path for collisions.
#   Default mirrors the LOG_DIR precedent in test-all.sh (${TMPDIR:-/tmp}).
# SHARD_LOGS_DIR — root of per-run log dirs ${SHARD_LOGS_DIR}/run-<tag>
#   (§3.1: ${TMPDIR:-/tmp}/test-all-logs — the same path test-all.sh keeps
#   in LOG_DIR). The tail audit removes only run-<tag> subdirs of tags dead
#   longer than 24 h (§3.3); it never creates or removes the root itself.
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
SHARD_LOGS_DIR="${SHARD_LOGS_DIR:-${TMPDIR:-/tmp}/test-all-logs}"
SHARD_PORT_WINDOW_LOW=28000
SHARD_PORT_WINDOW_HIGH=32700
SHARD_ALLOC_MAX_ATTEMPTS=20
# SHARD_LEGACY_PORTS — pre-#317 fixed shard ports. A #317 run never
# occupies or cleans them (§3.3); they matter only as the GATE for
# removing UNTAGGED legacy resources (wipe of untagged .next-shard-*
# build dirs, cleanup of untagged shard DBs/photo dirs): a live untagged
# manual stack (CI-like local run) holds them, so its files must survive.
# Array or space-joined scalar both work; the dryrun harness overrides it
# with test ports and steers the gate deterministically via fake holders.
if [ -z "${SHARD_LEGACY_PORTS:-}" ]; then
  SHARD_LEGACY_PORTS=(3002 3003 8001 8002)
fi

# ── Feature #448: /proc-резолвер «порт → PID» + константы watchdog ──────────
# SHARD_PROC_DRYRUN / SHARD_PROC_ROOT — контур тестопригодности резолвера
# (§3.1 «Тестопригодность»): продовый прогон читает ЛИТЕРАЛЬНЫЙ /proc;
# подмена корня фикстурой honoured ТОЛЬКО при непустом флаге dryrun-режима
# набора тестов — во внешнем окружении источником истины нельзя рулить.
# SHARD_STACK_WATCH_S / SHARD_RUN_WATCH_S — интервалы watchdog-поллинга
# (слой стека / слой оркестратора, Tasks 3-4): сырые env-значения
# прогоняются через _watch_interval_s (дефолт 5 с, жёсткий максимум 600 с).
SHARD_WATCH_DEFAULT_S=5
SHARD_WATCH_MAX_S=600

# ── Feature #472: readiness-poll deadlines (spec «Починка ожидания ──────────
# готовности») — ЕДИНЫЙ источник лимитов готовности (оба потребителя —
# e2e-shard-start.sh и test-all.sh — сурсят эту библиотеку; чисел-дубликатов
# нет). Семантика — настоящие дедлайны СТЕНОВОГО времени, не счётчики
# итераций: значения 60/120 сохранены от прежних счётчиков, но патологический
# хвост «порт слушает, но не отвечает» (висящий curl на каждой итерации:
# до ~11/~62 мин) сознательно срезается дедлайном (Behavioral Delta: под
# замком висящий порт = неисправность, а не медленная работа).
#   READY_BUDGET_BACKEND_S   — бюджет ожидания готовности бэкенда в обёртке
#                              стека (e2e-shard-start.sh, цикл /docs);
#   READY_BUDGET_FRONTEND_S  — бюджет ожидания готовности фронтенда там же
#                              (цикл /); оба env-переопределяемы (идиома
#                              SHARD_RUNS_DIR «${VAR:-default}»);
#   READY_ORCHESTRATOR_S     — ПОТОЛОК ожидания оркестратора (test-all.sh,
#                              маркеры готовности обоих осколков): ПРОИЗВОД-
#                              НАЯ от бюджетов (сумма + 180 с запаса на
#                              медленное открытие порта в режиме до-бинда) —
#                              переопределение бюджетов течёт в потолок.
READY_BUDGET_BACKEND_S="${READY_BUDGET_BACKEND_S:-60}"
READY_BUDGET_FRONTEND_S="${READY_BUDGET_FRONTEND_S:-120}"
READY_ORCHESTRATOR_S=$(( READY_BUDGET_BACKEND_S + READY_BUDGET_FRONTEND_S + 180 ))

# _watch_interval_s VALUE → stdout: нормализованный интервал watchdog-
# поллинга (сек). §3.2: не-число, пусто, 0, отрицательное или больше
# жёсткого максимума (600) → дефолт 5. ЕДИНЫЙ нормализатор обеих констант
# (SHARD_STACK_WATCH_S / SHARD_RUN_WATCH_S): вызывающий слой подаёт сырую
# env-строку, получает гарантированное целое 1..600. stdout — одно число;
# rc всегда 0. bash 3.2: ERE через переменную (портабельная форма =~);
# 10# — ведущие нули не трактуются как восьмеричные.
_watch_interval_s() {
  local v="${1:-}" n
  local num_re='^[0-9]+$'
  if [[ "$v" =~ $num_re ]]; then
    n=$((10#$v))
    if [ "$n" -ge 1 ] && [ "$n" -le "$SHARD_WATCH_MAX_S" ]; then
      printf '%s\n' "$n"
      return 0
    fi
  fi
  printf '%s\n' "$SHARD_WATCH_DEFAULT_S"
  return 0
}

# _proc_fd_owners ROOT → stdout строки «pid socket:[inode]» — ОДИН проход по
# ROOT/[0-9]*/fd. ОДНА команда `ls -l` на ВСЕ fd-каталоги (заголовки групп
# «<root>/<pid>/fd:» дают pid; внешний readlink на каждый fd — тысячи
# fork+exec, СЕКУНДЫ на загруженном боксе: ломала ≤15 s контракт
# cleanup_shards, #448 Task 2). Ошибки листинга (нет прав на чужой
# fd-каталог, процесс умер в гонке) — на stderr, подавлены: неатрибутируемый
# inode → «- port» (fail-closed, §3.1). Строки-заголовки «total N» и
# не-сокетные цели отсеивает awk. Вызывается внутри подстановки <( ).
# Пустой вывод ВАЛИДЕН (нет процессов/нет прав вовсе). bash 3.2 + awk
# (mawk/BSD/gawk); формат «N -> socket:[I]» и групповые заголовки «dir:»
# одинаковы на GNU/BSD ls.
_proc_fd_owners() {
  local dir
  local dirs=()
  for dir in "$1"/[0-9]*; do
    [ -d "$dir/fd" ] && dirs+=("$dir/fd")
  done
  [ "${#dirs[@]}" -gt 0 ] || return 0
  # Групповой заголовок «<dir>:» ls печатает только при >1 каталога —
  # единственный каталог дублируется (повторы строк вычитает join-awk
  # listen_pairs по (inode, pid); занятости это не меняет).
  if [ "${#dirs[@]}" -eq 1 ]; then
    dirs+=("${dirs[0]}")
  fi
  ls -l "${dirs[@]}" 2>/dev/null | awk '
    /\/fd:$/ {
      pid = $0
      sub(/\/fd:$/, "", pid)   # …/<pid>/fd: → …/<pid>
      sub(/.*\//, "", pid)     # → <pid>
      next
    }
    {
      target = $0
      sub(/.*-> /, "", target)
      if (pid ~ /^[0-9]+$/ && target ~ /^socket:\[[0-9]+\]$/) print pid, target
    }
  ' || true
  return 0
}

# listen_pairs → stdout строки «pid port» — ОДИН сэмпл на вызов, без lsof
# (§3.1 «Резолвер»). Источник — /proc/net/tcp + /proc/net/tcp6 (обе таблицы,
# отсутствие tcp6 — не ошибка): строки состояния 0A (LISTEN); порт —
# hex-часть локального адреса после ПОСЛЕДНЕГО двоеточия → dec (как в lsof-
# выборке _masked_pids); inode → владелец одиночным проходом /proc/[0-9]*/
# fd/* по симлинку socket:[inode]. lsof слеп к перетитулованным process.title
# (пробелы/вложенные скобки ломают разбор /proc/<pid>/stat); резолвер stat
# не читает — только fd-симлинки, поэтому невидимые держатели видимы.
#
# Fail-closed (§3.1): LISTEN-строка, чей inode не сопоставился ни одному
# процессу (чужой uid без прав чтения fd, чужой PID-namespace при общем
# netns), НЕ выбрасывается: печатается строка «- port» — порт занят,
# держатель неизвестен. «-» — ПРЕДНАМЕРЕННЫЙ маркер пустого pid (не пустое
# поле: `read -r pid port` на строке с ведущим пробелом кладёт порт в pid,
# и номер порта попадает в holders-конъюнкцию как «кандидат на убийство»);
# «-» же не матчится ни с одним pgrep-кандидатом — убийства нет, занятость
# есть. Свободен только порт без LISTEN-строки вовсе.
#
# Не-Linux фолбэк: /proc/net/tcp нечитаем → ОДНОКРАТНОЕ предупреждение в
# stderr, rc 1, stdout пуст — вызывающие точки (пять замен, Task 2) при
# не-нулевом rc используют прежний lsof-вызов. stdout несёт ТОЛЬКО пары;
# диагностика — в stderr. Один сэмпл = одно чтение таблиц + один проход по
# fd (тысячи readlink — миллисекунды; кэширование не строим, §3.1).
#
# join на awk, файл 1 — таблицы (заголовок ядра гарантирует непустоту →
# идиома NR==FNR корректна и при ПУСТОМ fd-скане: все строки тогда уходят
# в «- port»), файл 2 — «pid socket:[inode]» из _proc_fd_owners. Печать
# дедуплицирована по (inode, pid) — dup'd fd не размножает строки; сокет,
# разделённый форком (два pid держат один fd), печатается обоими — как у
# lsof. bash 3.2: без assoc-массивов, awk — переносимый (mawk/BSD/gawk).
listen_pairs() {
  local root="/proc"
  if [ -n "${SHARD_PROC_DRYRUN:-}" ] && [ -n "${SHARD_PROC_ROOT:-}" ]; then
    root="${SHARD_PROC_ROOT}"
  fi
  local tcp_tbl="$root/net/tcp"
  if [ ! -r "$tcp_tbl" ]; then
    echo "⚠️ listen_pairs: $tcp_tbl unreadable — non-Linux? Port checks fall back to the lsof path." >&2
    return 1
  fi
  if ! awk '
    function hextodec(h,   i, c, d, v) {
      v = 0
      for (i = 1; i <= length(h); i++) {
        c = tolower(substr(h, i, 1))
        d = index("0123456789abcdef", c) - 1
        if (d < 0) return -1
        v = v * 16 + d
      }
      return v
    }
    NR == FNR {
      if ($4 == "0A" && NF >= 10) {
        port = $2
        sub(/^.*:/, "", port)                  # после последнего «:»
        port = hextodec(port)
        if (port > 0) lport[$10] = port
      }
      next
    }
    $2 ~ /^socket:\[/ {
      ino = substr($2, 9, length($2) - 9)      # socket:[<inode>]
      if (ino in lport) {
        if (!((ino, $1) in printed)) {
          print $1, lport[ino]
          printed[ino, $1] = 1
        }
        seen[ino] = 1
      }
      next
    }
    END {
      for (ino in lport) {
        if (!(ino in seen)) print "-", lport[ino]
      }
    }
  ' <(cat "$tcp_tbl" "$root/net/tcp6" 2>/dev/null) <(_proc_fd_owners "$root"); then
    echo "⚠️ listen_pairs: table parse failed — treating as no /proc (lsof fallback)." >&2
    return 1
  fi
  return 0
}

# _listen_busy_ports → stdout: пробел-обособленное множество занятых LISTEN-
# портов (« 20001 20002 ») из ОДНОГО сэмпла listen_pairs (#448 Task 2, §3.1).
# Членство проверяется шаблоном `case $set in *" $port "*` — обособление с
# обеих сторон обязательно. Строки «- port» вносят порт (неатрибутируемый
# держатель занят — fail-closed: «свободен» только порт без LISTEN-строки);
# pid-колонка множеству не нужна. rc 1 ⇔ не-Linux фолбэк (сэмпл не удался,
# см. listen_pairs) — вызывающая точка использует прежний lsof-вызов.
# Пустой сэмпл → одиночный пробел (валидное пустое множество). bash 3.2.
_listen_busy_ports() {
  local sample spid sport out=" "
  if ! sample="$(listen_pairs)"; then
    return 1
  fi
  while read -r spid sport; do
    [ -n "$sport" ] || continue
    out="$out$sport "
  done <<< "$sample"
  printf '%s\n' "$out"
  return 0
}

# _listener_on PORT... → rc 0 ⇔ ХОТЯ бы один из аргументов — порт занят
# LISTEN-держателем. ЕДИНАЯ проба занятости трёх точек #448 Task 2 (§3.1):
# легаси-гейт _legacy_ports_free, TOCTOU-recheck и гард .next-вайпа в
# test-all.sh. ОДИН сэмпл на вызов (фильтр «порт ∈ аргументам»), не по
# проверке на порт: дешевле и видит невидимых lsof держателей
# (перетитулованный process.title). Неатрибутируемый держатель («- port»)
# считается занятым. rc 1 — все аргументы свободны ИЛИ аргументов нет.
# Не-Linux фолбэк (listen_pairs rc≠0): прежний пословичный `lsof -ti :PORT`
# байт-в-байт как до #448 (диапазонный синтаксис lsof -i :a-b непереносим
# и запрещён); ошибающийся/недоступный lsof трактуется как «свободно»
# (поза отказобезопасности как в allocate_shard_ports). bash 3.2: "$@" на
# пустом наборе безопасен под set -u.
_listener_on() {
  local busy_ports port
  if ! busy_ports="$(_listen_busy_ports)"; then
    for port in "$@"; do
      if lsof -ti :"$port" >/dev/null 2>&1; then
        return 0
      fi
    done
    return 1
  fi
  for port in "$@"; do
    case "$busy_ports" in *" $port "*) return 0 ;; esac
  done
  return 1
}

# ── Feature #448 Task 4: fail-fast слой оркестратора (watchdog) ─────────────
# run_watchdog MARKER_FILE TERM_STAGES_FILE EXIT_STAGES_FILE — фоновый цикл
# оркестратора (test-all.sh запускает его как фоновый сабшелл СРАЗУ после
# старта стек-обёрток, ДО readiness-ожидания — рано выключенным стекам не
# потеряться; §3.2). Читает глобалы вызывающего (как остальная библиотека):
#   SHARD_BACKEND_PIDS — PID стек-обёрток: ПРЯМЫЕ дети главного shell-а
#     оркестратора (сабшеллы `( … bash e2e-shard-start.sh ) &`); индекс i ↔
#     SHARD_FRONTEND_PORTS[i] / SHARD_BACKEND_PORTS[i] ↔ стек-лог
#     $LOG_DIR/shard-stack-$((i+1)).log;
#   LOG_DIR            — каталог логов прогона (стек-логи для диагностики);
#   SHARD_RUN_WATCH_S  — тик поллинга (нормализуется _watch_interval_s);
#   CLEANUP_BUDGET_S   — бюджет лестницы эскалации стадий (как cleanup_shards).
# Каждый тик: kill -0 по обёрткам. Провал kill -0 = ESRCH — ЗОМБИ тоже
# отвечает на kill -0 (невыбранный родителем труп «жив»), поэтому провал
# означает «репнут и исчез» и есть окончательный вердикт «умер»: ложных
# смертей не бывает — бывает лишь задержка на тик до рептинга родителем.
# wait "$pid" — родительский шаг паттерна kill-0→wait (§3.2: рептинг+статус):
# в контексте родителя он репает и даёт статус; в сабшелле watchdog —
# безвредный 127 (обёртки — сиблинги watchdog, не его дети; pid уже исчез,
# репать некого — ESRCH уже доказал смерть).
# Вердикт «умер» (§3.2, порядок: диагноз → маркер → TERM → эскалация):
#   1) диагноз: номер стека, порты, ALWAYS-путь стека-лога + кап-хвост 20
#      строк с фильтром секретов — _capped_log_tail (Task 3);
#   2) маркер-файл MARKER_FILE (строка «shard=N pid=P epoch=E») — его наличие
#      после финального wait краснит прогон (US-6: смерть обёртки после
#      зелёной её стадии — прогон, проехавший зелёным на мёртвом стеке);
#   3) TERM ОБЕИМ Playwright-стадиям из TERM_STAGES_FILE (жёсткая форма rev4
#      — соседняя тоже останавливается) с эскалацией TERM → грейс-полл
#      (CLEANUP_BUDGET_S, шаг 0.5) → SIGKILL заклинившим; коды оборванных
#      стадий собирает финальный wait оркестратора (существующий механизм
#      FAIL);
#   4) выход после ухода всех стадий.
# Без смертей: самовыход, когда все pid из EXIT_STAGES_FILE вышли (обёртки
# сами не завершаются — их прибирает exit-trap teardown, поэтому критерий —
# стадии, а не обёртки; живёт до конца финального wait). Файлы стадий
# пишутся оркестратором атомарным mv ПОСЛЕ старта Playwright-стадий и
# перечитываются каждый тик: файла НЕТ = стадии ещё не стартовали (окно
# readiness) — смотрим только обёртки, преждевременного само-выхода на
# пустом списке нет. Строки фильтруются числовым паттерном — только pid'ы.
# TERM/INT watchdog'у (stop_run_watchdog / сигнал главному shell-у): флаг
# остановки + убийство внутреннего sleep-ребёнка (урок Task 3: teardown не
# сиротит sleep); идущая реакция ДОЕЗЖАЕТ (заклинившая стадия получает свой
# SIGKILL) — останов не отнимает у реакции последний рунг лестницы.
# Диагностика — в stderr; stdout пуст; rc 0. bash 3.2: kill-0-поллинг, без
# wait -n; sleep-ребёнок прерываем (trap срабатывает в `wait`).
run_watchdog() {
  local marker="$1" term_file="$2" exit_file="$3"
  local interval i pid shard_n
  local -a wpids=()

  interval="$(_watch_interval_s "${SHARD_RUN_WATCH_S:-}")"
  for pid in ${SHARD_BACKEND_PIDS[@]+"${SHARD_BACKEND_PIDS[@]}"}; do
    wpids+=("$pid")
  done
  if [ "${#wpids[@]}" -eq 0 ]; then
    echo "⚠️ run_watchdog: SHARD_BACKEND_PIDS пуст — нечего сторожить, выходим" >&2
    return 0
  fi

  _wd_stop=0
  _wd_sleep_pid=""
  _wd_on_signal() {
    _wd_stop=1
    if [ -n "${_wd_sleep_pid:-}" ]; then
      kill "$_wd_sleep_pid" 2>/dev/null || true
    fi
  }
  trap _wd_on_signal TERM INT

  while :; do
    # Останов запрошен — новых реакций не открываем: после останова teardown
    # сам TERM-ит обёртки, и живой watchdog поставил бы ЛОЖНЫЙ маркер
    # (порядок «финальный wait → ОСТАНОВ → проверка маркера → вердикт»).
    [ "$_wd_stop" = 1 ] && exit 0

    # 1) живость обёрток: первый умерший выигрывает (вердикт по нему)
    i=0
    shard_n=0
    while [ "$i" -lt "${#wpids[@]}" ]; do
      if ! kill -0 "${wpids[$i]}" 2>/dev/null; then
        shard_n=$((i + 1))
        break
      fi
      i=$((i + 1))
    done
    if [ "$shard_n" -gt 0 ]; then
      i=$((shard_n - 1))
      pid="${wpids[$i]}"
      wait "$pid" 2>/dev/null || true
      echo "❌ run watchdog: stack shard $shard_n wrapper died (pid $pid; frontend :${SHARD_FRONTEND_PORTS[$i]:-?}, backend :${SHARD_BACKEND_PORTS[$i]:-?}) — останавливаю прогон" >&2
      _capped_log_tail "${LOG_DIR:-}/shard-stack-${shard_n}.log" >&2
      printf 'shard=%s pid=%s epoch=%s\n' "$shard_n" "$pid" \
        "$(date +%s 2>/dev/null || printf '%s' 0)" > "$marker" 2>/dev/null || true
      _wd_stop_stages "$term_file"
      exit 0
    fi

    # 2) все стадии вышли → сторожить больше нечего (зелёная форма прогона)
    if [ -f "$exit_file" ] && _wd_pids_gone "$exit_file"; then
      exit 0
    fi

    # 3) тик: спим интервалом, TERM прерывает sleep (см. _wd_on_signal)
    sleep "$interval" &
    _wd_sleep_pid=$!
    wait "$_wd_sleep_pid" 2>/dev/null || true
    _wd_sleep_pid=""
  done
}

# _wd_read_pid_file FILE → stdout: числовые строки файла (по одной; мусорные
# и пустые строки пропускаются). rc всегда 0.
_wd_read_pid_file() {
  local line
  local num_re='^[0-9]+$'
  [ -f "$1" ] || return 0
  while read -r line; do
    [[ "$line" =~ $num_re ]] || continue
    printf '%s\n' "$line"
  done < "$1" 2>/dev/null
  return 0
}

# _wd_pids_gone FILE → rc 0 ⇔ КАЖДЫЙ pid файла уже не отвечает kill -0.
_wd_pids_gone() {
  local pid
  for pid in $(_wd_read_pid_file "$1"); do
    if kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
  done
  return 0
}

# _wd_stop_stages TERM_STAGES_FILE — жёсткая форма rev4: TERM КАЖДОЙ стадии
# из файла (соседняя — тоже) с лестницей TERM → грейс-полл (CLEANUP_BUDGET_S,
# шаг 0.5 с — бюджет существующей лестницы cleanup_shards) → SIGKILL
# выжившим; в конце — добор до «все вышли». Уже вышедшие pid пропускаются
# естественно (kill -0 молчит, kill в пустоту безвреден). rc всегда 0.
_wd_stop_stages() {
  local term_file="$1"
  local spids sp deadline
  spids="$(_wd_read_pid_file "$term_file")"
  [ -n "$spids" ] || return 0
  for sp in $spids; do
    kill "$sp" 2>/dev/null || true
  done
  deadline=$(( SECONDS + CLEANUP_BUDGET_S ))
  while :; do
    if _wd_pids_gone "$term_file"; then
      break
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      break
    fi
    sleep 0.5
  done
  for sp in $spids; do
    if kill -0 "$sp" 2>/dev/null; then
      echo "⚠️ run watchdog: стадия pid $sp игнорирует TERM — SIGKILL" >&2
      kill -9 "$sp" 2>/dev/null || true
    fi
  done
  # финальный добор: выходим, когда все стадии ушли (kill -0 молчит); бюджет
  # ограничен — рептинг остаётся родителю, SIGKILL приговор окончательный
  deadline=$(( SECONDS + CLEANUP_BUDGET_S ))
  while :; do
    if _wd_pids_gone "$term_file"; then
      break
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      break
    fi
    sleep 0.5
  done
  return 0
}

# stop_run_watchdog — останов watchdog оркестратором. Жёсткий порядок
# завершения прогона (#448 Task 4, §3.2): финальный wait → ОСТАНОВ watchdog →
# проверка маркера → вердикт — останов ДО teardown-ловушки: teardown TERM-ит
# обёртки, и живой watchdog увидел бы эти (организованные нами же) смерти и
# поставил ЛОЖНЫЙ маркер зелёного прогона. TERM (флаг останова; идущая
# реакция доезжает — бюджет ниже это покрывает) → ограниченный полл → SIGKILL
# → wait-рептинг (watchdog — прямой ребёнок главного shell-а, wait действует;
# идемпотентен уже мёртвым — bash отдаёт сохранённый статус). Идемпотентен:
# пустой/очищенный RUN_WATCHDOG_PID → no-op; rc всегда 0.
stop_run_watchdog() {
  local pid="${RUN_WATCHDOG_PID:-}"
  local deadline
  [ -n "$pid" ] || return 0
  RUN_WATCHDOG_PID=""
  kill "$pid" 2>/dev/null || true
  deadline=$(( SECONDS + 2 * CLEANUP_BUDGET_S ))
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
  return 0
}

# ── Внутренний хелпер: выборка «порт + маска команды» ───────────────────────
# Использование: _masked_pids PORTS_VAR PGPATTERN GATE1 [GATE2 ...]
#   PORTS_VAR — имя глобала-массива портов (SHARD_FRONTEND_PORTS/...);
#   PGPATTERN — pgrep -f шаблон кандидатов (номинация, не приговор);
#   GATE*     — подстроки, хотя бы одна из которых должна быть в ps args.
# Выводит (stdout) pid'ы, прошедшие КОНЪЮНКЦИЮ: args содержит маску И pid
# держит LISTEN-сокет на одном из проверяемых портов.
# Выборка слушающих (§3.3) — ОДИН сэмпл на вызов: строки «pid port» из
# /proc-резолвера listen_pairs (#448 Task 2, §3.1) — только LISTEN и только
# ЛОКАЛЬНЫЙ конец (исходящее соединение с проверяемым портом на УДАЛЁННОМ
# конце не матчится, в отличие от `lsof -ti :PORT`, который ловит оба конца
# и не-LISTEN сокеты). Резолвер видит перетитулованных next-server'ов
# (process.title с пробелами/скобками ломает разбор lsof — исходный баг
# #448): stat не читается, только fd-симлинки. Неатрибутируемый держатель
# приходит строкой «- port»: «-» не матчится ни с одним pgrep-кандидатом —
# убийства нет, занятость видна (fail-closed, Task 1). rc≠0 сэмпла
# (не-Linux) — прежняя lsof-выборка байт-в-байт: `lsof -nP -i TCP
# -sTCP:LISTEN`, порт после последнего двоеточия (`1.2.3.4:PORT`,
# `[::]:PORT`, `*:PORT`), PID правым подсчётом полей (NF-8: COMMAND бывает
# с пробелами, левый край строки не фиксирован).
# Чистый finder: сигналов не посылает; pid выводится один раз. bash 3.2:
# имя массива читается через eval-косвенность.
_masked_pids() {
  local ports_var="$1" pgpat="$2"; shift 2
  # Один LISTEN-сэмпл на вызов: строки «pid port» (только локальный конец).
  local pairs
  if ! pairs="$(listen_pairs)"; then
    # не-Linux фолбэк: прежняя lsof-выборка (формат пар тот же).
    pairs="$(lsof -nP -i TCP -sTCP:LISTEN 2>/dev/null | awk '
      $(NF) == "(LISTEN)" {
        name = $(NF - 1); sub(/^.*:/, "", name)
        if (name ~ /^[0-9]+$/) print $(NF - 8), name
      }
    ' || true)"
  fi
  local ports_list
  ports_list="$(eval "printf '%s ' \"\${${ports_var}[@]}\"")"
  # Держатели LISTEN-сокетов на проверяемых портах (фильтр «порт ∈ множеству»).
  local holders=" "
  local lpid lport
  while read -r lpid lport; do
    [ -n "$lpid" ] || continue
    case " $ports_list " in
      *" $lport "*)
        case "$holders" in
          *" $lpid "*) ;;
          *) holders="$holders$lpid " ;;
        esac
        ;;
    esac
  done <<< "$pairs"
  local pid args
  for pid in $(pgrep -f "$pgpat" 2>/dev/null || true); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    local matched=false gate
    for gate in "$@"; do
      case "$args" in
        *"$gate"*) matched=true; break ;;
      esac
    done
    [ "$matched" = true ] || continue
    case "$holders" in
      *" $pid "*) printf '%s\n' "$pid" ;;
    esac
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

# _capped_log_tail PATH [CAP] — диагностирующий хвост лога стека с капом
# (#448 Task 3, §3.2). Печатает ВСЕГДА строку «stack log: PATH» — путь
# называют и когда файла нет: носитель правды — сам файл, хвост — лишь
# эвристика. PATH пуст или файла нет → строка «log not created»; иначе —
# последние CAP строк (дефолт 20), из которых подавляются строки с
# секретоносными маркерами (case-insensitive: cookie / authorization /
# auth-token / api-key / bearer / password / secret / token — фильтр
# сознательно эвристика, §3.2). Пустой вывод после фильтра валиден (все
# строки хвоста секретны). Потребитель — слой стека
# (e2e-shard-start.sh, fail-fast вердикт) и watchdog-примитив
# оркестратора (Task 4 переиспользует). bash 3.2: grep -iE, без PCRE;
# rc всегда 0 (диагностика не роняет вызывающий set -e).
_capped_log_tail() {
  local path="${1:-}" cap="${2:-20}"
  echo "stack log: ${path:-<unknown>}"
  if [ -n "$path" ] && [ -f "$path" ]; then
    tail -n "$cap" -- "$path" 2>/dev/null \
      | grep -viE 'cookie|authorization|auth-token|api-key|bearer|password|secret|token' || true
  else
    echo "log not created"
  fi
  return 0
}

# _legacy_ports_free → rc 0 ⇔ НИ один порт из SHARD_LEGACY_PORTS
# ({3002,3003,8001,8002}) не занят слушателем. ЕДИНЫЙ гейт, переиспользуемый
# вайпом и уборщиком (§3.3: «легаси-нетегированные — при свободных
# легаси-портах (то же правило, что у вайпа)»). Проба занятости —
# _listener_on (#448 Task 2): ОДИН сэмпл /proc-резолвера на вызов против
# ВСЕГО набора (неатрибутируемый держатель = занят — невидимые lsof
# легаси-стеки больше не открывают гейт); не-Linux фолбэк — прежний
# пословичный `lsof -ti :PORT` внутри _listener_on (байт-в-байт как до
# #448). Нечисловые токены пропускаются; ошибающийся lsof во фолбэке
# трактуется как «свободно» (поза отказобезопасности как в
# allocate_shard_ports). Детерминизм тестов — переопределением
# SHARD_LEGACY_PORTS на тест-порты с фейк-держателями / /proc-фикстурой.
_legacy_ports_free() {
  local p ports=()
  for p in ${SHARD_LEGACY_PORTS[*]:-}; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    ports+=("$p")
  done
  if [ "${#ports[@]}" -eq 0 ]; then
    return 0
  fi
  if _listener_on "${ports[@]}"; then
    return 1
  fi
  return 0
}

# _run_tag_or_empty → stdout: SHARD_RUN_TAG, если это валидные 6 строчных
# hex, иначе пусто. Валидация — ВНУТРИ потребителей тега (вайп/уборщик):
# непровалидированная строка никогда не доходит до rm-glob'ов (жёсткое
# правило #317 Task 7). Установленный, но невалидный тег → предупреждение
# в stderr + ПУСТО (падение в легаси-контракт без тега — поведение до
# #317, а не маска с мусором внутри). stdout пуст/тег; rc всегда 0.
_run_tag_or_empty() {
  local tag="${SHARD_RUN_TAG:-}"
  local hex_re='^[0-9a-f]{6}$'
  if [ -n "$tag" ]; then
    if [[ "$tag" =~ $hex_re ]]; then
      printf '%s\n' "$tag"
    else
      echo "⚠️ invalid SHARD_RUN_TAG '$tag' (want 6 lowercase hex) — using the untagged legacy contract" >&2
    fi
  fi
  return 0
}

# ── Kill orphan processes from previous runs ───────────────────────────────
# Pre-#317 this was kill_port_orphans (unmasked `lsof -ti :PORT | kill -9`
# on the fixed legacy ports). REMOVED by #317 Task 4: startup cleaning is
# sweep_dead_runs' business (§3.3) — masked, lease-driven, dynamic ports;
# the legacy ports 3002/3003/8001/8002 are never occupied or cleaned by
# a run anymore.

# ── Remove stale shard build dirs (fail-fast) ──────────────────────────────
# Each shard compiles into frontend/admin/.next-shard-<id>[_<tag>] (NEXT_DIST_DIR).
# Wiping them on every start makes the run deterministic: chunks are never
# inherited across runs. Empty match set (clean machine, first run) is
# SUCCESS — nothing to remove.
#
# #317 Task 7 (spec §3.3 «Вайп каталогов сборки») — контракт тегирован,
# когда SHARD_RUN_TAG — валидные 6 hex (валидация внутри, не на доверии):
#   (a) свои .next-shard-*_${TAG} — вытираются ВСЕГДА;
#   (b) все .next-shard-* БЕЗ валидного суффикса _<6hex> (легаси
#       .next-shard-N и lookalike'ы вида .next-shard-stale — «существующий
#       ассерт dryrun Case 1 остаётся зелёным» для пустого тега) — только
#       при свободных легаси-портах 3002/3003/8001/8002 (живой ручной
#       нетегированный стек держит свои каталоги сборки);
#   (c) ЧУЖИЕ тегированные (валидный _<6hex> ≠ свой тег) — НИКОГДА (их
#       прибирают старт-чистка мёртвых лизов и хвостовой аудит, §3.3).
# ПУСТОЙ тег → поведение байт-в-байт как до #317: безусловный глоб
# .next-shard-* (включая lookalike'и и чужие тегированные — в нетегиро-
# ванном прогоне тегированных не существует). Невалидный тег → stderr-
# предупреждение + поведение пустого (_run_tag_or_empty).
wipe_shard_dirs() {
  local tag dir base t wiped=false
  tag="$(_run_tag_or_empty)"
  if [ -z "$tag" ]; then
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
    return 0
  fi
  local untagged_ok=false
  if _legacy_ports_free; then
    untagged_ok=true
  else
    echo "  → legacy ports busy — keeping untagged .next-shard-* dirs (live untagged stack?)" >&2
  fi
  shopt -s nullglob
  for dir in "$ROOT"/frontend/admin/.next-shard-*; do
    base="${dir##*/}"
    t="$(_tag_of_entry "$base")"
    if [ -n "$t" ] && [ "$t" != "$tag" ]; then
      continue                                  # чужой тегированный — никогда
    fi
    if [ -z "$t" ] && [ "$untagged_ok" = false ]; then
      continue                                  # нетегированный — гейт закрыт
    fi
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
  return 0
}

# ── Cleanup function for shard stacks (EXIT/INT/TERM trap) ─────────────────
# Bounded ladder: TERM wrappers → budgeted wait → KILL survivors →
# port+cmdline sweep → remove shard DBs. Every step is bounded; nothing in
# the trap can hang the run.
#
# #317 Task 7 (spec §3.3 «Уборщик на выходе»): лестница keyed на
# ФАКТИЧЕСКИЕ порты прогона — SHARD_FRONTEND_PORTS/SHARD_BACKEND_PORTS
# (динамические с Task 4; легаси-значения 3002/3003 дают прежнее
# поведение), pgrep-маска `next dev -p <port>` генерируется из фактических
# портов + принимается форма `next-server (v`. Файловый хвост тегирован:
# только свои маски + свой лиз; легаси-нетегированные БД/фото-каталоги —
# при свободных легаси-портах (тот же гейт, что у вайпа); чужие
# тегированные ресурсы — никогда. Пустой тег → маски в точности как до
# #317 (CI байт-в-байт).
cleanup_shards() {
  echo ""
  echo "Cleaning up shard stacks..."

  # Тег прогона: валидируется здесь же (невалидный → легаси-контракт +
  # предупреждение; непровалидированная строка не доходит до rm-glob'ов).
  local tag
  tag="$(_run_tag_or_empty)"

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
  # form. The dev-form NOMINATION pattern and the ps-args gate are both
  # GENERATED from the run's ACTUAL ports (dynamic since #317; replaces the
  # hardcoded `next dev -p 300[2-3]`): alternation `next dev -p P1|next dev
  # -p P2`, matching real argv. The port hold (lsof on a run port) is the
  # discriminator — a next-server holding NO run port is never touched.
  # NEVER `pkill -f "next-server"` — a blanket kill would take down every
  # Next.js dev server, incl. :3000/:3001. Empty/zero port slots (manual-
  # stack shapes) skip naturally: no pattern → no sweep call, and nothing
  # ever LISTENs on port 0.
  local fgate=() pg_f=""
  for port in ${SHARD_FRONTEND_PORTS[*]:-}; do
    case "$port" in ''|*[!0-9]*) continue ;; esac
    fgate+=("next dev -p $port")
    if [ -n "$pg_f" ]; then pg_f="$pg_f|next dev -p $port"; else pg_f="next dev -p $port"; fi
  done
  fgate+=("next-server (v")
  if [ -n "$pg_f" ]; then
    _sweep_masked SHARD_FRONTEND_PORTS "$pg_f" "${fgate[@]}"
    _sweep_masked SHARD_FRONTEND_PORTS "next-server" "${fgate[@]}"
  fi

  # Backends: real shard backends run as `uv run uvicorn src.main:app ...`;
  # the test DB name lives in DATABASE_URL env, not in argv — so argv cannot
  # discriminate shard uvicorns from any other, and the port hold is the
  # discriminator (shard backends listen on SHARD_BACKEND_PORTS only).
  if [ -n "${SHARD_BACKEND_PORTS[*]:-}" ]; then
    _sweep_masked SHARD_BACKEND_PORTS "uvicorn" "uvicorn"
  fi

  # File tail. TAGGED run → ONLY own masks: `test_memo_shard*_${TAG}*`
  # (хвост `*` покрывает canon.sql/db-journal), `test_files_shard*_${TAG}`,
  # `.next-shard-*_${TAG}` + свой лиз; легаси-нетегированные БД/фото-каталоги
  # — при свободных легаси-портах (тот же гейт, что у вайпа; нетегированные
  # каталоги сборки — дело вайпа, не уборщика); чужие тегированные — никогда.
  # EMPTY tag → маски в точности как до #317: `test_memo_shard*.db` +
  # `test_files_shard*` (canon.sql и каталоги сборки не трогаются), лиз-файлы
  # не трогаются (нетега нет и лиза нет).
  # Fix B (smoke run3): каждый rm хвоста вооружён `2>/dev/null || true` —
  # под set -e callers ОДИН неудачный rm (например, «Directory not empty»
  # от гонки с выжившим next-server, который пересоздаёт файлы) обрывал
  # уборщик ДО удаления лиза. Идиома — как у file-хвоста sweep_dead_runs;
  # лиз удаляется ПОСЛЕДНИМ и всегда. Happy path не меняется.
  local e
  if [ -n "$tag" ]; then
    rm -f  "$ROOT"/backend/test_memo_shard*_"$tag"* 2>/dev/null || true
    rm -rf "$ROOT"/backend/test_files_shard*_"$tag" 2>/dev/null || true
    rm -rf "$ROOT"/frontend/admin/.next-shard-*_"$tag" 2>/dev/null || true
    if _legacy_ports_free; then
      shopt -s nullglob
      for e in "$ROOT"/backend/test_memo_shard*.db; do
        [ -z "$(_tag_of_entry "${e##*/}")" ] || continue   # tagged — not ours to remove
        rm -f "$e" 2>/dev/null || true
      done
      for e in "$ROOT"/backend/test_files_shard*; do
        [ -z "$(_tag_of_entry "${e##*/}")" ] || continue
        rm -rf "$e" 2>/dev/null || true
      done
      shopt -u nullglob
    else
      echo "  → legacy ports busy — keeping untagged shard DB/photo dirs (live untagged stack?)" >&2
    fi
    # Свой лиз (guard по presence: лиз есть только после успешного
    # write_run_lease — двойные уборки и до-лизные вызовы no-op; чужие
    # лизы — никогда, US-6). ПОСЛЕДНИЙ шаг хвоста — выполняется всегда.
    if [ -e "${SHARD_RUNS_DIR}/${tag}.run" ]; then
      remove_run_lease "$tag"
    fi
  else
    rm -f "$ROOT"/backend/test_memo_shard*.db 2>/dev/null || true
    rm -rf "$ROOT"/backend/test_files_shard* 2>/dev/null || true
  fi

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
# spec §3.2); rc 1 on failure. Занятость кандидата — фильтр «порт ∈ сэмплу»:
# ОДИН сэмпл listen_pairs на вызов (#448 Task 2, §3.1 — видит невидимых
# lsof держателей, перетитулованный process.title; до #448 был пословичный
# `lsof -ti :PORT`, диапазонный синтаксис `lsof -i :a-b` unportable и
# запрещён); BUSY_PORT args are treated as occupied without a check —
# the caller passes live-lease ports there ("порты живых лизов передаются
# как занятые"). Не-Linux фолбэк (сэмпл не удался) — прежний пословичный
# `lsof -ti :PORT` в цикле ниже, байт-в-байт. Bounded: at most
# SHARD_ALLOC_MAX_ATTEMPTS candidate draws, then fail-fast with an
# actionable message. stdout carries ONLY the ports; diagnostics go to
# stderr only.
allocate_shard_ports() {
  local busy_raw="$*"
  local busy=" $busy_raw "
  local picked=()
  local attempt=0 have=0 port ok listed
  # Один сэмпл на вызов → множество занятых LISTEN-портов («- port» строки
  # вносят порт — неатрибутируемый держатель тоже занят, fail-closed §3.1).
  local busy_ports="" resolver_ok=false
  if busy_ports="$(_listen_busy_ports)"; then
    resolver_ok=true
  fi
  while [ "$have" -lt 4 ]; do
    if [ "$attempt" -ge "$SHARD_ALLOC_MAX_ATTEMPTS" ]; then
      echo "❌ allocate_shard_ports: cannot find 4 free pairwise-distinct ports in window $SHARD_PORT_WINDOW_LOW-$SHARD_PORT_WINDOW_HIGH after $SHARD_ALLOC_MAX_ATTEMPTS attempts (got $have of 4; busy args:${busy_raw:+ $busy_raw}). Inspect the LISTEN rows in /proc/net/tcp and /proc/net/tcp6 for the busy ports, free the window or re-run test-all." >&2
      return 1
    fi
    attempt=$((attempt + 1))
    port=$((SHARD_PORT_WINDOW_LOW + RANDOM % (SHARD_PORT_WINDOW_HIGH - SHARD_PORT_WINDOW_LOW + 1)))
    ok=true
    case "$busy" in *" $port "*) ok=false ;; esac        # live-lease port
    listed="${picked[*]:-}"
    case " $listed " in *" $port "*) ok=false ;; esac    # already picked
    if [ "$ok" = true ]; then
      if [ "$resolver_ok" = true ]; then
        case "$busy_ports" in *" $port "*) ok=false ;; esac   # sample: someone listens
      elif lsof -ti :"$port" >/dev/null 2>&1; then
        ok=false                                             # non-Linux fallback: legacy lsof
      fi
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

# _read_run_lease FILE → разбор+валидация ОДНОЙ строки лиза (формат
# write_run_lease: `pid tag p1 p2 p3 p4 started_epoch`). ЕДИНЫЙ парсер для
# sweep_dead_runs и audit_orphan_tagged — правило «жив/мёртв» обязано
# означать одно и то же в обоих (§3.3); вторая расходящаяся копия парсера
# запрещена. Успех → rc 0, поля в глобалах _RL_PID/_RL_TAG/_RL_P1.._RL_P4/
# _RL_STAMP (bash 3.2 без nameref'ов — глобалы с префиксом _RL_);
# неудача (файл не читается, пусто, ≠8 полей, pid/порты/штамп не числовые)
# → rc 1. Побочных эффектов нет — файл не трогается.
_read_run_lease() {
  local extra=""
  local num_re='^[0-9]+$'
  _RL_PID=""; _RL_TAG=""; _RL_P1=""; _RL_P2=""; _RL_P3=""; _RL_P4=""; _RL_STAMP=""
  if ! read -r _RL_PID _RL_TAG _RL_P1 _RL_P2 _RL_P3 _RL_P4 _RL_STAMP extra \
       < "$1" 2>/dev/null \
     || [ -z "$_RL_PID" ] || [ -z "$_RL_P1" ] || [ -z "$_RL_P2" ] \
     || [ -z "$_RL_P3" ] || [ -z "$_RL_P4" ] || [ -z "$_RL_STAMP" ] \
     || [ -n "$extra" ] \
     || ! [[ "$_RL_PID" =~ $num_re ]] || ! [[ "$_RL_P1" =~ $num_re ]] \
     || ! [[ "$_RL_P2" =~ $num_re ]] || ! [[ "$_RL_P3" =~ $num_re ]] \
     || ! [[ "$_RL_P4" =~ $num_re ]] || ! [[ "$_RL_STAMP" =~ $num_re ]]; then
    return 1
  fi
  return 0
}

# _run_lease_alive NOW → rc 0 ⇔ лиз, разобранный последним успешным
# _read_run_lease, ЖИВ: PID отвечает (kill -0) И возраст штампа
# (NOW − stamp) < SHARD_LEASE_MAX_AGE_S. Единственное правило живости
# (§3.3) — порог старения закрывает PID-перезанятие; им же пользуется
# sweep_dead_runs И audit_orphan_tagged (общий парсер — общая семантика).
_run_lease_alive() {
  local now="$1" age
  kill -0 "$_RL_PID" 2>/dev/null || return 1
  age=$(( now - _RL_STAMP ))
  [ "$age" -lt "$SHARD_LEASE_MAX_AGE_S" ]
}

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

# sweep_dead_runs → старт-чистка (§3.3 «Старт-чистка»; заменила kill_port_orphans —
# вызывающая сторона test-all.sh переподключена в #317 Task 4). Читает
# все ${SHARD_RUNS_DIR}/*.run (разбор строки и правило живости — ОБЩИЕ с
# audit_orphan_tagged: _read_run_lease + _run_lease_alive, расходящийся
# парсер запрещён):
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
  local f tag now
  local hex_re='^[0-9a-f]{6}$'
  now="$(date +%s 2>/dev/null || printf '%s' 0)"
  shopt -s nullglob
  for f in "$SHARD_RUNS_DIR"/*.run; do
    tag="${f##*/}"
    tag="${tag%.run}"
    if ! [[ "$tag" =~ $hex_re ]]; then
      echo "  ⚠️ sweep_dead_runs: ignoring foreign file $f (tag not 6-hex)" >&2
      continue
    fi
    if ! _read_run_lease "$f"; then
      echo "  ⚠️ sweep_dead_runs: malformed lease $f — removing the lease only (no port sweep)" >&2
      rm -f "$f" 2>/dev/null || true
      continue
    fi
    if _run_lease_alive "$now"; then
      # Живой прогон: порта → busy-лист аллокатора; прогон не трогается.
      printf '%s %s %s %s\n' "$_RL_P1" "$_RL_P2" "$_RL_P3" "$_RL_P4"
      echo "  → live run $tag (pid=$_RL_PID age=$(( now - _RL_STAMP ))s): ports $_RL_P1 $_RL_P2 $_RL_P3 $_RL_P4 bypassed" >&2
      continue
    fi
    echo "  → dead run $tag (pid=$_RL_PID age=$(( now - _RL_STAMP ))s): sweeping ports $_RL_P1 $_RL_P2 $_RL_P3 $_RL_P4" >&2
    DEAD_RUN_PORTS=("$_RL_P1" "$_RL_P2" "$_RL_P3" "$_RL_P4")
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

# ── Feature #317, spec §3.3: хвостовой аудит (анти-накопление) ──────────────

# _tag_of_entry BASENAME → stdout: 6-hex тег тегированного файлового
# ресурса, либо пусто. Тег — сегмент после ПОСЛЕДНЕГО `_`, усечённый до
# первой `.`: test_memo_shard1_aa1010.db / …_aa1010.canon.sql /
# …_aa1010.db-journal, test_files_shard1_aa1010, .next-shard-2_aa1010 →
# aa1010. Имя без валидного 6-hex суффикса (легаси без тега, lookalike с
# произвольным суффиксом) → пусто: НЕ цель аудита (lookalike'ы — дело
# вайпа, не аудита). Сама функция ничего не удаляет.
_tag_of_entry() {
  local tail="${1##*_}" tag
  local hex_re='^[0-9a-f]{6}$'
  tag="${tail%%.*}"
  if [[ "$tag" =~ $hex_re ]]; then
    printf '%s\n' "$tag"
  fi
  return 0
}

# _tag_of_run_dir BASENAME → stdout: тег каталога логов run-<6hex> (имя из
# §3.1) либо пусто — ТОЧНОЕ совпадение имени: run-notes, run-12345,
# run-ABCDEF (hex — только строчный), run-<tag>.log не являются целями.
_tag_of_run_dir() {
  local tag="${1#run-}"
  local hex_re='^[0-9a-f]{6}$'
  if [[ "$tag" =~ $hex_re ]]; then
    printf '%s\n' "$tag"
  fi
  return 0
}

# _dir_mtime PATH → stdout: mtime PATH в epoch-секундах. Портабельный
# выбор форм: BSD `stat -f %m` (macOS) → GNU `stat -c %Y` (Linux);
# ветвление — по ВАЛИДНОСТИ ВЫВОДА (числовая проверка), а не по uname:
# GNU stat с `-f %m` успешно печатает mount point (не число) — числовой
# фильтр это отсеивает и переключает на GNU-форму. Обе формы недоступны →
# rc 1 + пустой stdout; вызывающий трактует как «часы смерти неизвестны»
# и каталог НЕ удаляет (безопасная сторона льготы).
_dir_mtime() {
  local out
  out="$(stat -f %m "$1" 2>/dev/null || true)"
  case "$out" in ''|*[!0-9]*) out="$(stat -c %Y "$1" 2>/dev/null || true)" ;; esac
  case "$out" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$out"
}

# audit_orphan_tagged [CURRENT_TAG] → хвостовой аудит (§3.3 «Хвостовой
# аудит (анти-накопление)»); вызывается ПОСЛЕ обработки лизов. Правило:
# тегированный файл без живого лиза = мусор.
#   CURRENT_TAG — тег текущего прогона; может быть ПУСТЫМ (на момент
#     аудита test-all.sh тег может быть ещё не сгенерирован — ресурсов
#     несгенерированного тега не существует: gen_run_tag перегенерирует
#     при коллизии); пустой → ничто не защищено как «своё»; невалидный —
#     тоже (с предупреждением в stderr; непровалидированная строка не
#     участвует в решениях об удалении).
# Живость тега — ТО ЖЕ правило, что у sweep_dead_runs (PID жив И штамп
# < SHARD_LEASE_MAX_AGE_S; общий парсер _read_run_lease/_run_lease_alive —
# второй расходящийся парсер запрещён). Тег лиза = ИМЯ файла (как в свипе).
# ФАЗЫ ПРОГОНА ЗАФИКСИРОВАНЫ (чистка/аудит → аллокация → лиз → старт): на
# момент аудита у чужого нового прогона нет ни лиза, ни тегированных
# файлов — гонка исключена по построению (см. комментарий-контракт в
# scripts/test-all.sh).
# Файловые ресурсы тега (§3.1/§3.3): backend/test_memo_shard*_<tag>*,
# backend/test_files_shard*_<tag>, frontend/admin/.next-shard-*_<tag> —
# тег без живого лиза и не свой → удаляются БЕЗ льготы. Лог-каталоги
# ${SHARD_LOGS_DIR}/run-<tag> — тем же правилом, но с порогом 24 ч
# (падение прогона получает сутки на диагностику по логам): часы смерти
# тега = started_epoch мёртвого лиза, если файл лиза ещё существует; иначе
# mtime каталога (_dir_mtime). Удаление при now − часы > 86400.
# Лиз-файлы аудит НЕ трогает (это дело свипа); чужие *.run с не-6-hex
# тегом, имена без валидного 6-hex суффикса и не-каталоги run-* — не цели.
# Пустой/отсутствующий каталог лизов → аудит всё равно проходит по ФАЙЛОВЫМ
# ресурсам (первый прогон собирает брошенное). Best-effort: rc 0; stdout
# ПУСТ (диагностика — только stderr); недоступный mtime → каталог не
# удаляется. bash 3.2: индексированные массивы; живые теги — строка через
# пробел (тег = 6 hex, пробелы исключены форматом).
audit_orphan_tagged() {
  local hex_re='^[0-9a-f]{6}$'
  local own_tag="${1:-}"
  if [ -n "$own_tag" ] && ! [[ "$own_tag" =~ $hex_re ]]; then
    echo "  ⚠️ audit_orphan_tagged: invalid current tag '$own_tag' — protecting nothing as own" >&2
    own_tag=""
  fi
  local now
  now="$(date +%s 2>/dev/null || printf '%s' 0)"

  # Фаза 1: живые теги + часы смерти мёртвых — из лизов, общим парсером.
  local live_list=" " f tag i
  local dead_tags=() dead_stamps=()
  shopt -s nullglob
  for f in "$SHARD_RUNS_DIR"/*.run; do
    tag="${f##*/}"
    tag="${tag%.run}"
    [[ "$tag" =~ $hex_re ]] || continue      # чужой не-6-hex файл — мимо
    _read_run_lease "$f" || continue         # битый лиз — дело свипа
    if _run_lease_alive "$now"; then
      case "$live_list" in
        *" $tag "*) ;;
        *) live_list="$live_list$tag " ;;
      esac
    else
      dead_tags+=("$tag")
      dead_stamps+=("$_RL_STAMP")
    fi
  done

  # Фаза 2: файловые ресурсы тегов-сирот — БЕЗ льготы (rm по НАЙДЕННОМУ
  # glob-entry; тег в rm-маску не подставляется).
  local e t removed=0
  for e in "$ROOT"/backend/test_memo_shard*_* \
           "$ROOT"/backend/test_files_shard*_* \
           "$ROOT"/frontend/admin/.next-shard-*_*; do
    t="$(_tag_of_entry "${e##*/}")"
    [ -n "$t" ] || continue
    case "$live_list" in *" $t "*) continue ;; esac
    if [ "$t" = "$own_tag" ]; then continue; fi
    echo "  → audit: removing ownerless $e (tag $t has no live lease)" >&2
    rm -rf "$e" 2>/dev/null || true
    removed=$((removed + 1))
  done

  # Фаза 3: лог-каталоги run-<tag> — льгота 24 ч по часам смерти тега.
  local d clock age logs_removed=0
  for d in "$SHARD_LOGS_DIR"/run-*; do
    [ -d "$d" ] || continue
    t="$(_tag_of_run_dir "${d##*/}")"
    [ -n "$t" ] || continue
    case "$live_list" in *" $t "*) continue ;; esac
    if [ "$t" = "$own_tag" ]; then continue; fi
    clock=""
    i=0
    while [ "$i" -lt "${#dead_tags[@]}" ]; do
      if [ "${dead_tags[$i]}" = "$t" ]; then
        clock="${dead_stamps[$i]}"
        break
      fi
      i=$((i + 1))
    done
    if [ -z "$clock" ]; then
      # лиза нет → часы смерти = mtime каталога
      clock="$(_dir_mtime "$d" 2>/dev/null || true)"
    fi
    case "$clock" in
      ''|*[!0-9]*)
        echo "  → audit: keeping $d (death clock unknown — not removing)" >&2
        continue
        ;;
    esac
    age=$(( now - clock ))
    if [ "$age" -gt "$SHARD_LEASE_MAX_AGE_S" ]; then
      echo "  → audit: removing expired log dir $d (tag $t dead ${age}s > ${SHARD_LEASE_MAX_AGE_S}s)" >&2
      rm -rf "$d" 2>/dev/null || true
      logs_removed=$((logs_removed + 1))
    else
      echo "  → audit: keeping recent log dir $d (tag $t dead ${age}s ≤ ${SHARD_LEASE_MAX_AGE_S}s grace)" >&2
    fi
  done
  shopt -u nullglob
  if [ "$removed" -eq 0 ] && [ "$logs_removed" -eq 0 ]; then
    echo "  → audit: no orphan tagged resources" >&2
  fi
  return 0
}
