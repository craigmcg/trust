#!/bin/bash
# Nightly trust run — called by cron
# Logs to ~/Library/Logs/trust-nightly.log


PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$HOME/Library/Logs/trust-nightly.log"
NODE="/opt/homebrew/bin/node"

mkdir -p "$(dirname "$LOG_FILE")"

echo "" >> "$LOG_FILE"
echo "=== $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# Build first in case source changed
"$NODE" node_modules/.bin/tsc -p tsconfig.json >> "$LOG_FILE" 2>&1

# Run nightly
"$NODE" dist/index.js nightly >> "$LOG_FILE" 2>&1

echo "Done." >> "$LOG_FILE"
