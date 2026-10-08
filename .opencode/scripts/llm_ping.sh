#!/usr/bin/env bash
# llm_ping.sh — upstream availability test before the watcher spends a nudge
# (2026-09-28, user decision after the #348 night: 4 of 5 wakes burned inside
# the closed z.ai quota window and each one still re-read the manager history).
# A minimal real model call ("connection test") against the SAME upstream the
# IMPL agents use — zai direct (ZAI_API_KEY); a health endpoint would not prove
# the quota is back. 2026-10-04: retargeted from the removed local gateway
# (its stale defaults answered http=000 while zai was fine, so every
# nudge was skipped without a trace and #349 froze in In IMPL for 5 days).
# Exit 0 = upstream serves, the nudge may go;
# non-zero = closed window / outage, the nudge is skipped and no NUDGE marker
# is written (the wake budget is not consumed by a dead window).
set -u
BASE_URL="${ZAI_BASE_URL:-https://api.z.ai/api/coding/paas/v4}"
MODEL="${LLM_PING_MODEL:-glm-5.3-flash}"
TIMEOUT="${LLM_PING_TIMEOUT:-30}"
API_KEY="${ZAI_API_KEY:-}"
if [ -z "$API_KEY" ]; then
    echo "llm_ping: ZAI_API_KEY is not set — cannot test upstream" >&2
    exit 2
fi
http=$(curl -s -m "$TIMEOUT" -o /tmp/llm-ping-last.json -w '%{http_code}' \
    -X POST "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":1}")
if [ "$http" = "200" ]; then
    echo "llm_ping: UP (model $MODEL)"
    exit 0
fi
echo "llm_ping: DOWN (http=$http, model $MODEL)"
exit 1
