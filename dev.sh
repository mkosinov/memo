#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/frontend/web"
ADMIN_DIR="$ROOT_DIR/frontend/admin"

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
for arg in "$@"; do
    case "$arg" in
        -r|--restart) RESTART=true ;;
        --admin|-a)   ADMIN_MODE=true ;;
    esac
done

# ── Kill dev processes (--restart) ────────────────────────────────
if $RESTART; then
    echo -e "${YELLOW}Restart mode — killing existing processes...${NC}"
    # Kill specific processes by pattern (dev only, not dangerous in dev context)
    pkill -f "uvicorn src.main:app" 2>/dev/null && echo -e "${YELLOW}  Killed backend${NC}" || true
    pkill -f "next dev" 2>/dev/null && echo -e "${YELLOW}  Killed frontend(s)${NC}" || true
    sleep 1
fi

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
    [ -n "$ADMIN_PID" ] && kill "$ADMIN_PID" 2>/dev/null
    wait 2>/dev/null
    echo -e "${GREEN}Done.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Seed DB if not exists ──────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/memo.db" ]; then
    echo -e "${BLUE}Seeding database...${NC}"
    (cd "$BACKEND_DIR" && PYTHONPATH=src uv run python -m seed.seed)
    echo -e "${GREEN}Database seeded.${NC}"
fi

# ── Start backend ──────────────────────────────────────────────────
if _ensure_port_free 8000; then
    echo -e "${BLUE}Starting backend (FastAPI) on :8000...${NC}"
    export ENV_FILE=.env.dev
    (cd "$BACKEND_DIR" && uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload) &
    BACKEND_PID=$!
fi

# ── Start frontend/web ─────────────────────────────────────────────
if _ensure_port_free 3000; then
    echo -e "${BLUE}Starting frontend/web (Next.js) on :3000...${NC}"
    (cd "$WEB_DIR" && npx next dev -p 3000) &
    WEB_PID=$!
fi

# ── Start frontend/admin (optional) ────────────────────────────────
if $ADMIN_MODE; then
    if _ensure_port_free 3001; then
        echo -e "${BLUE}Starting frontend/admin (Next.js) on :3001...${NC}"
        (cd "$ADMIN_DIR" && npx next dev -p 3001) &
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
echo -e "${GREEN}  API docs:  http://localhost:8000/docs${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for any process to exit
wait
