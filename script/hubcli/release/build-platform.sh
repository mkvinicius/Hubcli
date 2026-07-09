#!/usr/bin/env bash
# =============================================================================
# build-platform.sh — compiles hubcli-runtime + hubcli-fast for one platform,
# using the OpenCode project's own official build mechanism
# (packages/opencode/script/build.ts, Bun's built-in cross-compilation).
#
# Usage:
#   bash build-platform.sh <target> [--skip-install] [--skip-embed-web-ui]
#
# <target> is one of: darwin-x64 darwin-arm64 linux-x64 linux-arm64 windows-x64
#
# Output (relative to the target's build dir, printed at the end):
#   hubcli-runtime[.exe]
#   hubcli-fast[.exe]
# =============================================================================
set -euo pipefail

TARGET="${1:-}"
shift || true
EXTRA_ARGS=("$@")

case "$TARGET" in
  darwin-x64|darwin-arm64|linux-x64|linux-arm64|windows-x64) ;;
  *)
    echo "build-platform.sh: unsupported target '$TARGET' (expected darwin-x64, darwin-arm64, linux-x64, linux-arm64, windows-x64)" >&2
    exit 1
    ;;
esac

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_dir}/../../.." && pwd)"
OPENCODE_DIR="${REPO_ROOT}/packages/opencode"
BUN="$(command -v bun 2>/dev/null || echo "${HOME}/.bun/bin/bun")"

HUBCLI_VERSION="$(bash "${REPO_ROOT}/script/hubcli/resolve-version.sh")"
echo "build-platform.sh: target=$TARGET version=$HUBCLI_VERSION"

# Split "linux-x64" -> build.ts wants "linux-x64" as --target (already matches);
# "windows-x64" is accepted by build.ts's --target flag as an alias for win32.
BUILD_OS="${TARGET%-*}"
BUILD_ARCH="${TARGET##*-}"

# Bun's own compile-target naming for standalone executables.
case "$BUILD_OS" in
  darwin)  BUN_COMPILE_OS="darwin" ;;
  linux)   BUN_COMPILE_OS="linux" ;;
  windows) BUN_COMPILE_OS="windows" ;;
esac
BUN_COMPILE_TARGET="bun-${BUN_COMPILE_OS}-${BUILD_ARCH}"

EXE_SUFFIX=""
[ "$BUILD_OS" = "windows" ] && EXE_SUFFIX=".exe"

# ---------------------------------------------------------------------------
# 1. hubcli-runtime — full OpenCode/HubCli binary (official build.ts mechanism)
# ---------------------------------------------------------------------------
echo "build-platform.sh: building hubcli-runtime ($TARGET)..."
HUBCLI_VERSION="$HUBCLI_VERSION" "$BUN" run --cwd "$OPENCODE_DIR" script/build.ts --target="$TARGET" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

_runtime_src="${OPENCODE_DIR}/dist/opencode-${TARGET}/bin/opencode${EXE_SUFFIX}"
if [ ! -f "$_runtime_src" ]; then
  echo "build-platform.sh: expected runtime binary not found: $_runtime_src" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. hubcli-fast — small utility binary (fast.ts), compiled for the same target
# ---------------------------------------------------------------------------
_fast_entry="${OPENCODE_DIR}/src/cli/hubcli/fast.ts"
_fast_out="${OPENCODE_DIR}/dist/opencode-${TARGET}/bin/hubcli-fast${EXE_SUFFIX}"
echo "build-platform.sh: building hubcli-fast ($TARGET, $BUN_COMPILE_TARGET)..."
"$BUN" build --compile --minify --conditions=browser --target="$BUN_COMPILE_TARGET" \
  --outfile "$_fast_out" "$_fast_entry" >/dev/null

_runtime_out="${OPENCODE_DIR}/dist/opencode-${TARGET}/bin/hubcli-runtime${EXE_SUFFIX}"
mv "$_runtime_src" "$_runtime_out"

echo "build-platform.sh: done"
echo "  runtime: $_runtime_out"
echo "  fast:    $_fast_out"
