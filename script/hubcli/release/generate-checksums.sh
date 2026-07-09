#!/usr/bin/env bash
# =============================================================================
# generate-checksums.sh — writes checksums-sha256.txt for every file in a
# release output directory (archives + install.sh + install.ps1).
# Format per line: <sha256>  <filename>   (matches sha256sum's default output,
# which shasum -a 256 on macOS also produces).
# =============================================================================
set -euo pipefail

OUT_DIR="${1:-}"
[ -z "$OUT_DIR" ] && { echo "usage: generate-checksums.sh <output-dir>" >&2; exit 1; }
[ -d "$OUT_DIR" ] || { echo "generate-checksums.sh: not a directory: $OUT_DIR" >&2; exit 1; }

_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

_checksums="${OUT_DIR}/checksums-sha256.txt"
: > "$_checksums"

cd "$OUT_DIR"
for f in *.tar.gz *.zip install.sh install.ps1; do
  [ -f "$f" ] || continue
  [ "$f" = "checksums-sha256.txt" ] && continue
  _sha256 "$f" >> "$_checksums"
done

echo "generate-checksums.sh: wrote $_checksums"
cat "$_checksums"
