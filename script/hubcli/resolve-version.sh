#!/usr/bin/env bash
# =============================================================================
# resolve-version.sh — single source of truth for the HubCli version string.
#
# Used by setup.sh (launcher template + compiled runtime build) so the
# version is never hardcoded in more than one place. Preference order:
#   1. exact git tag at HEAD matching hubcli-v* (the real release marker)
#   2. script/hubcli/VERSION file (tracked in git — the "next" version,
#      used before that tag exists yet)
#   3. "local" fallback (should not normally be hit for a release build)
#
# Prints the resolved version to stdout. No side effects.
# =============================================================================
set -euo pipefail

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_repo="$(cd "${_dir}/../.." && pwd)"

if command -v git >/dev/null 2>&1 && [ -d "${_repo}/.git" ]; then
  _tag="$(git -C "$_repo" describe --tags --exact-match --match 'hubcli-v*' HEAD 2>/dev/null || true)"
  if [ -n "$_tag" ]; then
    printf '%s\n' "$_tag"
    exit 0
  fi
fi

if [ -f "${_dir}/VERSION" ]; then
  _v="$(tr -d '[:space:]' < "${_dir}/VERSION")"
  if [ -n "$_v" ]; then
    printf '%s\n' "$_v"
    exit 0
  fi
fi

printf 'local\n'
