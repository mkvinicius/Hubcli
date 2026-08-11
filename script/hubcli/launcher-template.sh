#!/usr/bin/env bash
set -euo pipefail

BUN="${HOME}/.bun/bin/bun"
HUBCLI_SRC="__HUBCLI_SRC__"
HUBCLI_CONFIG="${HOME}/.hubcli"
HUBCLI_CREDS="${HOME}/.hubcli/credentials.env"
ORIGINAL_PWD="${PWD}"
HUBCLI_VERSION="__HUBCLI_VERSION__"
HUBCLI_FAST_BIN="${HOME}/.local/bin/hubcli-fast"
HUBCLI_RUNTIME_BIN="${HOME}/.local/bin/hubcli-runtime"

if [ ! -x "$BUN" ]; then
  echo "hubcli: bun not found at $BUN" >&2
  exit 1
fi

if [ ! -d "$HUBCLI_SRC" ]; then
  echo "hubcli: source not found at $HUBCLI_SRC" >&2
  exit 1
fi

HUBCLI_FAST_ENTRY="${HUBCLI_SRC}/src/cli/hubcli/fast.ts"

run_hubcli_fast() {
  if [ -x "$HUBCLI_FAST_BIN" ]; then
    exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 HUBCLI_VERSION="$HUBCLI_VERSION" \
      OPENCODE_CONFIG_DIR="$HUBCLI_CONFIG" "$HUBCLI_FAST_BIN" "$@"
  fi
  if [ -f "$HUBCLI_FAST_ENTRY" ]; then
    exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 HUBCLI_VERSION="$HUBCLI_VERSION" \
      OPENCODE_CONFIG_DIR="$HUBCLI_CONFIG" "$BUN" --conditions=browser "$HUBCLI_FAST_ENTRY" "$@"
  fi
}

case "${1:-}" in
  --version|-v|--help|-h)
    # HUBCLI_DEV=1 always runs from source (never the compiled runtime), so
    # skip this instant fast-path and let execution fall through to the
    # source-mode invocation below, where InstallationVersion resolves to
    # "local" (no OPENCODE_VERSION build-time define exists in source mode).
    if [ "${HUBCLI_DEV:-0}" != "1" ] && [ "$#" -eq 1 ] && [ "${1:-}" = "--version" ]; then
      printf '%s\n' "$HUBCLI_VERSION"
      exit 0
    fi
    if [ "${HUBCLI_DEV:-0}" != "1" ] && [ "$#" -eq 1 ] && [ "${1:-}" = "-v" ]; then
      printf '%s\n' "$HUBCLI_VERSION"
      exit 0
    fi
    if [ "${HUBCLI_DEV:-0}" != "1" ] && [ "$#" -eq 1 ]; then
      run_hubcli_fast "$@"
    fi
    ;;
  profile)
    case "${2:-}" in
      current|list|show)
        run_hubcli_fast "$@"
        ;;
    esac
    ;;
esac

# ---------------------------------------------------------------------------
# Secure credential loader — no eval, no source, whitelist-only parser.
# Accepted variables: DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, NVIDIA_API_KEY
# Skips comments and blank lines. Rejects unknown variable names.
# Fails loudly if the file has insecure permissions.
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
    # Strip leading whitespace
    _creds_line="${_creds_line#"${_creds_line%%[![:space:]]*}"}"
    # Skip blank lines and comments
    [ -z "$_creds_line" ] && continue
    case "$_creds_line" in \#*) continue ;; esac

    # Must contain = separator
    case "$_creds_line" in
      *=*)
        _creds_name="${_creds_line%%=*}"
        _creds_val="${_creds_line#*=}"
        ;;
      *)
        echo "hubcli: credentials.env: unexpected format, skipping line" >&2
        continue
        ;;
    esac

    case "$_creds_name" in
      DASHSCOPE_API_KEY) _creds_dashscope="$_creds_val" ;;
      DEEPSEEK_API_KEY)  _creds_deepseek="$_creds_val"  ;;
      NVIDIA_API_KEY)    _creds_nvidia="$_creds_val"    ;;
      *)
        echo "hubcli: credentials.env: unknown variable '$_creds_name', ignoring" >&2
        ;;
    esac
  done < "$HUBCLI_CREDS"

  # Export only if not already set in the calling environment
  if [ -n "$_creds_dashscope" ] && [ -z "${DASHSCOPE_API_KEY:-}" ]; then
    DASHSCOPE_API_KEY="$_creds_dashscope"; export DASHSCOPE_API_KEY
  fi
  if [ -n "$_creds_deepseek" ] && [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    DEEPSEEK_API_KEY="$_creds_deepseek"; export DEEPSEEK_API_KEY
  fi
  if [ -n "$_creds_nvidia" ] && [ -z "${NVIDIA_API_KEY:-}" ]; then
    NVIDIA_API_KEY="$_creds_nvidia"; export NVIDIA_API_KEY
  fi

  unset _creds_perms _creds_line _creds_name _creds_val _creds_dashscope _creds_deepseek _creds_nvidia
fi

case "${1:-}" in
  auth)
    case "${2:-}" in
      status|providers)
        run_hubcli_fast "$@"
        ;;
    esac
    ;;
  route)
    if [ "${2:-}" = "explain" ]; then
      run_hubcli_fast "$@"
    fi
    ;;
esac

if [ "${HUBCLI_DEV:-0}" != "1" ] && [ -x "$HUBCLI_RUNTIME_BIN" ]; then
  exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 HUBCLI_VERSION="$HUBCLI_VERSION" \
    OPENCODE_CONFIG_DIR="$HUBCLI_CONFIG" "$HUBCLI_RUNTIME_BIN" "$@"
fi

# ---------------------------------------------------------------------------
# Detect whether the caller passed a positional (non-flag) argument.
# If not, inject $ORIGINAL_PWD so opencode opens the caller's directory,
# not packages/opencode (which is where bun --cwd points for module resolution).
# ---------------------------------------------------------------------------
has_positional=false
for arg in "$@"; do
  case "$arg" in
    --) break ;;
    -*) ;;
    *) has_positional=true; break ;;
  esac
done

if ! $has_positional; then
  exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 OPENCODE_CONFIG_DIR="$HUBCLI_CONFIG" \
    "$BUN" run --cwd "$HUBCLI_SRC" --conditions=browser src/index.ts \
    "$ORIGINAL_PWD" "$@"
else
  exec env PWD="$ORIGINAL_PWD" HUBCLI_CALLER_PWD="$ORIGINAL_PWD" HUBCLI_BRAND=1 OPENCODE_CONFIG_DIR="$HUBCLI_CONFIG" \
    "$BUN" run --cwd "$HUBCLI_SRC" --conditions=browser src/index.ts \
    "$@"
fi
