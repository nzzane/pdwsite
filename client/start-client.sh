#!/bin/bash
######################################################################
# PDW Client Launcher
#
# Runs rtl_fm | multimon-ng | node pdw-client.js
# Based on the proven pagermon reader.sh approach.
#
# Usage:
#   API_KEY=xxx SERVER_URL=http://server:3000 ./start-client.sh
#
# All settings below can be overridden with environment variables.
######################################################################

set -euo pipefail

# ── RTL-SDR settings ──
FREQUENCY="${RTL_FREQUENCY:-157.925M}"    # Pager frequency (NZ default)
GAIN="${RTL_GAIN:-40}"                     # SDR gain
PPM="${RTL_PPM:-0}"                        # Frequency correction
DEVICE="${RTL_DEVICE:-0}"                  # Device index (or serial e.g. 0101)
SAMPLE_RATE="${RTL_SAMPLE_RATE:-22050}"     # Only valid rate for multimon-ng
SQUELCH="${RTL_SQUELCH:-0}"                # Squelch level (0=off, try 15 if noisy)

# ── Multimon-ng settings ──
DECODERS="${DECODERS:-POCSAG512,POCSAG1200,FLEX}"
MULTIMON_QUIET="${MULTIMON_QUIET:-1}"      # 1 = suppress multimon-ng status msgs
MULTIMON_FILTER="${MULTIMON_FILTER:-0}"    # 1 = block more false decodes (-b1)

# ── Server connection ──
SERVER_URL="${SERVER_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"

# ── Validate API key ──
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
      rtl_fm)      echo "  sudo apt install rtl-sdr" ;;
      multimon-ng) echo "  sudo apt install multimon-ng" ;;
      node)        echo "  https://nodejs.org/" ;;
    esac
    exit 1
  fi
done

# ── Build rtl_fm args ──
# Based on pagermon's proven settings:
#   -E dc    : removes DC spike from SDR
#   -F 0     : disable high-pass filter (better for pager signals)
#   -A fast  : fast atan math (lower CPU)
#   -l N     : squelch level (reduces noise when no signal)
RTL_ARGS="-f $FREQUENCY -g $GAIN -p $PPM -d $DEVICE -s $SAMPLE_RATE"
RTL_ARGS="$RTL_ARGS -E dc -F 0 -A fast"
if [ "$SQUELCH" != "0" ]; then
  RTL_ARGS="$RTL_ARGS -l $SQUELCH"
fi

# ── Build multimon-ng args ──
# -t raw       : input is raw audio from rtl_fm
# -q           : quiet mode (suppress status lines)
# -b1          : block more false decodes
# -f alpha     : only output alpha messages (omit for numeric too)
# /dev/stdin   : read from pipe
MM_ARGS=""
IFS=',' read -ra DECS <<< "$DECODERS"
for d in "${DECS[@]}"; do
  MM_ARGS="$MM_ARGS -a $(echo "$d" | xargs)"
done
MM_ARGS="$MM_ARGS -t raw"
[ "$MULTIMON_QUIET" = "1" ] && MM_ARGS="$MM_ARGS -q"
[ "$MULTIMON_FILTER" = "1" ] && MM_ARGS="$MM_ARGS -b1"

# ── Resolve script directory ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== PDW Client ==="
echo "Server:     $SERVER_URL"
echo "Frequency:  $FREQUENCY"
echo "Gain:       $GAIN"
echo "PPM:        $PPM"
echo "Squelch:    $SQUELCH"
echo "Device:     $DEVICE"
echo "Decoders:   $DECODERS"
echo ""
echo "Starting: rtl_fm $RTL_ARGS | multimon-ng $MM_ARGS /dev/stdin"
echo ""

# ── Run pipeline ──
# rtl_fm -> raw audio -> multimon-ng -> decoded text -> pdw-client.js -> server
rtl_fm $RTL_ARGS - 2>/dev/null | \
  multimon-ng $MM_ARGS /dev/stdin 2>/dev/null | \
  READ_STDIN=1 API_KEY="$API_KEY" SERVER_URL="$SERVER_URL" node "$SCRIPT_DIR/pdw-client.js"
