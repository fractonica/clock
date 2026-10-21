#!/bin/sh
# Xcode pre-build phase of both app targets: copies the web app's diary renderer into the bundle as
# Resources/web/ (web/fractonica.js and web/src/…, the same relative layout as the repository root), so the
# Diary feature can load it into a WKWebView. rsync only rewrites what changed, so running it on every build is cheap.
set -eu
dest="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/web"
mkdir -p "$dest"
rsync -a --delete --exclude '.DS_Store' "${SRCROOT}/../fractonica.js" "${SRCROOT}/../src" "$dest/"
