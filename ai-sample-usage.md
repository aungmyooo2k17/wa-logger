#!/bin/bash
# Usage: ./scripts/generate.sh <client-name> <slug>
# Generates a single blog post from the planner.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLIENT="${1:?Usage: generate.sh <client-name> <slug>}"
SLUG="${2:?Usage: generate.sh <client-name> <slug>}"
CLIENT_DIR="$PROJECT_DIR/clients/$CLIENT"

# Validate client exists
if [ ! -d "$CLIENT_DIR" ]; then
  echo "Error: Client '$CLIENT' not found at $CLIENT_DIR"
  exit 1
fi

if [ ! -f "$CLIENT_DIR/planner.json" ]; then
  echo "Error: planner.json not found for client '$CLIENT'"
  exit 1
fi

# Create output directory
OUTPUT_DIR="$CLIENT_DIR/output/$SLUG"
mkdir -p "$OUTPUT_DIR/images"

echo "[generate] Client: $CLIENT | Slug: $SLUG"
echo "[generate] Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "[generate] Output: $OUTPUT_DIR"

cd "$PROJECT_DIR"

stdbuf -oL -eL claude --dangerously-skip-permissions --verbose --output-format stream-json -p \
  "You are running in GENERATE mode for client: $CLIENT, slug: $SLUG

Read CLAUDE.md for full instructions.

Steps:
1. Read all files in clients/$CLIENT/knowledge-base/
2. Read clients/$CLIENT/planner.json and find the post with slug: $SLUG
3. Read templates/post-schema.json and templates/content-skeleton.md for output format
4. Research the topic and keywords (use web search if available)
5. Generate content.md following the content skeleton structure
6. Generate post.json following the post schema structure
7. Download a relevant featured image from Unsplash to clients/$CLIENT/output/$SLUG/images/
8. Write all files to clients/$CLIENT/output/$SLUG/
9. Update the post status to 'generated' in clients/$CLIENT/planner.json
10. Append the new post to clients/$CLIENT/knowledge-base/our-posts.md

Follow CLAUDE.md GENERATE mode instructions exactly." 2>&1

echo "[generate] Done: $SLUG"
