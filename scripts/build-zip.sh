#!/bin/sh
# Zips the extension for upload to the Chrome Web Store and prints the zip's path.
# Usage: scripts/build-zip.sh

set -e
cd "$(dirname "$0")/.."

version=$(node -p 'require("./manifest.json").version')
zip="dist/github-easy-stack-$version.zip"

mkdir -p dist
rm -f "$zip"
zip -q -r -X "$zip" manifest.json src popup icons -x '*.DS_Store'
echo "$zip"
