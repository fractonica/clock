#!/bin/bash
# Installs the iOS app on a simulator, launches it with test arguments and saves a screenshot. Works from any directory.
#
#   ios/scripts/shoot.sh [options] OUT.png [launch arguments…]
#
#   --no-build        use the app from the last ios/scripts/build.sh ios
#   --device NAME     simulator to use (default "Fractonica iPhone"); created on first use, booted if needed
#   --type TYPE       device type for a new device (default "iPhone 18 Pro"; e.g. "iPad Pro 13-inch (M5)")
#   --wait SECONDS    time between launch and screenshot (default 4)
#   --uninstall       remove the app (and its data) from the device and exit
#   --delete          shut the device down, delete it and exit (do this when you are done with a device)
#
#   ios/scripts/shoot.sh /tmp/now.png -FXTab now -FXTime 1791460800 -FXZone UTC
#   ios/scripts/shoot.sh --no-build --device "fx-rings" /tmp/rings.png -FXTab rings -FXPure 1
#   ios/scripts/shoot.sh --no-build --device "fx-rings-ipad" --type "iPad Pro 13-inch (M5)" /tmp/ipad.png -FXTab rings
#
# Launch arguments are the app's test hooks (ios/ARCHITECTURE.md): -FXTab, -FXTime, -FXPure, -FXZone, -FXLink,
# -FXRate. (Links go through -FXLink: `simctl openurl` stops at a system "Open in …?" prompt.) New devices use the
# iOS 27.0 runtime. The status bar shows 9:41 for clean shots. DerivedData: $DERIVED_DATA as build.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/build/DerivedData}"
APP="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Fractonica.app"
BUNDLE_ID="app.fractonica.clock"
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-27-0"
DEVICE="Fractonica iPhone"
TYPE="iPhone 18 Pro"
WAIT=4
BUILD=1
UNINSTALL=0
DELETE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0; shift ;;
    --device) DEVICE="$2"; shift 2 ;;
    --type) TYPE="$2"; shift 2 ;;
    --wait) WAIT="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --delete) DELETE=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) break ;;
  esac
done

# simctl. Xcode's `simctl` wrapper runs `xcodebuild -runFirstLaunch`, which waits for an administrator, whenever the
# installed CoreSimulator is older than that Xcode expects (right after an Xcode update, until someone runs it once):
# meanwhile use the installed CoreSimulator's own simctl, which the running simulator service matches.
SIMCTL_BIN="$(xcrun --find simctl)"
COSIM=/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A
COSIM_EXPECTED="$(sed -n 's/^EXPECTED_VERSION="\(.*\)"$/\1/p' "$SIMCTL_BIN" 2>/dev/null || true)"
COSIM_CURRENT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$COSIM/Resources/Info.plist" 2>/dev/null || true)"
if [ -n "$COSIM_EXPECTED" ] && [ -n "$COSIM_CURRENT" ] && [ "$COSIM_CURRENT" != "$COSIM_EXPECTED" ] \
    && [ "$(printf '%s\n%s\n' "$COSIM_CURRENT" "$COSIM_EXPECTED" | sort --version-sort | head -n1)" = "$COSIM_CURRENT" ] \
    && [ -x "$COSIM/Resources/bin/simctl" ]; then
  echo "note: CoreSimulator $COSIM_CURRENT is older than this Xcode expects ($COSIM_EXPECTED); run 'sudo xcodebuild -runFirstLaunch' once" >&2
  SIMCTL_BIN="$COSIM/Resources/bin/simctl"
fi
simctl() { "$SIMCTL_BIN" "$@"; }

# The device's UDID on the runtime, created when missing.
UDID="$(simctl list devices --json | /usr/bin/python3 -c '
import json, sys
name, runtime = sys.argv[1], sys.argv[2]
for d in json.load(sys.stdin)["devices"].get(runtime, []):
    if d["name"] == name and d.get("isAvailable", True):
        print(d["udid"]); break
' "$DEVICE" "$RUNTIME")"
if [ $DELETE -eq 1 ]; then
  if [ -n "$UDID" ]; then
    simctl shutdown "$UDID" 2>/dev/null || true
    simctl delete "$UDID"
    echo "deleted simulator \"$DEVICE\""
  fi
  exit 0
fi
if [ -z "$UDID" ]; then
  UDID="$(simctl create "$DEVICE" "$TYPE" "$RUNTIME")"
  echo "created simulator \"$DEVICE\" ($TYPE, $UDID)"
fi

if [ $UNINSTALL -eq 1 ]; then
  simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  echo "uninstalled $BUNDLE_ID from \"$DEVICE\""
  exit 0
fi

if [ $# -lt 1 ]; then
  echo "usage: $(basename "$0") [--no-build] [--device NAME] [--type TYPE] [--wait SECONDS] OUT.png [launch arguments…]" >&2
  exit 2
fi
OUT="$1"
shift

if [ $BUILD -eq 1 ]; then
  DERIVED_DATA="$DERIVED_DATA" "$ROOT/scripts/build.sh" ios
fi
if [ ! -d "$APP" ]; then
  echo "no app at $APP (run ios/scripts/build.sh ios)" >&2
  exit 1
fi

simctl boot "$UDID" 2>/dev/null || true
simctl bootstatus "$UDID" -b > /dev/null
simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 2>/dev/null || true
simctl install "$UDID" "$APP"
simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID" "$@" > /dev/null
sleep "$WAIT"
mkdir -p "$(dirname "$OUT")"
simctl io "$UDID" screenshot --type=png "$OUT" > /dev/null 2>&1
echo "$OUT"
