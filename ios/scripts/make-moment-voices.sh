#!/bin/bash
# Generates the spoken announcements of Moments (Features/Journal/Moments): one clip per level and boundary the app can
# announce, "A new Delta begins in eleven Flavons", "Gamma node in eleven Flavons" … They are the notifications' sound
# and the instant view's greeting, so they are IMA4 .caf files (a format notification sounds accept, ≤ 30 s), written
# to ios/Fractonica/Resources/Moments/moment-<level>-<boundary>.caf.
#
#   ios/scripts/make-moment-voices.sh [voice]      # default af_heart: calm and clear
#
# Speech comes from sidekick (`sk say`, local Kokoro voices; `sk voices` lists them) and is converted with afconvert.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/Fractonica/Resources/Moments"
VOICE="${1:-af_heart}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

command -v sk >/dev/null || { echo "sk (sidekick) is not installed" >&2; exit 1; }

for level in helion nuclide delta gamma beta alpha; do
  name="$(tr '[:lower:]' '[:upper:]' <<< "${level:0:1}")${level:1}"
  for boundary in start peak node valley; do
    if [ "$boundary" = start ]; then
      text="A new $name begins in eleven Flavons."
    else
      text="$name $boundary in eleven Flavons."
    fi
    raw="$TMP/$level-$boundary.wav"
    sk say -v "$VOICE" -o "$raw" --no-play "$text" >/dev/null
    # mono 22.05 kHz IMA4 in a CAF: small, and playable as a notification sound
    afconvert -f caff -d ima4@22050 -c 1 "$raw" "$OUT/moment-$level-$boundary.caf"
    echo "moment-$level-$boundary.caf  \"$text\"  $(afinfo "$OUT/moment-$level-$boundary.caf" | awk '/estimated duration/ {print $3 " s"}')"
  done
done
