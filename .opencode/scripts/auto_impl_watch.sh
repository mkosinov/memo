#!/usr/bin/env bash
# auto_impl_watch.sh — контейнерный наблюдатель IMPL-конвейера memo.
#
# Инвариант (раз в INTERVAL): если есть карточка Ready to IMPL, доступная
# этому наблюдателю, — захватить её (статус In IMPL + поле host на борде)
# и запустить фоном `opencode run` (дефолтный агент memo = manager).
# ГЛОБАЛЬНОГО мьютекса и глобального бюджета нет: слоты ПО МАШИНАМ
# (HOST_BUDGETS в gh_board.py, imac 2 / macbook 1); гонку за одну карточку
# ломает тайбрейк по полю host (запись, пауза, перечитывание — владеет
# последний писавший, ранний отходит).
#
# Старт:  docker exec -d opencode bash /root/workspace/memo/.opencode/scripts/auto_impl_watch.sh
# Стоп:   docker exec opencode pkill -f '^bash /root/workspace/memo/.opencode/scripts/auto_impl_watch\.sh$'
#         ВАЖНО: якоря ^…$ обязательны — без них pkill -f убивает и entrypoint-обёртку
#         контейнера (в её cmdline тоже есть имя скрипта) → контейнер перезапускается
#         по restart-политике и ГИБНУТ все живые сессии менеджеров (инцидент 2026-09-20).
# Вкл.:   docker exec opencode touch /root/.local/state/opencode/auto-impl.enabled
# Выкл.:  docker exec opencode rm -f /root/.local/state/opencode/auto-impl.enabled
#
# Метка хоста: /root/.local/state/opencode/auto-impl-host — должна совпадать
# с вариантом поля host на борде ("imac"/"macbook";hk/gcp зарезервированы).
# Повторные попытки по issue ПРОДОЛЖАЮТ существующую сессию менеджера
# (opencode run --session <id>): id берётся из БД — последняя сессия с
# названием «<N> IMPL. …». Отдельного реестра сессий нет, БД = источник истины.
# Ёмкость машины (сколько ЗАПУСКОВ наблюдателя может быть в полёте):
#   1) env AUTO_IMPL_MAX_SESSIONS (compose, применяется при recreate контейнера);
#   2) файл /root/.local/state/opencode/auto-impl-max (перекрывает env, читается
#      каждый цикл — можно менять на живую без recreate).
# По умолчанию 1. «Занято» = число живых PID в реестре запусков наблюдателя
# (auto-impl.pids: "PID issue"); процесс менеджера завершился → слот свободен.
# Открытые UI/TUI-окна и ручные сессии юзера ёмкость НЕ занимают (грабли
# 14.09: открытые окна блокировали конвейер).
# Выбор карточки: gh_board.py pick-next "$HOST_LABEL" (Next Up → первая
# Ready to IMPL; бюджет слотов своей машины по полю host; пропуск карточек
# со свежими записями и с незакрытыми depends-on из тела issue).
# Владение карточкой = поле host на борде (единственный источник, 2026-09-20;
# CLAIM-комментарии больше не пишутся). Комментарий «auto-impl log:» на issue
# остаётся каналом BLOCKED-событий менеджера; свежая BLOCKED-запись —
# карточка отдыхает (CLAIM_TTL_HOURS = 1ч в gh_board.py).

set -uo pipefail

REPO=/root/workspace/memo
STATE=/root/.local/state/opencode
LOG="$STATE/auto-impl-watch.log"
LOCK=/tmp/auto-impl-watch.lock
PIDS_FILE="$STATE/auto-impl.pids"
INTERVAL="${AUTO_IMPL_INTERVAL:-180}"
TIEBREAK_WAIT=6   # сек: окно, в котором второй наблюдатель успевает перезаписать поле host

cd "$REPO" || exit 1
mkdir -p "$STATE"
touch "$PIDS_FILE"
exec >>"$LOG" 2>&1

if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    echo "$(date -Is) watcher already running"
    exit 1
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

HOST_LABEL=$(cat "$STATE/auto-impl-host" 2>/dev/null || hostname)
export GH_BOARD_HOST="$HOST_LABEL"   # gh_board.py подставляет метку в pick-next и status
echo "=== auto-impl watcher start $(date -Is) host=$HOST_LABEL interval=${INTERVAL}s ==="

while true; do
    sleep "$INTERVAL"

    [ -f "$STATE/auto-impl.enabled" ] || continue

    # локальная ёмкость: живые запуски ТОЛЬКО этого наблюдателя (реестр PID).
    # Мёртвые PID вычищаются на каждом цикле: процесс менеджера завершился —
    # слот свободен. UI/TUI-окна и ручные сессии юзера не считаются.
    MAX=$(cat "$STATE/auto-impl-max" 2>/dev/null || echo "${AUTO_IMPL_MAX_SESSIONS:-1}")
    if [ -f "$PIDS_FILE" ]; then
        awk '{ if (system("kill -0 " $1 " 2>/dev/null") == 0) print }' "$PIDS_FILE" > "$PIDS_FILE.tmp" \
            && mv "$PIDS_FILE.tmp" "$PIDS_FILE"
    fi
    COUNT=$(wc -l < "$PIDS_FILE" 2>/dev/null || echo 0)
    if [ "${COUNT:-0}" -ge "$MAX" ]; then
        continue
    fi

    PICK=$(python3 .opencode/scripts/gh_board.py pick-next "$HOST_LABEL") || { echo "$(date -Is) board query failed: $PICK"; continue; }
    case "$PICK" in
        NONE|"") continue ;;
        *[!0-9]*) echo "$(date -Is) unexpected pick output: $PICK"; continue ;;
    esac
    N="$PICK"

    # захват одним действием: статус In IMPL + поле host (GH_BOARD_HOST экспортирован)
    echo "$(date -Is) claiming #$N on $HOST_LABEL"
    if ! python3 .opencode/scripts/gh_board.py status "$N" "In IMPL"; then
        echo "$(date -Is) status claim failed — skip"
        continue
    fi

    # тайбрейк гонки: после TIEBREAK_WAIT поле host на карточке должно быть
    # нашим (два наблюдателя могли захватить одновременно; владеет последний
    # писавший, ранний молча отходит)
    sleep "$TIEBREAK_WAIT"
    OWNER=$(python3 .opencode/scripts/gh_board.py host "$N" 2>/dev/null) || OWNER=""
    case "$OWNER" in
        "$HOST_LABEL") : ;;
        *) echo "$(date -Is) #$N lost claim race (owner=${OWNER:-none}) — back off"; continue ;;
    esac

    # свежий харнесс перед стартом
    git pull --ff-only >/dev/null 2>&1 || echo "$(date -Is) WARN: git pull failed, starting on current tree"

    # сессия менеджера по issue: повторный запуск ПРОДОЛЖАЕТ существующую.
    # Источник истины — БД: последняя сессия с названием «<N> IMPL. …»
    SID=$(sqlite3 /root/.local/share/opencode/opencode.db \
        "select id from session where title like '%#${N} IMPL.%' order by rowid desc limit 1" 2>/dev/null)

    # шаблон названия сессии: "#issue IMPL. 1-5 ключевых слова" (из заголовка issue)
    ITITLE=$(gh issue view "$N" --json title --jq .title 2>/dev/null || echo "")
    KEYWORDS=$(printf '%s' "$ITITLE" | awk '{out=""; for(i=1;i<=5&&i<=NF;i++) out=out (i>1?" ":"") $i; print out; exit}')
    TITLE="#${N} IMPL. ${KEYWORDS:-интерактив}"

    if [ -n "$SID" ]; then
        echo "$(date -Is) #$N → continue session $SID"
        MSG="Auto-IMPL retry: время отдыха по прежнему блокеру прошло — переоцени гейты и продолжай работу. Если блокер ещё в силе — снова auto-impl blocked и стоп, ничего не начиная."
        # --attach: сессия живёт на работающем сервере (:4096) — сразу видна в вебе
        nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
            --session "$SID" "$MSG" > "$STATE/auto-impl-$N.log" 2>&1 &
    else
        HANDOFF="Авто-IMPL: карточка #$N взята из Ready to IMPL (статус уже In IMPL). Организуй IMPL по её спеке и плану из репо. ПЕРЕД СТАРТОМ проверь гейты плана (T0): если зависимость не смержена или в плане открытое юзер-решение — верни карточку на борде в статус Ready to IMPL, а на issue ДОПОЛНИ комментарий, начинающийся с «auto-impl log:», строкой «auto-impl blocked: <причина>» (gh issue view $N --json comments → найди id → gh api -X PATCH repos/mkosinov/memo/issues/comments/<id> -f body=<весь текст с новой строкой>; не выходит — создай обычный комментарий с тем же началом), и остановись, ничего не начиная. Блокеры по ходу работы — так же допиши «auto-impl blocked: …»; карточку в Ready to IMPL не возвращать. По завершении — штатный finishing: PR, борд In-main, сдвиг очереди."
        # --attach: сессия создаётся на работающем сервере (:4096) — сразу видна в вебе
        nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
            --title "$TITLE" "$HANDOFF" > "$STATE/auto-impl-$N.log" 2>&1 &
    fi
    echo "$! #$N" >> "$PIDS_FILE"
    echo "$(date -Is) #$N launched (pid $!, session: ${SID:-new}, title: $TITLE, log: $STATE/auto-impl-$N.log)"
done
