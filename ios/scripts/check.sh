#!/bin/bash
# Runs checks folders: small Swift programs that exercise the app's logic on the Mac, outside the app (the app targets
# have no unit-test bundle; FractonicaKit has its own `swift test`). Works from any directory.
#
#   ios/scripts/check.sh ios/Fractonica/Core/Checks [more folders…]
#   ios/scripts/check.sh all          every Checks folder under ios/Fractonica, ios/Shared and ios/Widgets
#
# A checks folder (named Checks, anywhere in the app or widget sources; project.yml keeps it out of every target) holds
#   *.swift   the checks, one file with the `@main` type; `check(_:_:)` and `Checks.finish()` come from
#             ios/scripts/CheckSupport.swift
#   sources   the app files the checks compile against, one path per line relative to ios/ (globs allowed, # comments)
# Each program is compiled in Swift 6 mode for macOS against FractonicaKit (built once per DerivedData, rebuilt when
# its sources change) and run. Logic that imports UIKit cannot be checked this way: keep it out of the checked files.
# Build products go to $DERIVED_DATA/Checks (default ios/build/DerivedData, as build.sh). Exits non-zero on any failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/build/DerivedData}"
OUT="$DERIVED_DATA/Checks"
KIT_SOURCES="$ROOT/FractonicaKit/Sources/FractonicaKit"
KIT="$OUT/FractonicaKit"

if [ $# -lt 1 ]; then
  echo "usage: $(basename "$0") all | CHECKS_FOLDER…" >&2
  exit 2
fi
if [ "$1" = all ]; then
  set -- $(find "$ROOT/Fractonica" "$ROOT/Shared" "$ROOT/Widgets" -type d -name Checks | sort)
fi

# FractonicaKit as a static library with its module, rebuilt when a source is newer than the library.
mkdir -p "$KIT"
if [ ! -f "$KIT/libFractonicaKit.a" ] || [ -n "$(find "$KIT_SOURCES" -name '*.swift' -newer "$KIT/libFractonicaKit.a")" ]; then
  echo "== FractonicaKit (static, for checks)"
  if ! xcrun swiftc -swift-version 6 -O -parse-as-library -module-name FractonicaKit -emit-library -static \
      -emit-module -emit-module-path "$KIT/FractonicaKit.swiftmodule" -o "$KIT/libFractonicaKit.a" \
      $(find "$KIT_SOURCES" -name '*.swift' | sort); then
    echo "** FractonicaKit failed to compile" >&2
    exit 1
  fi
fi

STATUS=0
for dir in "$@"; do
  dir="$(cd "$dir" && pwd)" || { STATUS=1; continue; }
  name="$(echo "${dir#"$ROOT"/}" | tr '/' '-')"
  echo "== ${dir#"$ROOT"/}"
  sources=()
  if [ -f "$dir/sources" ]; then
    while IFS= read -r line; do
      line="${line%%#*}"
      line="$(echo "$line" | xargs)"
      [ -z "$line" ] && continue
      for path in "$ROOT"/$line; do sources+=("$path"); done
    done < "$dir/sources"
  fi
  mkdir -p "$OUT/$name"
  if ! xcrun swiftc -swift-version 6 -parse-as-library -I "$KIT" -L "$KIT" -lFractonicaKit \
      "$dir"/*.swift ${sources[@]+"${sources[@]}"} "$ROOT/scripts/CheckSupport.swift" -o "$OUT/$name/checks"; then
    echo "** ${dir#"$ROOT"/} failed to compile"
    STATUS=1
    continue
  fi
  "$OUT/$name/checks" || STATUS=1
done
exit $STATUS
