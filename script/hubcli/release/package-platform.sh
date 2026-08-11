#!/usr/bin/env bash
# =============================================================================
# package-platform.sh — packages a previously-built platform (see
# build-platform.sh) into a distributable archive:
#   hubcli-<target>.tar.gz  (macOS/Linux)
#   hubcli-<target>.zip     (Windows)
#
# Package contents (per SUPER PROMPT spec): hubcli(.exe launcher),
# hubcli-runtime(.exe), hubcli-fast(.exe), LICENSE, README.txt.
# No source code, no .git, no node_modules.
#
# Usage: bash package-platform.sh <target> <output-dir>
# =============================================================================
set -euo pipefail

TARGET="${1:-}"
OUT_DIR="${2:-}"
[ -z "$TARGET" ] && { echo "usage: package-platform.sh <target> <output-dir>" >&2; exit 1; }
[ -z "$OUT_DIR" ] && { echo "usage: package-platform.sh <target> <output-dir>" >&2; exit 1; }

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_dir}/../../.." && pwd)"
OPENCODE_DIR="${REPO_ROOT}/packages/opencode"
BUILD_DIR="${OPENCODE_DIR}/dist/opencode-${TARGET}/bin"

HUBCLI_VERSION="$(bash "${REPO_ROOT}/script/hubcli/resolve-version.sh")"

BUILD_OS="${TARGET%-*}"
EXE_SUFFIX=""
[ "$BUILD_OS" = "windows" ] && EXE_SUFFIX=".exe"

RUNTIME_BIN="${BUILD_DIR}/hubcli-runtime${EXE_SUFFIX}"
FAST_BIN="${BUILD_DIR}/hubcli-fast${EXE_SUFFIX}"
for f in "$RUNTIME_BIN" "$FAST_BIN"; do
  if [ ! -f "$f" ]; then
    echo "package-platform.sh: missing build output: $f — run build-platform.sh first" >&2
    exit 1
  fi
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PKG_NAME="hubcli-${TARGET}"
PKG_DIR="${STAGE}/${PKG_NAME}"
mkdir -p "$PKG_DIR"

cp "$RUNTIME_BIN" "$PKG_DIR/hubcli-runtime${EXE_SUFFIX}"
cp "$FAST_BIN" "$PKG_DIR/hubcli-fast${EXE_SUFFIX}"
chmod 755 "$PKG_DIR"/hubcli-runtime${EXE_SUFFIX} "$PKG_DIR"/hubcli-fast${EXE_SUFFIX} 2>/dev/null || true

cp "${REPO_ROOT}/LICENSE" "$PKG_DIR/LICENSE"

sed -e "s|__HUBCLI_VERSION__|${HUBCLI_VERSION}|g" -e "s|__HUBCLI_TARGET__|${TARGET}|g" \
  "${_dir}/README.txt.tmpl" > "$PKG_DIR/README.txt"

if [ "$BUILD_OS" = "windows" ]; then
  sed "s|__HUBCLI_VERSION__|${HUBCLI_VERSION}|g" "${_dir}/hubcli.ps1" > "$PKG_DIR/hubcli.ps1"
  cp "${_dir}/hubcli.cmd" "$PKG_DIR/hubcli.cmd"
else
  sed "s|__HUBCLI_VERSION__|${HUBCLI_VERSION}|g" "${_dir}/hubcli-dist-launcher.sh" > "$PKG_DIR/hubcli"
  chmod 755 "$PKG_DIR/hubcli"
fi

mkdir -p "$OUT_DIR"
if [ "$BUILD_OS" = "windows" ]; then
  ARCHIVE="${OUT_DIR}/${PKG_NAME}.zip"
  rm -f "$ARCHIVE"
  (cd "$STAGE" && zip -rq "$ARCHIVE" "$PKG_NAME")
else
  ARCHIVE="${OUT_DIR}/${PKG_NAME}.tar.gz"
  tar -C "$STAGE" -czf "$ARCHIVE" "$PKG_NAME"
fi

echo "package-platform.sh: wrote $ARCHIVE"
