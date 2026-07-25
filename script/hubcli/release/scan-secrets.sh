#!/usr/bin/env bash
set -euo pipefail

MODE="source"
if [ "${1:-}" = "--package" ]; then
  MODE="package"
  shift
fi

if [ "$#" -gt 0 ]; then
  ROOTS=("$@")
elif [ "$MODE" = "source" ]; then
  ROOTS=(packages script .github docs install.sh install.ps1)
else
  echo "usage: scan-secrets.sh [--package] [path ...]" >&2
  exit 2
fi

fail=0

report() {
  printf '%s\n' "$1" >&2
  fail=1
}

is_allowed_fixture() {
  case "$1" in
    packages/http-recorder/test/record-replay.test.ts) return 0 ;;
    packages/opencode/test/cli/cmd/doctor.test.ts) return 0 ;;
    packages/opencode/test/cli/hubcli/mcp-serve.test.ts) return 0 ;;
    packages/opencode/test/cli/hubcli/release-packaging.test.ts) return 0 ;;
    *) return 1 ;;
  esac
}

relative_source_path() {
  local file="$1"
  file="${file#./}"
  if [[ "$file" = "$PWD/"* ]]; then
    file="${file#"$PWD/"}"
  fi
  printf '%s\n' "$file"
}

echo "Scanning for forbidden files..."
while IFS= read -r file; do
  [ -n "$file" ] || continue
  report "Forbidden file found: $file"
done < <(
  if [ "$MODE" = "package" ]; then
    find "${ROOTS[@]}" \( -iname "credentials.env" -o -iname "auth.json" -o -iname ".git" -o -iname "node_modules" \) -print 2>/dev/null || true
  else
    find "${ROOTS[@]}" \( -iname "credentials.env" -o -iname "auth.json" \) -print 2>/dev/null || true
  fi
)

echo "Scanning for obvious key literals..."
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  if [ "$MODE" = "source" ] && is_allowed_fixture "$(relative_source_path "$file")"; then
    continue
  fi
  report "Possible secret literal found: $hit"
done < <(
  KEY_PATTERN="sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|DASHSCOPE_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}|DEEPSEEK_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}|NVIDIA_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}"
  if [ "$MODE" = "package" ]; then
    grep -RInaE "$KEY_PATTERN" "${ROOTS[@]}" 2>/dev/null || true
  else
    grep -RInE "$KEY_PATTERN" \
      --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
      --include="*.sh" --include="*.ps1" --include="*.yml" --include="*.yaml" --include="*.json" \
      --include="*.md" --include="*.txt" --include="*.env" \
      "${ROOTS[@]}" 2>/dev/null || true
  fi
)

echo "Scanning for developer machine paths..."
FORBIDDEN_USER=${HUBCLI_FORBIDDEN_USER:-maikonviniciussilva}
FORBIDDEN_HOME="/Users/${FORBIDDEN_USER}"
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  report "Developer path found: $hit"
done < <(
  if [ "$MODE" = "package" ]; then
    grep -RInaF "$FORBIDDEN_HOME" "${ROOTS[@]}" 2>/dev/null || true
  else
    grep -RInF "$FORBIDDEN_HOME" \
      --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
      --include="*.sh" --include="*.ps1" --include="*.yml" --include="*.yaml" --include="*.json" \
      --include="*.md" --include="*.txt" --include="*.env" \
      "${ROOTS[@]}" 2>/dev/null || true
  fi
)

if [ "$fail" -ne 0 ]; then
  echo "Secret scan failed." >&2
  exit 1
fi

echo "Secret scan passed."
