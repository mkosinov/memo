#!/usr/bin/env bash
# auto_impl_watch.sh — контейнерный наблюдатель IMPL-конвейера memo.
#
# Инвариант (раз в INTERVAL): если на борде есть карточка Ready to IMPL,
# нет ни одной In IMPL и на этой машине нет живой сессии менеджера —
# захватить карточку (статус In IMPL + комментарий-замок с меткой хоста)
# и запустить фоном `opencode run` (дефолтный агент memo = manager).
# Сессия попадает в общее хранилище и видна в вебе (:4096).
#
# Старт:  docker exec -d opencode bash /root/workspace/memo/.opencode/scripts/auto_impl_watch.sh
# Стоп:   docker exec opencode pkill -f auto_impl_watch
# Вкл.:   docker exec opencode touch /root/.local/state/opencode/auto-impl.enabled
# Выкл.:  docker exec opencode rm -f /root/.local/state/opencode/auto-impl.enabled
#
# Метка хоста для комментариев-замков: /root/.local/state/opencode/auto-impl-host
# (например "imac" или "laptop"; иначе используется hostname контейнера).
# Выбор карточки: gh_board.py pick-next (Next Up 1 → первая Ready to IMPL).
# Замок: комментарий на issue "auto-impl claim: host=..." — если свежий клейм
# (12ч) уже есть, карточка пропускается. Кандидат с этим префиксом пишется
# ТОЛЬКО наблюдателем.

set -uo pipefail

REPO=/root/workspace/memo
STATE=/root/.local/state/opencode
LOG="$STATE/auto-impl-watch.log"
LOCK=/tmp/auto-impl-watch.lock
INTERVAL="${AUTO_IMPL_INTERVAL:-180}"
CLAIM_TTL=43200   # 12ч: свежесть комментария-замка

cd "$REPO" || exit 1
mkdir -p "$STATE"
exec >>"$LOG" 2>&1

if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    echo "$(date -Is) watcher already running"
    exit 1
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

HOST_LABEL=$(cat "$STATE/auto-impl-host" 2>/dev/null || hostname)
echo "=== auto-impl watcher start $(date -Is) host=$HOST_LABEL interval=${INTERVAL}s ==="

while true; do
    sleep "$INTERVAL"

    [ -f "$STATE/auto-impl.enabled" ] || continue

    # локально: не запускаем вторую сессию
    if pgrep -f "opencode run" >/dev/null 2>&1; then
        continue
    fi

    PICK=$(python3 .opencode/scripts/gh_board.py pick-next 2>/dev/null) || { echo "$(date -Is) board query failed"; continue; }
    case "$PICK" in
        BUSY|NONE|"") continue ;;
        *[!0-9]*) echo "$(date -Is) unexpected pick output: $PICK"; continue ;;
    esac
    N="$PICK"

    # распределённый замок: свежий чужой клейм → пропуск
    CLAIMED_AT=$(gh issue view "$N" --json comments \
        --jq '[.comments[] | select(.body | startswith("auto-impl claim:"))] | sort_by(.createdAt) | last | .createdAt // empty' 2>/dev/null) || CLAIMED_AT=""
    if [ -n "$CLAIMED_AT" ]; then
        AGE=$(( $(date +%s) - $(date -d "$CLAIMED_AT" +%s 2>/dev/null || echo 0) ))
        if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$CLAIM_TTL" ]; then
            echo "$(date -Is) #$N claimed ${AGE}s ago by another run — skip"
            continue
        fi
    fi

    echo "$(date -Is) claiming #$N on $HOST_LABEL"
    gh issue comment "$N" --body "auto-impl claim: host=$HOST_LABEL at $(date -Is)" >/dev/null 2>&1 \
        || { echo "$(date -Is) claim comment failed — skip"; continue; }

    # захват статуса ДО запуска сессии
    if ! python3 .opencode/scripts/gh_board.py status "$N" "In IMPL"; then
        echo "$(date -Is) status claim failed — skip"
        continue
    fi

    # свежий харнесс перед стартом
    git pull --ff-only >/dev/null 2>&1 || echo "$(date -Is) WARN: git pull failed, starting on current tree"

    HANDOFF="Авто-IMPL: карточка #$N взята из Ready to IMPL (статус уже In IMPL). Организуй IMPL по её спеке и плану из репо. Перед стартом проверь гейты плана: если зависимость не смержена или в плане открытое юзер-решение — остановись и оставь комментарий на issue, ничего не начинай. Блокеры по ходу — стоп и комментарий на issue, решений не изобретать. По завершении — штатный finishing: PR, борд In-main, сдвиг очереди."
    nohup opencode run "$HANDOFF" > "$STATE/auto-impl-$N.log" 2>&1 &
    echo "$(date -Is) #$N launched (pid $!), session log: $STATE/auto-impl-$N.log"
done
