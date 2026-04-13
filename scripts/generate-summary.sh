#!/bin/bash
# Generates daily summaries for all active groups using Claude CLI.
# Usage: bash scripts/generate-summary.sh YYYY-MM-DD
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATE="${1:?Usage: generate-summary.sh YYYY-MM-DD}"

GROUPS_FILE="$PROJECT_DIR/config/groups.json"
TEMPLATES_DIR="$PROJECT_DIR/templates"
SUMMARIES_DIR="$PROJECT_DIR/data/summaries/$DATE"
PURCHASES_DIR="$PROJECT_DIR/data/purchases"

mkdir -p "$SUMMARIES_DIR"

echo "[generate-summary] Date: $DATE"

cd "$PROJECT_DIR"

# Read active groups using helper script
GROUPS_TMP=$(mktemp)
node "$SCRIPT_DIR/read-groups.js" "$GROUPS_FILE" > "$GROUPS_TMP"

if [ ! -s "$GROUPS_TMP" ]; then
  echo "[generate-summary] No active groups found."
  rm -f "$GROUPS_TMP"
  exit 0
fi

while IFS='|' read -r JID SLUG DISPLAY_NAME TEMPLATE LANGUAGE CURRENCY PARTICIPANTS; do
  SUMMARY_FILE="$SUMMARIES_DIR/$SLUG.md"

  # Skip if already generated (idempotent)
  if [ -f "$SUMMARY_FILE" ]; then
    echo "[generate-summary] Skipping $DISPLAY_NAME (already generated)"
    continue
  fi

  echo "[generate-summary] Processing: $DISPLAY_NAME ($SLUG)"

  # Extract day's messages
  DAY_MESSAGES=$(node "$SCRIPT_DIR/extract-day.js" --date "$DATE" --group-jid "$JID" 2>/dev/null)

  if [ -z "$DAY_MESSAGES" ]; then
    echo "[generate-summary] No messages for $DISPLAY_NAME on $DATE. Skipping."
    continue
  fi

  # Load and fill template
  TEMPLATE_FILE="$TEMPLATES_DIR/$TEMPLATE.md"
  if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "[generate-summary] Template not found: $TEMPLATE_FILE. Skipping."
    continue
  fi

  PROMPT_TEMPLATE=$(cat "$TEMPLATE_FILE")
  PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{LANGUAGE\}\}/$LANGUAGE}"
  PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{CURRENCY\}\}/$CURRENCY}"
  PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{DATE\}\}/$DATE}"
  PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{GROUP_NAME\}\}/$DISPLAY_NAME}"
  PROMPT_TEMPLATE="${PROMPT_TEMPLATE//\{\{PARTICIPANTS\}\}/$PARTICIPANTS}"

  FULL_PROMPT="$PROMPT_TEMPLATE

$DAY_MESSAGES"

  echo "[generate-summary] Calling Claude CLI for $DISPLAY_NAME..."

  # Write prompt to temp file to avoid shell escaping issues with large prompts
  PROMPT_FILE=$(mktemp)
  printf '%s' "$FULL_PROMPT" > "$PROMPT_FILE"

  # Call Claude CLI with cheapest model (haiku)
  RESULT=$(claude --dangerously-skip-permissions -p --model haiku "$(cat "$PROMPT_FILE")" 2>/dev/null) || true
  rm -f "$PROMPT_FILE"

  if [ -z "$RESULT" ]; then
    echo "[generate-summary] Claude returned empty result for $DISPLAY_NAME."
    continue
  fi

  # Save summary
  printf '%s\n' "$RESULT" > "$SUMMARY_FILE"
  echo "[generate-summary] Summary saved: $SUMMARY_FILE"

  # Extract purchases JSON if present (for expense-tracker template)
  if [ "$TEMPLATE" = "expense-tracker" ]; then
    SLUG_PURCHASES_DIR="$PURCHASES_DIR/$SLUG"
    mkdir -p "$SLUG_PURCHASES_DIR"
    SLUG_PURCHASES_FILE="$SLUG_PURCHASES_DIR/$DATE.json"
    if [ ! -f "$SLUG_PURCHASES_FILE" ]; then
      echo "[]" > "$SLUG_PURCHASES_FILE"
    fi

    PURCHASES=$(printf '%s' "$RESULT" | node "$SCRIPT_DIR/extract-purchases.js")

    if [ -n "$PURCHASES" ]; then
      node "$SCRIPT_DIR/merge-purchases.js" "$SLUG_PURCHASES_FILE" "$PURCHASES"
    fi
  fi

done < "$GROUPS_TMP"

rm -f "$GROUPS_TMP"
echo "[generate-summary] Done for $DATE"
