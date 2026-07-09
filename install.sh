#!/usr/bin/env bash
# =============================================================================
# HubCli installer — macOS / Linux
#
#   curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.sh | bash
#
# Installs HubCli without requiring Git or Bun: downloads a prebuilt
# platform archive + checksums from the official GitHub repository, verifies
# the SHA-256 checksum, and installs the three binaries (hubcli, hubcli-fast,
# hubcli-runtime) atomically. Never touches ~/.hubcli (config/credentials)
# except to create it with a template on first install.
#
# Flags:
#   --version <v>        install a specific version (default: latest release)
#   --install-dir <dir>  binary install directory (default: ~/.local/bin)
#   --check              report installed state, change nothing
#   --repair             reinstall binaries, preserve ~/.hubcli
#   --dry-run            print what would happen, change nothing
#   --uninstall           remove installed binaries (never touches ~/.hubcli
#                         config/credentials without a separate --purge-data
#                         confirmation prompt)
#   --help
#
# Safety:
#   - never accepts API keys as arguments
#   - never uses sudo
#   - only downloads from github.com/mkvinicius/Hubcli
#   - aborts (installs nothing) on checksum mismatch
#   - backs up the previous binaries before overwriting; rolls back on
#     smoke-test failure
# =============================================================================
set -euo pipefail

REPO="mkvinicius/Hubcli"
GITHUB_API="https://api.github.com/repos/${REPO}"
GITHUB_RELEASES="https://github.com/${REPO}/releases/download"

INSTALL_DIR="${HUBCLI_BIN_DIR:-${HOME}/.local/bin}"
HUBCLI_HOME="${HOME}/.hubcli"
REQUESTED_VERSION="${HUBCLI_VERSION:-}"
MODE="install"   # install | check | repair | dry-run | uninstall
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# Escape hatch for local testing / air-gapped installs: point at a local
# directory (containing hubcli-<target>.tar.gz + checksums-sha256.txt)
# instead of GitHub Releases. Never advertised in --help; not needed for
# the normal curl-pipe-bash flow.
SOURCE_DIR="${HUBCLI_INSTALL_SOURCE:-}"

_info()  { printf '  \033[0;34m•\033[0m %s\n' "$*"; }
_ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
_warn()  { printf '  \033[0;33m!\033[0m %s\n' "$*"; }
_fail()  { printf '  \033[0;31m✗\033[0m %s\n' "$*" >&2; }
abort()  { _fail "$*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh [--version <v>] [--install-dir <dir>] [--check] [--repair] [--dry-run] [--uninstall] [--help]

Installs HubCli (github.com/mkvinicius/Hubcli) without requiring Git or Bun.
Never pass API keys to this script; add them to ~/.hubcli/credentials.env
after installing.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) REQUESTED_VERSION="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --repair) MODE="repair"; shift ;;
    --dry-run) MODE="dry-run"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) abort "Unknown argument: $1 (see --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. Detect OS + architecture, map to a package target name
# ---------------------------------------------------------------------------
_uname_s="$(uname -s)"
case "$_uname_s" in
  Darwin) HUBCLI_OS="darwin" ;;
  Linux)  HUBCLI_OS="linux" ;;
  *) abort "Unsupported OS: $_uname_s (HubCli installer supports macOS and Linux; see install.ps1 for Windows)" ;;
esac

_uname_m="$(uname -m)"
case "$_uname_m" in
  x86_64|amd64) HUBCLI_ARCH="x64" ;;
  arm64|aarch64) HUBCLI_ARCH="arm64" ;;
  *) abort "Unsupported architecture: $_uname_m" ;;
esac

TARGET="${HUBCLI_OS}-${HUBCLI_ARCH}"
PKG_NAME="hubcli-${TARGET}"
_info "Detected platform: $TARGET"

if [ "$MODE" = "uninstall" ]; then
  _info "Uninstalling HubCli binaries from $INSTALL_DIR"
  for bin in hubcli hubcli-fast hubcli-runtime; do
    if [ -f "${INSTALL_DIR}/${bin}" ]; then
      rm -f "${INSTALL_DIR}/${bin}"
      _ok "Removed ${INSTALL_DIR}/${bin}"
    fi
  done
  _ok "~/.hubcli (config, credentials, profiles) was left untouched."
  exit 0
fi

if [ "$MODE" = "check" ]; then
  _info "Checking installed HubCli state (no changes)"
  [ -x "${INSTALL_DIR}/hubcli" ] && _ok "hubcli present: ${INSTALL_DIR}/hubcli" || _warn "hubcli not installed at ${INSTALL_DIR}/hubcli"
  [ -x "${INSTALL_DIR}/hubcli-runtime" ] && _ok "hubcli-runtime present" || _warn "hubcli-runtime missing"
  [ -x "${INSTALL_DIR}/hubcli-fast" ] && _ok "hubcli-fast present" || _warn "hubcli-fast missing"
  [ -f "${HUBCLI_HOME}/opencode.json" ] && _ok "config present: ${HUBCLI_HOME}/opencode.json" || _warn "config missing"
  [ -f "${HUBCLI_HOME}/credentials.env" ] && _ok "credentials present: ${HUBCLI_HOME}/credentials.env" || _warn "credentials missing (optional)"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Resolve version (explicit, or GitHub latest release)
# ---------------------------------------------------------------------------
resolve_latest_version() {
  if ! command -v curl >/dev/null 2>&1; then
    abort "curl is required to resolve the latest release (or pass --version explicitly)"
  fi
  curl -fsSL "${GITHUB_API}/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
}

if [ -z "$REQUESTED_VERSION" ]; then
  if [ -n "$SOURCE_DIR" ]; then
    REQUESTED_VERSION="local"
  else
    _info "Resolving latest release..."
    REQUESTED_VERSION="$(resolve_latest_version)"
    [ -z "$REQUESTED_VERSION" ] && abort "Could not resolve the latest release from GitHub. Pass --version explicitly."
  fi
fi
_info "Version: $REQUESTED_VERSION"

# ---------------------------------------------------------------------------
# 3. Download archive + checksums (official repo only), verify SHA-256
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fetch() {
  local name="$1" dest="$2"
  if [ -n "$SOURCE_DIR" ]; then
    [ -f "${SOURCE_DIR}/${name}" ] || abort "Local source missing: ${SOURCE_DIR}/${name}"
    cp "${SOURCE_DIR}/${name}" "$dest"
  else
    local url="${GITHUB_RELEASES}/${REQUESTED_VERSION}/${name}"
    _info "Downloading $url"
    curl -fsSL "$url" -o "$dest" || abort "Download failed: $url"
  fi
}

ARCHIVE_NAME="${PKG_NAME}.tar.gz"
fetch "$ARCHIVE_NAME" "${WORK_DIR}/${ARCHIVE_NAME}"
fetch "checksums-sha256.txt" "${WORK_DIR}/checksums-sha256.txt"

_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_expected="$(grep -E "  ${ARCHIVE_NAME}\$|  ${ARCHIVE_NAME}\$" "${WORK_DIR}/checksums-sha256.txt" | awk '{print $1}' | head -1)"
[ -z "$_expected" ] && abort "No checksum entry found for $ARCHIVE_NAME in checksums-sha256.txt — refusing to install"
_actual="$(_sha256 "${WORK_DIR}/${ARCHIVE_NAME}")"
if [ "$_expected" != "$_actual" ]; then
  abort "Checksum mismatch for $ARCHIVE_NAME (expected $_expected, got $_actual). Nothing was installed."
fi
_ok "Checksum verified: $ARCHIVE_NAME"

if [ "$MODE" = "dry-run" ]; then
  _info "(--dry-run) Would install hubcli, hubcli-runtime, hubcli-fast into $INSTALL_DIR"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Extract, back up existing binaries, install atomically
# ---------------------------------------------------------------------------
tar -xzf "${WORK_DIR}/${ARCHIVE_NAME}" -C "$WORK_DIR"
EXTRACTED="${WORK_DIR}/${PKG_NAME}"
[ -d "$EXTRACTED" ] || abort "Unexpected archive layout: $EXTRACTED not found"

mkdir -p "$INSTALL_DIR"
mkdir -p "$HUBCLI_HOME"
chmod 700 "$HUBCLI_HOME" 2>/dev/null || true

BACKUP_DIR=""
for bin in hubcli hubcli-runtime hubcli-fast; do
  if [ -f "${INSTALL_DIR}/${bin}" ]; then
    BACKUP_DIR="${INSTALL_DIR}/.hubcli-backup-${TIMESTAMP}"
    mkdir -p "$BACKUP_DIR"
    cp "${INSTALL_DIR}/${bin}" "${BACKUP_DIR}/${bin}"
  fi
done
[ -n "$BACKUP_DIR" ] && _info "Backed up previous binaries to $BACKUP_DIR"

for bin in hubcli hubcli-runtime hubcli-fast; do
  src="${EXTRACTED}/${bin}"
  [ -f "$src" ] || abort "Archive is missing $bin"
  tmp="${INSTALL_DIR}/${bin}.tmp.${TIMESTAMP}"
  cp "$src" "$tmp"
  chmod 755 "$tmp"
  mv "$tmp" "${INSTALL_DIR}/${bin}"
done
_ok "Installed hubcli, hubcli-runtime, hubcli-fast to $INSTALL_DIR"

# ---------------------------------------------------------------------------
# 5. Config — created once, never overwritten
# ---------------------------------------------------------------------------
if [ ! -f "${HUBCLI_HOME}/opencode.json" ]; then
  cat > "${HUBCLI_HOME}/opencode.json" << 'JSONEOF'
{
  "$schema": "https://opencode.ai/config.json"
}
JSONEOF
  _ok "Created ${HUBCLI_HOME}/opencode.json"
else
  _ok "${HUBCLI_HOME}/opencode.json preserved"
fi

if [ ! -f "${HUBCLI_HOME}/credentials.env" ]; then
  cat > "${HUBCLI_HOME}/credentials.env" << 'CREDSEOF'
# HubCli credentials — never share this file. Permissions must stay 600.
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
NVIDIA_API_KEY=
CREDSEOF
  chmod 600 "${HUBCLI_HOME}/credentials.env"
  _ok "Created ${HUBCLI_HOME}/credentials.env (600, empty template)"
else
  _ok "${HUBCLI_HOME}/credentials.env preserved"
fi

[ -f "${HUBCLI_HOME}/profiles.json" ] && _ok "${HUBCLI_HOME}/profiles.json preserved"

# ---------------------------------------------------------------------------
# 6. Smoke test — rollback on failure
# ---------------------------------------------------------------------------
if ! "${INSTALL_DIR}/hubcli" --version >/dev/null 2>&1; then
  _fail "Smoke test failed (hubcli --version). Rolling back."
  if [ -n "$BACKUP_DIR" ]; then
    for bin in hubcli hubcli-runtime hubcli-fast; do
      [ -f "${BACKUP_DIR}/${bin}" ] && cp "${BACKUP_DIR}/${bin}" "${INSTALL_DIR}/${bin}"
    done
    _warn "Restored previous binaries from $BACKUP_DIR"
  else
    rm -f "${INSTALL_DIR}/hubcli" "${INSTALL_DIR}/hubcli-runtime" "${INSTALL_DIR}/hubcli-fast"
    _warn "Removed the failed install (no previous version to restore)"
  fi
  abort "Installation aborted."
fi
_ok "Smoke test passed: $("${INSTALL_DIR}/hubcli" --version)"

if echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  _ok "$INSTALL_DIR is on PATH"
else
  _warn "$INSTALL_DIR is not on PATH. Add it to your shell profile:"
  printf '      export PATH="%s:$PATH"\n' "$INSTALL_DIR"
fi

printf '\n'
_ok "HubCli installed. Try:"
printf '      hubcli --version\n      hubcli doctor\n      hubcli auth status\n'
