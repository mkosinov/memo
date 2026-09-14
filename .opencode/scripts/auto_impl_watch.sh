#!/usr/bin/env bash
# auto_impl_watch.sh — контейнерный наблюдатель IMPL-конвейера memo.
#
# Инвариант (раз в INTERVAL): если есть карточка Ready to IMPL, доступная
# этому наблюдателю, — захватить её (комментарий-замок + статус In IMPL)
# и запустить фоном `opencode run` (дефолтный агент memo = manager).
# ГЛОБАЛЬНОГО мьютекса нет: две машины могут вести разные карточки
# параллельно; гонку за одну карточку ломает тайбрейк по комментариям
# (пост-замок, пауза, выигрывает самый ранний claim).
#
# Старт:  docker exec -d opencode bash /root/workspace/memo/.opencode/scripts/auto_impl_watch.sh
# Стоп:   docker exec opencode pkill -f auto_impl_watch
# Вкл.:   docker exec opencode touch /root/.local/state/opencode/auto-impl.enabled
# Выкл.:  docker exec opencode rm -f /root/.local/state/opencode/auto-impl.enabled
#
# Метка хоста: /root/.local/state/opencode/auto-impl-host ("imac"/"laptop").
# Ёмкость машины (сколько сессий opencode всего допускается):
#   1) env AUTO_IMPL_MAX_SESSIONS (compose, применяется при recreate контейнера);
#   2) файл /root/.local/state/opencode/auto-impl-max (перекрывает env, читается
#      каждый цикл — можно менять на живую без recreate).
# По умолчанию 1. Считаются ВСЕ процессы opencode, кроме сервера opencode web.
# Выбор карточки: gh_board.py pick-next (Next Up → первая Ready to IMPL;
# пропуск карточек со свежими замками и с незакрытыми depends-on из тела issue).
# Захваченная карточка имеет префикс комментария "auto-impl claim:",
# менеджер при неготовом гейте возвращает её в Ready to IMPL с комментарием
# "auto-impl blocked: ..." — оба префикса дают карточке отдых CLAIM_TTL_HOURS
# (1ч, константа в gh_board.py), чтобы конвейер не долбил её впустую.

set -uo pipefail

REPO=/root/workspace/memo
STATE=/root/.local/state/opencode
LOG="$STATE/auto-impl-watch.log"
LOCK=/tmp/auto-impl-watch.lock
INTERVAL="${AUTO_IMPL_INTERVAL:-180}"
TIEBREAK_WAIT=6   # сек: окно, в котором второй наблюдатель успевает поставить свой claim

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

    # локальная ёмкость: считаем ВСЕ живые процессы opencode (TUI-сессии и
    # CLI-прогоны; постоянный сервер `opencode web` не считаем). Если их
    # уже MAX_SESSIONS — машина заполнена, наблюдатель ждёт.
    MAX=$(cat "$STATE/auto-impl-max" 2>/dev/null || echo "${AUTO_IMPL_MAX_SESSIONS:-1}")
    COUNT=0
    for p in $(pgrep -x opencode 2>/dev/null); do
        CMD=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
        case "$CMD" in
            *"opencode web"*) : ;;
            opencode*) COUNT=$((COUNT+1)) ;;
        esac
    done
    if [ "$COUNT" -ge "$MAX" ]; then
        continue
    fi

    PICK=$(python3 .opencode/scripts/gh_board.py pick-next 2>/dev/null) || { echo "$(date -Is) board query failed"; continue; }
    case "$PICK" in
        NONE|"") continue ;;
        *[!0-9]*) echo "$(date -Is) unexpected pick output: $PICK"; continue ;;
    esac
    N="$PICK"

    echo "$(date -Is) claiming #$N on $HOST_LABEL"
    gh issue comment "$N" --body "auto-impl claim: host=$HOST_LABEL at $(date -Is)" >/dev/null 2>&1 \
        || { echo "$(date -Is) claim comment failed — skip"; continue; }

    # тайбрейк гонки: через TIEBREAK_WAIT самый ранний claim должен быть нашим
    sleep "$TIEBREAK_WAIT"
    FIRST=$(gh issue view "$N" --json comments \
        --jq '[.comments[] | select(.body | startswith("auto-impl claim:"))] | sort_by(.createdAt) | first | .body // empty' 2>/dev/null) || FIRST=""
    case "$FIRST" in
        *"host=$HOST_LABEL "*) : ;;
        *) echo "$(date -Is) #$N lost claim race — back off"; continue ;;
    esac

    # захват статуса ДО запуска сессии
    if ! python3 .opencode/scripts/gh_board.py status "$N" "In IMPL"; then
        echo "$(date -Is) status claim failed — skip"
        continue
    fi

    # свежий харнесс перед стартом
    git pull --ff-only >/dev/null 2>&1 || echo "$(date -Is) WARN: git pull failed, starting on current tree"

    # шаблон названия сессии: "#issue IMPL. 1-5 ключевых слова" (из заголовка issue)
    ITITLE=$(gh issue view "$N" --json title --jq .title 2>/dev/null || echo "")
    KEYWORDS=$(printf '%s' "$ITITLE" | awk '{out=""; for(i=1;i<=5&&i<=NF;i++) out=out (i>1?" ":"") $i; print out; exit}')
    TITLE="#${N} IMPL. ${KEYWORDS:-интерактив}"

    HANDOFF="Авто-IMPL: карточка #$N взята из Ready to IMPL (статус уже In IMPL). Организуй IMPL по её спеке и плану из репо. ПЕРЕД СТАРТОМ проверь гейты плана (T0): если зависимость не смержена или в плане открытое юзер-решение — верни карточку на борде в статус Ready to IMPL, оставь на issue комментарий, начинающийся с «auto-impl blocked: <причина>», и остановись, ничего не начиная. Блокеры по ходу работы — тоже комментарий «auto-impl blocked: …» на issue; карточку при этом в Ready to IMPL не возвращать. По завершении — штатный finishing: PR, борд In-main, сдвиг очереди."
    # --attach: сессия создаётся на работающем сервере (:4096) — сразу видна в вебе
    nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
        --title "$TITLE" "$HANDOFF" > "$STATE/auto-impl-$N.log" 2>&1 &
    echo "$(date -Is) #$N launched (pid $!), title: $TITLE, session log: $STATE/auto-impl-$N.log"
done
