#!/bin/bash
# Screenshot a fixed rectangle, then extend each shot in Gemini.
#
# Usage:
#   ./capture.sh 5
#
# That takes 5 screenshots of REGION. After every shot except the last, it
# clicks CLICK in config.env. Then every screenshot goes through one Gemini chat.
# Results are OUTPUT_DIR/YYYY-MM-DD-1-wallpaper.png and so on.
# The screenshot is deleted only after its wallpaper file is written.
# A later run the same day continues the numbering.
#
# Set REGION and CLICK in config.env. Shift-Command-4 shows coordinates.
# Safari must allow JavaScript from Apple Events (Settings > Developer).
# osascript must be allowed in System Settings > Privacy & Security > Accessibility.
# The Mac should be awake, logged in, and unlocked. Nothing runs on a schedule.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$DIR/config.env" ]]; then
  echo "Copy config.example.env to config.env and set REGION, CLICK, and OUTPUT_DIR." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$DIR/config.env"

COUNT="${1:-}"
if [[ ! "$COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: ./capture.sh <count>" >&2
  echo "Example: ./capture.sh 5" >&2
  exit 1
fi

if [[ ! "${REGION:-}" =~ ^-?[0-9]+,-?[0-9]+,[1-9][0-9]*,[1-9][0-9]*$ ]]; then
  echo "Set REGION=x,y,width,height in $DIR/config.env" >&2
  exit 1
fi

if (( COUNT > 1 )) && [[ ! "${CLICK:-}" =~ ^-?[0-9]+,-?[0-9]+$ ]]; then
  echo "Set CLICK=x,y in $DIR/config.env before capturing more than one shot." >&2
  exit 1
fi

OUTPUT_DIR="${OUTPUT_DIR/#\~/$HOME}"
mkdir -p "$OUTPUT_DIR"

HELPER="$DIR/wait-for-unlock"
if [[ ! -x "$HELPER" ]]; then
  SWIFT_BIN="$(command -v swiftc || true)"
  if [[ -z "$SWIFT_BIN" && -x /Library/Developer/CommandLineTools/usr/bin/swiftc ]]; then
    SWIFT_BIN="/Library/Developer/CommandLineTools/usr/bin/swiftc"
  fi
  if [[ -z "$SWIFT_BIN" ]]; then
    echo "wait-for-unlock is missing and swiftc was not found. Install Xcode Command Line Tools." >&2
    exit 1
  fi
  "$SWIFT_BIN" -O -o "$HELPER" "$DIR/wait-for-unlock.swift"
fi

NODE_BIN=""
if [[ -x /opt/homebrew/bin/node ]]; then
  NODE_BIN="/opt/homebrew/bin/node"
elif [[ -x /usr/local/bin/node ]]; then
  NODE_BIN="/usr/local/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "node was not found. Install Node.js." >&2
  exit 1
fi

click_point() {
  local x="${CLICK%%,*}"
  local y="${CLICK#*,}"
  osascript -e "tell application \"System Events\" to click at {$x, $y}"
}

next_index() {
  local date="$1"
  local max=0
  local file base num
  shopt -s nullglob
  for file in "$OUTPUT_DIR/${date}-"[0-9]*-wallpaper.png; do
    base="$(basename "$file")"
    num="${base#"${date}-"}"
    num="${num%-wallpaper.png}"
    if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
      max=$num
    fi
  done
  shopt -u nullglob
  echo $((max + 1))
}

"$HELPER"
caffeinate -u -t 1
sleep 1

DATE="$(date +%Y-%m-%d)"
START="$(next_index "$DATE")"
SHOTS=()

for (( i = 0; i < COUNT; i++ )); do
  INDEX=$((START + i))
  DEST="$OUTPUT_DIR/${DATE}-${INDEX}.png"
  if ! screencapture -x -R "$REGION" "$DEST"; then
    rm -f "$DEST"
    echo "screencapture failed. Allow Screen Recording for the process that launched this script." >&2
    exit 1
  fi
  echo "Saved $DEST"
  SHOTS+=("$DEST")
  if (( i < COUNT - 1 )); then
    click_point
    sleep 1
  fi
done

PAIRS=()
for DEST in "${SHOTS[@]}"; do
  BASE="$(basename "$DEST" .png)"
  PAIRS+=("$DEST" "$OUTPUT_DIR/${BASE}-wallpaper.png")
done
"$NODE_BIN" "$DIR/extend-wallpaper.mjs" "${PAIRS[@]}"
