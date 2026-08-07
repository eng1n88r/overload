#!/usr/bin/env bash
# Downloads the free-exercise-db (public domain, github.com/yuhonas/free-exercise-db)
# exercise catalog + images into apps/server/prisma/seed-data/.
# The results are committed so builds and seeding work offline.
#
# Linux/macOS counterpart to fetch-exercise-db.ps1. Needs curl and unzip.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/apps/server/prisma/seed-data"
tmp="$(mktemp -d)"
# Leave nothing behind, including on failure part way through.
trap 'rm -rf "$tmp"' EXIT

for cmd in curl unzip; do
  command -v "$cmd" >/dev/null || { echo "error: $cmd is required" >&2; exit 1; }
done

mkdir -p "$dest"
echo "Downloading free-exercise-db..."
curl -fsSL 'https://github.com/yuhonas/free-exercise-db/archive/refs/heads/main.zip' -o "$tmp/main.zip"
unzip -q "$tmp/main.zip" -d "$tmp"
src="$tmp/free-exercise-db-main"

cp "$src/dist/exercises.json" "$dest/exercises.json"
# Replace rather than merge: an exercise dropped upstream should disappear here too.
rm -rf "$dest/images"
cp -r "$src/exercises" "$dest/images"
find "$dest/images" -name '*.json' -delete

echo "Done. $(find "$dest/images" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') exercise image folders."
