#!/usr/bin/env bash
# =============================================================================
# hubcli — launcher for the distributed (install.sh) package.
#
# Unlike script/hubcli/launcher-template.sh (used by setup.sh for git-checkout
# developer installs, which can fall back to running TypeScript source), this
# launcher ships with NO source and NO Bun dependency: it only ever execs the
# compiled hubcli-runtime binary sitting next to it. HUBCLI_DEV is therefore
# not meaningful here and is intentionally not read.
# =============================================================================
set -euo pipefail

_self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUBCLI_HOME="${HOME}/.hubcli"
HUBCLI_CREDS="${HOME}/.hubcli/credentials.env"
ORIGINAL_PWD="${PWD}"
HUBCLI_VERSION="__HUBCLI_VERSION__"
HUBCLI_RUNTIME_BIN="${_self}/hubcli-runtime"

if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-v" ]; then
  if [ "$#" -eq 1 ]; then
    printf '%s\n' "$HUBCLI_VERSION"
    exit 0
  fi
fi

if [ ! -x "$HUBCLI_RUNTIME_BIN" ]; then
  echo "hubcli: runtime binary not found at $HUBCLI_RUNTIME_BIN (installation may be corrupt — try: install.sh --repair)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Secure credential loader — no eval, no source, whitelist-only parser.
# Accepted variables: DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, NVIDIA_API_KEY
# Does not override variables already set in the calling environment.
# ---------------------------------------------------------------------------
if [ -f "$HUBCLI_CREDS" ]; then
  _creds_perms=$(stat -f "%Lp" "$HUBCLI_CREDS" 2>/dev/null || stat -c "%a" "$HUBCLI_CREDS" 2>/dev/null || echo "unknown")
  if [ "$_creds_perms" != "600" ]; then
    echo "hubcli: credentials file has insecure permissions ($_creds_perms). Run: chmod 600 $HUBCLI_CREDS" >&2
    exit 1
  fi

  _creds_dashscope=""
  _creds_deepseek=""
  _creds_nvidia=""

  while IFS= read -r _creds_line || [ -n "$_creds_line" ]; do
    _creds_line="${_creds_line#"${_creds_line%%[![:space:]]*}"}"
    [ -z "$_creds_line" ] && continue
    case "$_creds_line" in \#*) continue ;; esac
    case "$_creds_line" in
      *=*)
        _creds_name="${_creds_line%%=*}"
        _creds_val="${_creds_line#*=}"
        ;;
      *) continue ;;
    esac
    case "$_creds_name" in
      DASHSCOPE_API_KEY) _creds_dashscope="$_creds_val" ;;
      DEEPSEEK_API_KEY)  _creds_deepseek="$_creds_val"  ;;
      NVIDIA_API_KEY)    _creds_nvidia="$_creds_val"    ;;
      *) echo "hubcli: credentials.env: unknown variable '$_creds_name', ignoring" >&2 ;;
    esac
  done < "$HUBCLI_CREDS"

  if [ -n "$_creds_dashscope" ] && [ -z "${DASHSCOPE_API_KEY:-}" ]; then DASHSCOPE_API_KEY="$_creds_dashscope"; export DASHSCOPE_API_KEY; fi
  if [ -n "$_creds_deepseek" ] && [ -z "${DEEPSEEK_API_KEY:-}" ]; then DEEPSEEK_API_KEY="$_creds_deepseek"; export DEEPSEEK_API_KEY; fi
  if [ -n "$_creds_nvidia" ] && [ -z "${NVIDIA_API_KEY:-}" ]; then NVIDIA_API_KEY="$_creds_nvidia"; export NVIDIA_API_KEY; fi

  unset _creds_perms _creds_line _creds_name _creds_val _creds_dashscope _creds_deepseek _creds_nvidia
fi

exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 HUBCLI_VERSION="$HUBCLI_VERSION" \
  OPENCODE_CONFIG_DIR="$HUBCLI_HOME" "$HUBCLI_RUNTIME_BIN" "$@"
