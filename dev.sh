#!/usr/bin/env bash
set -e

# Allow dev.sh to run in non-TTY contexts (backgrounded, scripts, CI, nohup).
# pnpm 11+ prompts to confirm modules purge when no TTY is detected, which
# aborts the dev server. Setting CI=true tells pnpm to skip the prompt.
# Override with `CI=false ./dev.sh` to force interactive prompts (rare).
export CI="${CI:-true}"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/frontend/web"
ADMIN_DIR="$ROOT_DIR/frontend/admin"

# Ensure pnpm is available
export PATH="/root/.npm-global/bin:$PATH"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Port check helper ────────────────────────────────────────────
_port_in_use() {
    local port=$1
    timeout 1 bash -c "(: </dev/tcp/localhost/$port) 2>/dev/null" && return 0
    return 1
}

_ensure_port_free() {
    local port=$1
    if _port_in_use "$port"; then
        echo -e "${YELLOW}  ⚠ Port $port already in use — skipping${NC}"
        return 1
    fi
    return 0
}

# ── Parse arguments ────────────────────────────────────────────────
RESTART=false
ADMIN_MODE=false
NOTIFY_MODE=false
for arg in "$@"; do
    case "$arg" in
        -r|--restart) RESTART=true ;;
        --admin|-a)   ADMIN_MODE=true ;;
        --notify)     NOTIFY_MODE=true ;;
    esac
done

# Notify child PIDs (--notify section below); empty when the flag is off
REDIS_PID=""
DISPATCHER_PID=""
WORKER_PID=""

# ── Kill dev processes (--restart) ────────────────────────────────
if $RESTART; then
    echo -e "${YELLOW}Restart mode — killing existing processes...${NC}"
    # Kill all uvicorn variants (src.main:app or src.main:create_app --factory)
    pkill -f "uvicorn src.main" 2>/dev/null && echo -e "${YELLOW}  Killed backend${NC}" || true
    # Kill all next dev processes
    pkill -f "next dev" 2>/dev/null && echo -e "${YELLOW}  Killed frontend(s)${NC}" || true
    # Kill turbo
    pkill -f "turbo" 2>/dev/null && echo -e "${YELLOW}  Killed turbo${NC}" || true
    sleep 2
    # Force-free ports to clear any lingering orphan processes
    fuser -k 8000/tcp 2>/dev/null || true
    fuser -k 3000/tcp 2>/dev/null || true
    fuser -k 3001/tcp 2>/dev/null || true
    sleep 1
fi

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
    [ -n "$ADMIN_PID" ] && kill "$ADMIN_PID" 2>/dev/null
    # `|| true`: a child may already be dead (e.g. a failed dispatcher) —
    # its `kill` would return 1 and, under set -e, abort cleanup BEFORE
    # the remaining children get killed (orphaned redis/worker).
    [ -n "$DISPATCHER_PID" ] && kill "$DISPATCHER_PID" 2>/dev/null || true
    [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
    [ -n "$REDIS_PID" ] && kill "$REDIS_PID" 2>/dev/null || true
    wait 2>/dev/null
    echo -e "${GREEN}Done.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Notify contour (--notify, spec §3.5) ──────────────────────────
# The notify contour uses a DEDICATED Redis: silently reusing someone
# else's answering instance is forbidden (stream payloads carry PII).
if $NOTIFY_MODE; then
    export NOTIFY_ENABLED=true
    if [ -n "${REDIS_URL:-}" ]; then
        # Explicit REDIS_URL — a conscious choice of another instance:
        # no port check, no own redis-server.
        echo -e "${BLUE}Notify: REDIS_URL set explicitly — not starting a local redis-server${NC}"
    else
        export REDIS_URL="redis://localhost:6379/0"
        if _port_in_use 6379; then
            echo -e "${YELLOW}  ✗ Port 6379 already in use — notify contour cannot start${NC}" >&2
            echo -e "${YELLOW}    Free the port or set REDIS_URL explicitly (a conscious choice of another instance)${NC}" >&2
            exit 1
        fi
        echo -e "${BLUE}Starting redis-server (ephemeral: --save \"\" --appendonly no) on :6379...${NC}"
        redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no &
        REDIS_PID=$!
        # Let redis accept connections before the dispatcher/worker
        # fail-fast gates (empty URL / failed PING → exit 2) fire.
        sleep 1
    fi
fi

# ── Seed DB if not exists ──────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/memo.db" ]; then
    echo -e "${BLUE}Seeding database...${NC}"
    (cd "$BACKEND_DIR" && PYTHONPATH=src uv run python -m seed.seed)
    echo -e "${GREEN}Database seeded.${NC}"
fi

# ── Create .env from .env.dev if not exists ─────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ] && [ -f "$BACKEND_DIR/.env.dev" ]; then
    echo -e "${BLUE}Creating .env from .env.dev...${NC}"
    cp "$BACKEND_DIR/.env.dev" "$BACKEND_DIR/.env"
    echo -e "${GREEN}.env created.${NC}"
fi

# ── Start backend ──────────────────────────────────────────────────
if _ensure_port_free 8000; then
    echo -e "${BLUE}Starting backend (FastAPI) on :8000...${NC}"
    export ENV_FILE=.env.dev
    (cd "$BACKEND_DIR" && uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload) &
    BACKEND_PID=$!
fi

# ── Start notify dispatcher + worker (--notify) ───────────────────
# Spawned via the project venv python with `exec` so $! is the real
# process: `uv run` does not forward SIGTERM to its child, which would
# orphan the dispatcher/worker on stack shutdown.
if $NOTIFY_MODE; then
    echo -e "${BLUE}Starting notify dispatcher...${NC}"
    (cd "$BACKEND_DIR" && ENV_FILE=.env.dev exec .venv/bin/python -m src.notify.dispatcher) &
    DISPATCHER_PID=$!
    echo -e "${BLUE}Starting notify worker (skeleton)...${NC}"
    (cd "$BACKEND_DIR" && ENV_FILE=.env.dev exec .venv/bin/python -m src.notify.worker) &
    WORKER_PID=$!
fi

# ── Start frontend/web ─────────────────────────────────────────────
if _ensure_port_free 3000; then
    echo -e "${BLUE}Starting frontend/web (Next.js) on :3000...${NC}"
    (cd "$WEB_DIR" && pnpm exec next dev -p 3000 -H 0.0.0.0) &
    WEB_PID=$!
fi

# ── Start frontend/admin (optional) ────────────────────────────────
if $ADMIN_MODE; then
    if _ensure_port_free 3001; then
        echo -e "${BLUE}Starting frontend/admin (Next.js) on :3001...${NC}"
        (cd "$ADMIN_DIR" && pnpm exec next dev -p 3001 -H 0.0.0.0) &
        ADMIN_PID=$!
    fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Backend:   http://localhost:8000${NC}"
echo -e "${GREEN}  Web:       http://localhost:3000${NC}"
if [ -n "$ADMIN_PID" ]; then
    echo -e "${GREEN}  Admin:     http://localhost:3001${NC}"
fi
if $NOTIFY_MODE; then
    echo -e "${GREEN}  Notify:    dispatcher + worker${NC}"
fi
echo -e "${GREEN}  API docs:  http://localhost:8000/docs${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for any process to exit
wait
