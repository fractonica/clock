#!/bin/bash
# Renders the widgets on the Mac, without a Home Screen: every family of every widget at its exact size (iPhone
# 15 Pro / Pro Max points, the system's 16 pt content margins, the app's backdrop as the container background) into
# contact sheets, one PNG per widget. Lives in a Checks folder, so it never ships.
#
#   ios/Widgets/Checks/Render/render.sh OUT_DIR [unix time [zone]]     (default: SPEC vector A, 1791460800, UTC)
#
# Compiles the widget views (Widgets/Model, Widgets/Parts, Widgets/*/…View(s).swift and …Model.swift) and the shared
# drawing (Shared/) for macOS against FractonicaKit, then renders them with ImageRenderer at 2×. Text(timerInterval:)
# and ProgressView(timerInterval:) are drawn as they read at render time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/build/DerivedData}"
OUT_DIR="${1:?usage: render.sh OUT_DIR [unix time [zone]]}"
shift
KIT="$DERIVED_DATA/Checks/FractonicaKit"
BIN="$DERIVED_DATA/Checks/widget-render"
mkdir -p "$BIN" "$OUT_DIR"

# FractonicaKit as a static library, as ios/scripts/check.sh builds it
if [ ! -f "$KIT/libFractonicaKit.a" ] || [ -n "$(find "$ROOT/FractonicaKit/Sources" -name '*.swift' -newer "$KIT/libFractonicaKit.a")" ]; then
  mkdir -p "$KIT"
  xcrun swiftc -swift-version 6 -O -parse-as-library -module-name FractonicaKit -emit-library -static \
    -emit-module -emit-module-path "$KIT/FractonicaKit.swiftmodule" -o "$KIT/libFractonicaKit.a" \
    $(find "$ROOT/FractonicaKit/Sources/FractonicaKit" -name '*.swift' | sort)
fi

xcrun swiftc -swift-version 6 -parse-as-library -D WIDGET_RENDER -I "$KIT" -L "$KIT" -lFractonicaKit \
  "$ROOT/Widgets/Checks/Render/render.swift" \
  "$ROOT"/Widgets/Model/*.swift "$ROOT"/Widgets/Parts/*.swift \
  $(find "$ROOT/Widgets" -path '*/Checks' -prune -o \( -name '*View.swift' -o -name '*Views.swift' -o -name '*Model.swift' \) -print) \
  "$ROOT"/Shared/{Theme,Backdrop,GlyphViews,Notation+Standard,AppLink,Screen}.swift \
  -o "$BIN/render"
"$BIN/render" "$OUT_DIR" "$@"
