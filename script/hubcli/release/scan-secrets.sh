#!/usr/bin/env bash
set -euo pipefail

MODE="source"
if [ "${1:-}" = "--package" ]; then
  MODE="package"
  shift
fi

EXPLICIT_ROOTS=0
if [ "$#" -gt 0 ]; then
  EXPLICIT_ROOTS=1
  ROOTS=("$@")
elif [ "$MODE" = "package" ]; then
  echo "usage: scan-secrets.sh [--package] [path ...]" >&2
  exit 2
else
  ROOTS=()
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

is_allowed_documentation_placeholder() {
  local placeholder="nvapi-your-key""-here"
  case "$1" in
    packages/web/src/content/docs/providers.mdx:*NVIDIA_API_KEY="${placeholder}"*) return 0 ;;
    *) return 1 ;;
  esac
}

is_excluded_source_path() {
  case "/$1/" in
    */node_modules/*|*/.git/*|*/dist/*|*/build/*|*/coverage/*|*/.cache/*|*/.caches/*|*/.tmp/*|*/.temp/*|*/.turbo/*|*/.next/*|*/.parcel-cache/*)
      return 0
      ;;
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

SOURCE_FILES=()
SOURCE_FILE_COUNT=0
FORBIDDEN_SOURCE_FILES=()
FORBIDDEN_SOURCE_FILE_COUNT=0
collect_source_files() {
  local file relative

  if [ "$EXPLICIT_ROOTS" -eq 0 ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    while IFS= read -r -d '' file; do
      if ! is_excluded_source_path "$file"; then
        SOURCE_FILES+=("$file")
        SOURCE_FILE_COUNT=$((SOURCE_FILE_COUNT + 1))
      fi
    done < <(git ls-files -z)
    while IFS= read -r -d '' file; do
      if ! is_excluded_source_path "$file"; then
        FORBIDDEN_SOURCE_FILES+=("$file")
        FORBIDDEN_SOURCE_FILE_COUNT=$((FORBIDDEN_SOURCE_FILE_COUNT + 1))
      fi
    done < <(
      git ls-files -z --cached --others --ignored --exclude-standard -- \
        ':(glob)**/credentials.env' ':(glob)**/auth.json'
    )
    echo "Scanning tracked files from git ls-files..."
    return
  fi

  if [ "$EXPLICIT_ROOTS" -eq 0 ]; then
    ROOTS=(packages script .github docs install.sh install.ps1)
  fi

  while IFS= read -r -d '' file; do
    relative="$(relative_source_path "$file")"
    if ! is_excluded_source_path "$relative"; then
      SOURCE_FILES+=("$file")
      SOURCE_FILE_COUNT=$((SOURCE_FILE_COUNT + 1))
    fi
  done < <(
    find "${ROOTS[@]}" \
      \( -type d \( \
        -name node_modules -o -name .git -o -name dist -o -name build -o -name coverage \
        -o -name .cache -o -name .caches -o -name .tmp -o -name .temp -o -name .turbo \
        -o -name .next -o -name .parcel-cache \
      \) -prune \) -o -type f -print0 2>/dev/null
  )
  echo "Scanning explicitly supplied source paths..."
}

KEY_PATTERN="sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|DASHSCOPE_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}|DEEPSEEK_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}|NVIDIA_API_KEY[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_./+=-]{12,}"
FORBIDDEN_USER=${HUBCLI_FORBIDDEN_USER:-maikonviniciussilva}
FORBIDDEN_HOME="/Users/${FORBIDDEN_USER}"

if [ "$MODE" = "source" ]; then
  collect_source_files

  if [ "$SOURCE_FILE_COUNT" -gt 0 ]; then
    echo "Scanning for forbidden files..."
    for file in "${SOURCE_FILES[@]}"; do
      case "${file##*/}" in
        credentials.env|auth.json) report "Forbidden file found: $file" ;;
      esac
    done
    if [ "$FORBIDDEN_SOURCE_FILE_COUNT" -gt 0 ]; then
      for file in "${FORBIDDEN_SOURCE_FILES[@]}"; do
        report "Forbidden file found: $file"
      done
    fi

    echo "Scanning for obvious key literals..."
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      file=${hit%%:*}
      if is_allowed_fixture "$(relative_source_path "$file")"; then
        continue
      fi
      if is_allowed_documentation_placeholder "$hit"; then
        continue
      fi
      report "Possible secret literal found: $hit"
    done < <(grep -InHE "$KEY_PATTERN" "${SOURCE_FILES[@]}" 2>/dev/null || true)

    echo "Scanning for developer machine paths..."
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      report "Developer path found: $hit"
    done < <(grep -InHF "$FORBIDDEN_HOME" "${SOURCE_FILES[@]}" 2>/dev/null || true)
  fi
else
  echo "Scanning package paths for forbidden files..."
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    report "Forbidden file found: $file"
  done < <(
    find "${ROOTS[@]}" \( -iname "credentials.env" -o -iname "auth.json" -o -iname ".git" -o -iname "node_modules" \) -print 2>/dev/null || true
  )

  echo "Scanning package paths for obvious key literals..."
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    report "Possible secret literal found: $hit"
  done < <(grep -RInaE "$KEY_PATTERN" "${ROOTS[@]}" 2>/dev/null || true)

  echo "Scanning package paths for developer machine paths..."
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    report "Developer path found: $hit"
  done < <(grep -RInaF "$FORBIDDEN_HOME" "${ROOTS[@]}" 2>/dev/null || true)
fi

if [ "$fail" -ne 0 ]; then
  echo "Secret scan failed." >&2
  exit 1
fi

echo "Secret scan passed."
