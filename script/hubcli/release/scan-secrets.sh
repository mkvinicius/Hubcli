#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 0 ]; then
  ROOTS=("$@")
else
  ROOTS=(packages script .github)
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

echo "Scanning for forbidden secret files..."
while IFS= read -r file; do
  [ -n "$file" ] || continue
  report "Forbidden secret file found: $file"
done < <(find "${ROOTS[@]}" \( -iname "credentials.env" -o -iname "auth.json" \) -print 2>/dev/null || true)

echo "Scanning for obvious key literals..."
while IFS= read -r hit; do
  file=${hit%%:*}
  if is_allowed_fixture "$file"; then
    continue
  fi
  report "Possible secret literal found: $hit"
done < <(
  grep -RInE \
    "sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|DASHSCOPE_API_KEY[=:][A-Za-z0-9_./+=-]{12,}|DEEPSEEK_API_KEY[=:][A-Za-z0-9_./+=-]{12,}|NVIDIA_API_KEY[=:][A-Za-z0-9_./+=-]{12,}" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
    --include="*.sh" --include="*.ps1" --include="*.yml" --include="*.yaml" --include="*.json" \
    "${ROOTS[@]}" 2>/dev/null || true
)

echo "Scanning for developer machine paths..."
FORBIDDEN_USER=${HUBCLI_FORBIDDEN_USER:-maikonviniciussilva}
FORBIDDEN_HOME="/Users/${FORBIDDEN_USER}"
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  report "Developer path found: $hit"
done < <(
  grep -RInF "$FORBIDDEN_HOME" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.cjs" \
    --include="*.sh" --include="*.ps1" --include="*.yml" --include="*.yaml" --include="*.json" \
    "${ROOTS[@]}" 2>/dev/null || true
)

if [ "$fail" -ne 0 ]; then
  echo "Secret scan failed." >&2
  exit 1
fi

echo "Secret scan passed."
