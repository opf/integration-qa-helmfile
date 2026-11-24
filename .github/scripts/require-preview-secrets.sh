#!/usr/bin/env bash
# Fail closed when PullPreview human-login secrets are missing or unsafe to
# interpolate into JSON / URLs / xwiki.cfg (letters, digits, _ and - only).
#
# Env (required):
#   PULLPREVIEW_ADMIN_PASSWORD
#   PULLPREVIEW_USER_PASSWORD
#   PULLPREVIEW_MCP_TOKEN
set -euo pipefail

secret_re='^[A-Za-z0-9_-]{16,}$'

check_secret() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "${value}" ]]; then
    echo "::error::Secret ${name} is not set or empty."
    return 1
  fi
  if [[ ! "${value}" =~ ${secret_re} ]]; then
    echo "::error::Secret ${name} must be at least 16 characters and match ^[A-Za-z0-9_-]+$."
    return 1
  fi
  return 0
}

failed=0
check_secret PULLPREVIEW_ADMIN_PASSWORD "${PULLPREVIEW_ADMIN_PASSWORD:-}" || failed=1
check_secret PULLPREVIEW_USER_PASSWORD "${PULLPREVIEW_USER_PASSWORD:-}" || failed=1
check_secret PULLPREVIEW_MCP_TOKEN "${PULLPREVIEW_MCP_TOKEN:-}" || failed=1
exit "${failed}"
