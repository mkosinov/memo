#!/usr/bin/env bash
set -euo pipefail

# switch-provider.sh — переключение моделей у всех агентов проекта
#
# Usage:
#   ./switch-provider.sh <profile-name>
#
# Profile = имя JSON файла в той же директории (без .json).
# Сейчас есть: opencode_go, cerebras
# Можно добавлять новые: cp cerebras.json myprovider.json && edit
#
# Что делает:
#   1. Читает <profile>.json (через python3)
#   2. Меняет model: в каждом agent-файле проекта
#   3. Показывает diff изменений
#   4. Напоминает перезапустить контейнер

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AGENTS_DIR="$PROJECT_DIR/.opencode/agents"

if [ $# -lt 1 ]; then
  echo "❌ Usage: $0 <profile-name>"
  echo ""
  echo "Available profiles:"
  for f in "$SCRIPT_DIR"/*.json; do
    name="$(basename "$f" .json)"
    label="$(python3 -c "import json; print(json.load(open('$f')).get('name', '—'))")"
    echo "  • $name  → $label"
  done
  exit 1
fi

PROFILE="$1"
CONFIG="$SCRIPT_DIR/$PROFILE.json"

if [ ! -f "$CONFIG" ]; then
  echo "❌ Profile not found: $CONFIG"
  echo "Available:"
  for f in "$SCRIPT_DIR"/*.json; do
    echo "  • $(basename "$f" .json)"
  done
  exit 1
fi

echo "=== Switch Provider ==="
echo "  Profile:  $PROFILE"
python3 -c "import json; print(json.load(open('$CONFIG')).get('name', '—'))"
echo ""

# Read the agents mapping from JSON via python3
AGENTS_JSON=$(python3 -c "
import json, sys
cfg = json.load(open('$CONFIG'))
for key, val in cfg['agents'].items():
    print(f'{key}={val}')
")

declare -A AGENTS
while IFS="=" read -r key value; do
  AGENTS["$key"]="$value"
done <<< "$AGENTS_JSON"

CHANGED=0
NOT_FOUND=0

for AGENT_FILE in "$AGENTS_DIR"/*.md; do
  AGENT_NAME="$(basename "$AGENT_FILE" .md)"

  if [ -z "${AGENTS[$AGENT_NAME]:-}" ]; then
    echo "  ⏭️  $AGENT_NAME — нет в конфиге, пропускаем"
    continue
  fi

  NEW_MODEL="${AGENTS[$AGENT_NAME]}"

  # Check if this agent file has a model: line
  if grep -q "^model: " "$AGENT_FILE"; then
    # Replace the model line
    sed -i "s|^model: .*|model: $NEW_MODEL|" "$AGENT_FILE"
    echo "  ✅ $AGENT_NAME → $NEW_MODEL"
    CHANGED=$((CHANGED + 1))
  else
    echo "  ⚠️  $AGENT_NAME — нет поля model в файле"
    NOT_FOUND=$((NOT_FOUND + 1))
  fi
done

echo ""
echo "=== Result ==="
echo "  Updated: $CHANGED agents"
echo "  Skipped (no model field): $NOT_FOUND"

if [ $CHANGED -gt 0 ]; then
  echo ""
  echo "📋 Changes made:"
  for AGENT_FILE in "$AGENTS_DIR"/*.md; do
    AGENT_NAME="$(basename "$AGENT_FILE" .md)"
    if [ -n "${AGENTS[$AGENT_NAME]:-}" ]; then
      echo "  $AGENT_NAME → $(grep "^model:" "$AGENT_FILE" | sed 's/model: //')"
    fi
  done
fi

echo ""
echo "⚠️  Don't forget to restart the OpenCode container:"
echo "   cd /root/docker && docker-compose down opencode && docker-compose up -d opencode"
