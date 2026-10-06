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
# Ёмкость машины = бюджет хоста на БОРДЕ (HOST_BUDGETS в gh_board.py:
# imac 2 / macbook 1) — карточки «In IMPL» с меткой этого хоста, считается
# внутри pick-next. Финишный менеджер, чья карточка ушла в PR (G7) на CI,
# НЕ считается (2026-09-21, решение юзера: карточка на CI не занимает
# IMPL слот) — карточка больше не в In IMPL. Реестр auto-impl.pids УДАЛЁН
# (2026-09-21): был дублем борд-бюджета, состояние живёт на борде. Открытые
# UI/TUI-окна и ручные сессии юзера без карточки In IMPL ёмкость не занимают
# (грабли 14.09: открытые окна блокировали конвейер). Заморозка машины без
# снятия флага: файл /root/.local/state/opencode/auto-impl-max = 0 (читается
# каждый цикл; env AUTO_IMPL_MAX_SESSIONS больше не используется).
# Выбор карточки: gh_board.py pick-next "$HOST_LABEL" (Next Up → первая
# Ready to IMPL; бюджет слотов своей машины по полю host; пропуск карточек
# со свежими записями и с незакрытыми depends-on из тела issue).
# Сверка стейл-карточек (2026-09-22): раз в цикл, ДО pick-next,
# gh_board.py reconcile "$HOST_LABEL" чинит два класса: (1) закрытый issue в
# In IMPL/PR (G7) — потерянный финальный флип → In-main/Not planned + строка
# merged; (2) In IMPL своего хоста с ЗАВИСШИМ прогоном — сессии в opencode.db
# молчат больше часа (CLI opencode run — лишь клиент-наблюдатель, он
# отваливается, пока сессия работает в сервере) → запись BLOCKED в
# auto-impl log (отдых CLAIM_TTL_HOURS, анти-crash-loop) + назад в
# Ready to IMPL. Проверка живости — по базе сессий, поэтому пункт 2 работает
# только из контейнера; с хоста (macOS) он пропускается.
# Владение карточкой = поле host на борде (единственный источник, 2026-09-20;
# CLAIM-комментарии больше не пишутся). Комментарий «auto-impl log:» на issue
# остаётся каналом BLOCKED-событий менеджера; свежая BLOCKED-запись —
# карточка отдыхает (CLAIM_TTL_HOURS = 1ч в gh_board.py). Блокер, ждущий
# юзера, дополнительно отмечается полем gate (значение blocked); снимается
# при ответе юзера в сессии. Возврат зависшего прогона СОХРАНЯЕТ blocked на
# Ready-карточке (решение юзера 26.09: ожидание юзера не прячется), и
# pick-next такие карточки пропускает — авто-повтора по ним нет.
# Побудка сирот (2026-09-27, кейс #324): карточка своего хоста в In IMPL /
# PR (G7) с молчащими сессиями и МЁРТВЫМ клиент-процессом не релизится
# сверкой сразу — наблюдатель будит сессию менеджера (gh_board.py orphans +
# продолжающее сообщение; маркер NUDGE-<kind> в auto-impl log = счётчик
# попыток, свежая побудка отдыхает CLAIM_TTL_HOURS = часовой темп).
# Правила побудок (2026-09-28, кейс #348 — ночь, где 4 из 5 побудок сгорели
# в закрытом квотном окне z.ai): (1) перед каждым пинком — тест апстрима
# llm_ping.sh (минимальный вызов модели; окно закрыто → пинок не тратится,
# маркер NUDGE не пишется); (2) бюджет: раз в час до NUDGE_BUDGET (24) за
# NUDGE_BUDGET_H (24ч) — исчерпан → In IMPL: Ready to IMPL + gate=blocked,
# PR (G7): gate=blocked (в обоих случаях ждёт юзера, виден на борде).
# Живой, но молчащий клиент побудке не подлежит (второй водитель запрещён).
# Пауза видима (2026-10-06, неделя #349): побудка, пропущенная по провалу
# пинга, ставит карточке gate=auto-retry — временная пауза в отличие от
# blocked «ждёт юзера» — и одну строку AUTO-RETRY в auto-impl log на начало
# паузы; при успешной побудке метка снимается. Установщик gate идемпотентен
# («gate unchanged» без записи) — звать можно каждый цикл без страха.
# Ежечасно impl_janitor.py прибивает остатки: процессы ворктри карточек вне
# In IMPL / PR (G7) (старше часа) и осиротевшие TUI-окна старше 12ч.

set -uo pipefail

REPO=/root/workspace/memo
STATE=/root/.local/state/opencode
LOG="$STATE/auto-impl-watch.log"
LOCK=/tmp/auto-impl-watch.lock
INTERVAL="${AUTO_IMPL_INTERVAL:-180}"
TIEBREAK_WAIT=6   # сек: окно, в котором второй наблюдатель успевает перезаписать поле host

cd "$REPO" || exit 1
mkdir -p "$STATE"
exec >>"$LOG" 2>&1

# Stale-lock guard (2026-10-04, #349 frozen in In IMPL for 5 days): a plain
# container restart keeps /tmp but restarts the PID namespace, so the old lock
# PID is almost always reused by one of the boot processes and the bare
# kill -0 check made the freshly started watcher exit with a silent
# "already running" (3rd case 2026-10-03 21:51; earlier 09-25, 09-27).
# The lock counts as live only when /proc/<pid>/cmdline IS this watcher
# script; a reused PID of any other process — including the entrypoint
# wrapper, whose cmdline merely mentions the script — falls through and the
# stale lock is replaced below.
lock_pid="$(cat "$LOCK" 2>/dev/null || true)"
if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null \
   && tr '\0' '\n' < "/proc/$lock_pid/cmdline" 2>/dev/null \
      | grep -Fxq "$REPO/.opencode/scripts/auto_impl_watch.sh"; then
    echo "$(date -Is) watcher already running (pid $lock_pid)"
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

    # ёмкость решает борд (HOST_BUDGETS по In IMPL+host внутри pick-next;
    # карточка на CI, статус PR (G7), не считается). Здесь — только ручная
    # заморозка машины без снятия флага: auto-impl-max = 0.
    if [ "$(cat "$STATE/auto-impl-max" 2>/dev/null || true)" = "0" ]; then
        continue
    fi

    # сверка стейл-карточек ДО выбора: чинить надо до захвата новых
    python3 .opencode/scripts/gh_board.py reconcile "$HOST_LABEL" \
        || echo "$(date -Is) reconcile failed"

    # ежечасный уборщик остатков (2026-09-28, кейс #324): процессы ворктри
    # неактивных карточек и осиротевшие TUI-окна; сам троттлится меткой
    # lastrun — звать можно каждый цикл
    python3 "$REPO/.opencode/scripts/impl_janitor.py" \
        || echo "$(date -Is) janitor failed"

    # побудка сирот (2026-09-27, кейс #324): карточки своего хоста в In IMPL /
    # PR (G7), чьи сессии молчат >1ч и чей клиент-процесс мёртв. reconcile НЕ
    # релизит их, пока не исчерпан бюджет побудок (NUDGE_BUDGET/NUDGE_BUDGET_H
    # в gh_board.py: раз в час до 24 за сутки) — здесь шлём продолжающее
    # сообщение в существующую сессию менеджера и пишем маркер NUDGE-<kind> в
    # auto-impl log (счётчик попыток). Перед пинком — тест апстрима llm_ping.sh:
    # закрытое квотное окно не съедает побудку. Живой клиент-процесс побудке не
    # подлежит (второй водитель запрещён).
    python3 .opencode/scripts/gh_board.py orphans "$HOST_LABEL" 2>/dev/null |
    while read -r OKIND ONUM; do
        case "$OKIND" in impl|pr) : ;; *) continue ;; esac
        case "$ONUM" in ''|*[!0-9]*) continue ;; esac
        # тест апстрима перед пинком (2026-09-28): окно закрыто — будить некого.
        # Пауза видима (2026-10-06): gate=auto-retry на карточке + одна строка
        # AUTO-RETRY в лог на начало паузы; снимется при успешной побудке ниже.
        if ! bash "$REPO/.opencode/scripts/llm_ping.sh"; then
            echo "$(date -Is) #$ONUM nudge skipped: upstream LLM unavailable (ping failed)"
            GOUT=$(python3 .opencode/scripts/gh_board.py gate "$ONUM" auto-retry 2>/dev/null) || GOUT=""
            if [ "$GOUT" = "#$ONUM: gate → auto-retry" ]; then
                python3 .opencode/scripts/gh_board.py auto-log "$ONUM" \
                    "AUTO-RETRY: побудки приостановлены — апстрим недоступен (провал проверки моделей) с $(date -u +%FT%TZ); конвейер продолжит сам, когда апстрим ответит" >/dev/null 2>&1 || true
            fi
            continue
        fi
        OSID=$(sqlite3 /root/.local/share/opencode/opencode.db \
            "select id from session where title like '%#${ONUM} IMPL.%' order by rowid desc limit 1" 2>/dev/null)
        [ -z "$OSID" ] && continue
        if [ "$OKIND" = "pr" ]; then
            OMSG="Auto-IMPL nudge: финал ветки прервался во время недоступности LLM (владелец-менеджер молчал больше часа). Продолжи диспатч 2 по своей карточке: проверь чеки PR — зелёные: мерж и штатный finishing (борд In-main, закрытие issue, сдвиг очереди); красные или продолжать не можешь: допиши в «auto-impl log:» строку «auto-impl blocked: <упавшие чеки>» и поставь метку: python3 .opencode/scripts/gh_board.py gate $ONUM blocked — и стоп."
        else
            OMSG="Auto-IMPL nudge: прогон прервался во время недоступности LLM (сессии молчали больше часа, клиент-процесс мёртв). Продолжи выполнение плана с места остановки: проверь состояние последнего таска/диспатча и продолжай. Если упрёшься в вопрос к пользователю — «auto-impl blocked: …» в лог и python3 .opencode/scripts/gh_board.py gate $ONUM blocked, и стоп."
        fi
        nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
            --session "$OSID" "$OMSG" > "$STATE/auto-impl-$ONUM-nudge.log" 2>&1 &
        echo "$(date -Is) #$ONUM nudge ($OKIND) sent (session $OSID, log: $STATE/auto-impl-$ONUM-nudge.log)"
        python3 .opencode/scripts/gh_board.py auto-log "$ONUM" "NUDGE-$OKIND: auto-nudge sent (owner sessions silent >60 min, client process dead)" >/dev/null 2>&1 || true
        # пауза кончилась — снять auto-retry, если стояла (строго: только своё
        # значение; blocked сюда не доходит — orphans их отфильтровал)
        CURGATE=$(python3 .opencode/scripts/gh_board.py show "$ONUM" 2>/dev/null | awk '/^  Gate:/{print $2}')
        if [ "$CURGATE" = "auto-retry" ]; then
            python3 .opencode/scripts/gh_board.py gate "$ONUM" none >/dev/null 2>&1 || true
        fi
    done

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
        MSG="Auto-IMPL retry: время отдыха по прежнему блокеру прошло — переоцени гейты и продолжай работу (если на карточке стоял gate=blocked — сними: gh_board.py gate $N none). Если блокер ещё в силе — снова auto-impl blocked (и gate blocked, если он ждёт пользователя) и стоп, ничего не начиная."
        # --attach: сессия живёт на работающем сервере (:4096) — сразу видна в вебе
        nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
            --session "$SID" "$MSG" > "$STATE/auto-impl-$N.log" 2>&1 &
    else
        HANDOFF="Авто-IMPL: карточка #$N взята из Ready to IMPL (статус уже In IMPL). Организуй IMPL по её спеке и плану из репо. ПЕРЕД СТАРТОМ проверь гейты плана (T0): если зависимость не смержена или в плане открытое юзер-решение — верни карточку на борде в статус Ready to IMPL, а на issue ДОПОЛНИ комментарий, начинающийся с «auto-impl log:», строкой «auto-impl blocked: <причина>» (gh issue view $N --json comments → найди id → gh api -X PATCH repos/mkosinov/memo/issues/comments/<id> -f body=<весь текст с новой строкой>; не выходит — создай обычный комментарий с тем же началом), и остановись, ничего не начиная. Блокеры по ходу работы — так же допиши «auto-impl blocked: …»; карточку в Ready to IMPL не возвращать. Блокер, который ждёт решения пользователя, ДОПОЛНИТЕЛЬНО отметь полем gate на борде: python3 .opencode/scripts/gh_board.py gate $N blocked (снял блокер и продолжил — gh_board.py gate $N none; обычный уход карточки из In IMPL снимает автоматически, а возврат зависшего прогона СОХРАНЯЕТ blocked на Ready-карточке). Если юзер ответил на блокер в сессии opencode, а карточка после возврата лежит в Ready to IMPL с gate=blocked — верни её в In IMPL: python3 .opencode/scripts/gh_board.py status $N \"In IMPL\" (host проставится сам), сними gate (gh_board.py gate $N none) и продолжай. Зависимостные блокеры (мерж не случился) gate НЕ ставят — они снимаются сами. По завершении — штатный finishing: PR, борд In-main, сдвиг очереди."
        # --attach: сессия создаётся на работающем сервере (:4096) — сразу видна в вебе
        nohup opencode run --attach "http://localhost:${OPENCODE_PORT:-4096}" --dir "$REPO" \
            --title "$TITLE" "$HANDOFF" > "$STATE/auto-impl-$N.log" 2>&1 &
    fi
    echo "$(date -Is) #$N launched (pid $!, session: ${SID:-new}, title: $TITLE, log: $STATE/auto-impl-$N.log)"
done
