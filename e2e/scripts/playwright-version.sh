#!/usr/bin/env bash
# Resolve the locked @playwright/test version from e2e/package-lock.json.
# Prints e.g. 1.61.1 to stdout. Exit 1 if unresolved.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCKFILE="${SCRIPT_DIR}/../package-lock.json"

if [[ ! -f "${LOCKFILE}" ]]; then
  echo "package-lock.json not found at ${LOCKFILE}" >&2
  exit 1
fi

version="$(
  sed -n '/"node_modules\/@playwright\/test"/,/}/p' "${LOCKFILE}" \
    | grep '"version"' \
    | head -1 \
    | sed 's/.*"version": "\([^"]*\)".*/\1/'
)"

if [[ -z "${version}" ]]; then
  echo "Could not resolve @playwright/test version from ${LOCKFILE}" >&2
  exit 1
fi

printf '%s\n' "${version}"
