#!/bin/bash
# PDW Client Launcher
# Runs rtl_fm | multimon-ng and pipes decoded output to pdw-client.js
#
# Usage:
#   ./start-client.sh
#
# Configure via environment variables or edit the defaults below.
# Copy .env.example to client/.env and source it, or export vars before running.

set -euo pipefail

# ── Configuration (override with env vars) ──
FREQUENCY="${RTL_FREQUENCY:-157.925M}"
GAIN="${RTL_GAIN:-40}"
PPM="${RTL_PPM:-0}"
DEVICE="${RTL_DEVICE:-0}"
SAMPLE_RATE="${RTL_SAMPLE_RATE:-22050}"
DECODERS="${DECODERS:-POCSAG512,POCSAG1200,FLEX}"

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"

# ── Validate ──
if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY is not set."
  echo ""
  echo "Get it from your server:"
  echo "  - Admin Panel > Settings tab, or"
  echo "  - docker exec pdw-monitor cat /data/.api-key"
  echo ""
  echo "Then run:"
  echo "  API_KEY=your-key SERVER_URL=http://your-server:3000 ./start-client.sh"
  exit 1
fi

# ── Check dependencies ──
for cmd in rtl_fm multimon-ng node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install it first."
    case "$cmd" in
      rtl_fm)     echo "  sudo apt install rtl-sdr" ;;
      multimon-ng) echo "  sudo apt install multimon-ng" ;;
      node)       echo "  https://nodejs.org/" ;;
    esac
    exit 1
  fi
done

# ── Build decoder args ──
DECODER_ARGS=""
IFS=',' read -ra DECS <<< "$DECODERS"
for d in "${DECS[@]}"; do
  DECODER_ARGS="$DECODER_ARGS -a $(echo "$d" | xargs)"
done

# ── Resolve script directory ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== PDW Client ==="
echo "Server:     $SERVER_URL"
echo "Frequency:  $FREQUENCY"
echo "Gain:       $GAIN"
echo "PPM:        $PPM"
echo "Device:     $DEVICE"
echo "Decoders:   $DECODERS"
echo ""
echo "Starting: rtl_fm -f $FREQUENCY -g $GAIN -p $PPM -d $DEVICE -s $SAMPLE_RATE - | multimon-ng$DECODER_ARGS -t raw -"
echo ""

# ── Run pipeline ──
# rtl_fm outputs raw audio -> multimon-ng decodes POCSAG/FLEX -> pdw-client.js parses and sends to server
rtl_fm -f "$FREQUENCY" -g "$GAIN" -p "$PPM" -d "$DEVICE" -s "$SAMPLE_RATE" - 2>/dev/null | \
  multimon-ng $DECODER_ARGS -t raw - 2>/dev/null | \
  READ_STDIN=1 API_KEY="$API_KEY" SERVER_URL="$SERVER_URL" node "$SCRIPT_DIR/pdw-client.js"
