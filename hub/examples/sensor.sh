#!/bin/sh
# A provider in one curl: writes a temperature reading to the hub (hub/API.md § Writing a provider).
#
# once, make a token for the script:
#   node hub/bin/hub.mjs pair --name "Studio thermometer" --kind service --scopes write --kinds 'sensor.*' --token
# then, every minute (cron, launchd):
#   HUB=http://localhost:8787 TOKEN=fxh_… CELSIUS=21.5 hub/examples/sensor.sh
#
# The id is deterministic (where + the minute), so a retry never makes a duplicate.
set -eu
HUB=${HUB:-http://localhost:8787}
: "${TOKEN:?set TOKEN to the token printed by hub pair --token}"
WHERE=${WHERE:-studio}
CELSIUS=${CELSIUS:-21.5}
NOW=$(date +%s)
T=$((NOW / 60 * 60))

curl -fsS -X PUT "$HUB/v1/records/temp:$WHERE:$T" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"sensor.temperature\",\"time\":$T,\"created\":$NOW,\"updated\":$NOW,\"data\":{\"celsius\":$CELSIUS,\"where\":\"$WHERE\"}}"
echo
