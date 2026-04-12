#!/bin/bash
# Daily pipeline entry point. Run via cron or manually.
# Usage: bash scripts/daily-pipeline.sh [YYYY-MM-DD]
# Defaults to yesterday's date if no argument given.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATE="${1:-$(date -d yesterday +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)}"

echo "========================================"
echo "[pipeline] Starting daily pipeline"
echo "[pipeline] Date: $DATE"
echo "[pipeline] Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# Stage 1: Pre-process media (audio, images, PDFs)
echo ""
echo "[pipeline] Stage 1: Media pre-processing"
node "$SCRIPT_DIR/process-media.js" "$DATE"

# Stage 2: Generate summaries via Claude CLI
echo ""
echo "[pipeline] Stage 2: Generating summaries"
bash "$SCRIPT_DIR/generate-summary.sh" "$DATE"

echo ""
echo "========================================"
echo "[pipeline] Pipeline complete for $DATE"
echo "[pipeline] Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
