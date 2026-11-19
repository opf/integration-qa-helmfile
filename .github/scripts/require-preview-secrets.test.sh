#!/usr/bin/env bash
# Assert require-preview-secrets.sh empty / short / charset handling.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/require-preview-secrets.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

good_admin='PullPreviewAdminPass01'
good_user='PullPreviewUserPass01'
good_mcp='PullPreviewMcpToken01'

run() {
  env -i PATH="${PATH}" \
    PULLPREVIEW_ADMIN_PASSWORD="${1-}" \
    PULLPREVIEW_USER_PASSWORD="${2-}" \
    PULLPREVIEW_MCP_TOKEN="${3-}" \
    "${SCRIPT}"
}

if run >/dev/null 2>&1; then
  fail "empty secrets should fail"
fi
pass "empty secrets fail"

if run short "${good_user}" "${good_mcp}" >/dev/null 2>&1; then
  fail "short admin password should fail"
fi
pass "short password fails"

if run 'bad!pass!word!!!!' "${good_user}" "${good_mcp}" >/dev/null 2>&1; then
  fail "unsafe charset should fail"
fi
pass "unsafe charset fails"

if ! run "${good_admin}" "${good_user}" "${good_mcp}" >/dev/null; then
  fail "valid secrets should pass"
fi
pass "valid secrets pass"

# Exactly 16 chars (minimum) with allowed charset.
min16='abcdefghijklmnop'
if ! run "${min16}" "${min16}" "${min16}" >/dev/null; then
  fail "16-char alnum secrets should pass"
fi
pass "minimum length passes"

if run 'PullPreview Admin Pass01' "${good_user}" "${good_mcp}" >/dev/null 2>&1; then
  fail "whitespace in secret should fail"
fi
pass "whitespace rejected"

echo "[PASS] require-preview-secrets"
