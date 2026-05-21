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
# Gain 32: tuned for city suburb / modern townhouse with moderate RF noise
# Too high (>40) picks up too much indoor noise, too low (<20) misses weak signals
FREQUENCY="${RTL_FREQUENCY:-157.950M}"    # Pager frequency (NZ default)
GAIN="${RTL_GAIN:-32}"                    # SDR gain (0=AGC, 20-42=fixed)
PPM="${RTL_PPM:-0}"                        # Frequency correction (calibrate per dongle)
DEVICE="${RTL_DEVICE:-0}"                  # Device index (or serial e.g. 0101)
SAMPLE_RATE="${RTL_SAMPLE_RATE:-22050}"    # Recommended rate for POCSAG decoding with multimon-ng
SQUELCH="${RTL_SQUELCH:-0}"                # Squelch level (0=off, try 15-30 if noisy)
EXCLUDE_CAPCODES="${PDW_EXCLUDE_CAPCODES:-}"    # Comma-separated capcodes to exclude (empty = none)

# ── Multimon-ng settings ──
# NOTE: -f alpha REMOVED - we capture ALL message types (alpha + numeric)
# Numeric messages may contain phone numbers, callback codes, address fragments
DECODERS="${DECODERS:-POCSAG512,POCSAG1200,FLEX}"
MULTIMON_QUIET="${MULTIMON_QUIET:-1}"      # 1 = suppress multimon-ng status msgs

# ── Server connection ──
SERVER_URL="${SERVER_URL:-http://10.20.50.30:3000}"
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
#   -g N     : fixed gain (better than AGC for consistent reception)
RTL_ARGS="-f $FREQUENCY -g $GAIN -p $PPM -d $DEVICE -s $SAMPLE_RATE"
RTL_ARGS="$RTL_ARGS -E dc -F 0 -A fast"
if [ "$SQUELCH" != "0" ]; then
  RTL_ARGS="$RTL_ARGS -l $SQUELCH"
fi

# ── Build multimon-ng args ──
# -t raw       : input is raw audio from rtl_fm
# -q           : quiet mode (suppress status lines)
# -b1          : block more false decodes
# NOTE: -f alpha REMOVED - capture all message types
# /dev/stdin   : read from pipe
MM_ARGS="-b1"
IFS=',' read -ra DECS <<< "$DECODERS"
for d in "${DECS[@]}"; do
  MM_ARGS="$MM_ARGS -a $(echo "$d" | xargs)"
done
MM_ARGS="$MM_ARGS -t raw"
[ "$MULTIMON_QUIET" = "1" ] && MM_ARGS="$MM_ARGS -q"

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
# stderr flows naturally (captured by docker logs) - not redirected into the pipe
rtl_fm $RTL_ARGS - | \
  multimon-ng $MM_ARGS /dev/stdin | \
  READ_STDIN=1 API_KEY="$API_KEY" SERVER_URL="$SERVER_URL" EXCLUDE_CAPCODES="$EXCLUDE_CAPCODES" node "$SCRIPT_DIR/pdw-client.js"
