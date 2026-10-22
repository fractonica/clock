#!/bin/bash
# Builds the native apps from any directory.
#
#   ios/scripts/build.sh ios     xcodegen generate, then the iOS app (and its widgets) for the iOS Simulator
#   ios/scripts/build.sh mac     xcodegen generate, then the macOS app (and its widgets), ad-hoc signed
#   ios/scripts/build.sh kit     swift test for FractonicaKit
#   ios/scripts/build.sh all     all three (the default)
#
# DerivedData goes to $DERIVED_DATA (default ios/build/DerivedData); full logs to $DERIVED_DATA/Logs/fx-*.log.
# Prints only the errors and warnings and, on success, the .app paths. Exits non-zero when anything fails.
# Neither build needs a provisioning profile: the simulator build is unsigned, the Mac build is signed ad hoc (without
# the entitlements that need a profile, which Xcode signing with the team keeps).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/build/DerivedData}"
LOGS="$DERIVED_DATA/Logs"
WHAT="${1:-all}"
STATUS=0

case "$WHAT" in
  ios|mac|kit|all) ;;
  *) echo "usage: $(basename "$0") ios|mac|kit|all" >&2; exit 2 ;;
esac
mkdir -p "$LOGS"

# The diagnostics of a log, once each; the AppIntents metadata note on targets without App Intents is not ours.
summarize() {
  grep -E '(^|: )(error|warning): ' "$1" \
    | grep -v 'Metadata extraction skipped' \
    | sed -E "s#^$ROOT/##" | sort -u
}

generate() {
  if ! (cd "$ROOT" && xcodegen generate --quiet > "$LOGS/fx-xcodegen.log" 2>&1); then
    cat "$LOGS/fx-xcodegen.log"
    exit 1
  fi
}

# xcodebuild <scheme> <destination> <products subfolder> [settings…]
build() {
  local scheme="$1" destination="$2" products="$3"
  shift 3
  local log="$LOGS/fx-$scheme.log"
  echo "== $scheme"
  xcodebuild -project "$ROOT/Fractonica.xcodeproj" -scheme "$scheme" -configuration Debug \
    -destination "$destination" -derivedDataPath "$DERIVED_DATA" "$@" build > "$log" 2>&1
  local code=$?
  summarize "$log"
  if [ $code -ne 0 ]; then
    grep -q -E 'error: ' "$log" || tail -n 30 "$log"
    echo "** $scheme FAILED (log: $log)"
    STATUS=1
  else
    echo "$DERIVED_DATA/Build/Products/$products/Fractonica.app"
  fi
}

if [ "$WHAT" = ios ] || [ "$WHAT" = mac ] || [ "$WHAT" = all ]; then generate; fi

if [ "$WHAT" = ios ] || [ "$WHAT" = all ]; then
  build Fractonica 'generic/platform=iOS Simulator' Debug-iphonesimulator \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
fi

# An ad-hoc signature cannot carry entitlements that need a provisioning profile (com.apple.developer.*, such as
# time-sensitive notifications): each macOS target signs with a copy of its entitlements without them. The setting is
# resolved per target through $(TARGET_NAME), so the widget keeps its own sandbox entitlements.
adhoc_entitlements() {
  local dir="$DERIVED_DATA/AdHocEntitlements"
  mkdir -p "$dir"
  for target in "$@"; do
    /usr/bin/python3 - "$ROOT/Support/$target.entitlements" "$dir/$target.entitlements" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    entitlements = plistlib.load(f)
kept = {k: v for k, v in entitlements.items() if not k.startswith('com.apple.developer.')}
with open(sys.argv[2], 'wb') as f:
    plistlib.dump(kept, f)
PY
    echo "FX_ADHOC_ENTITLEMENTS_$target=$dir/$target.entitlements"
  done
}

if [ "$WHAT" = mac ] || [ "$WHAT" = all ]; then
  build FractonicaMac 'platform=macOS,arch=arm64' Debug \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
    'CODE_SIGN_ENTITLEMENTS=$(FX_ADHOC_ENTITLEMENTS_$(TARGET_NAME))' \
    $(adhoc_entitlements FractonicaMac FractonicaWidgetsMac)
fi

if [ "$WHAT" = kit ] || [ "$WHAT" = all ]; then
  echo "== FractonicaKit"
  log="$LOGS/fx-kit.log"
  swift test --package-path "$ROOT/FractonicaKit" --scratch-path "$DERIVED_DATA/FractonicaKit" > "$log" 2>&1
  code=$?
  summarize "$log"
  grep -E '(Executed|Test run with) .*(tests?|passed|failed)' "$log" | tail -n 2
  if [ $code -ne 0 ]; then
    grep -E '(error|failed|FAIL)' "$log" | head -n 20
    echo "** FractonicaKit tests FAILED (log: $log)"
    STATUS=1
  fi
fi

exit $STATUS
