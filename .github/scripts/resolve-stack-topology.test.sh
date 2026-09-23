#!/usr/bin/env bash
# Assert resolve-stack-topology.sh outputs and validation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/resolve-stack-topology.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

assert_output() {
  local label="$1"
  local suite="$2"
  local setup="$3"
  shift 3
  local -a expected=("$@")
  local out
  out="$("${SCRIPT}" "${suite}" "${setup}" "preview.test")"
  local line
  for line in "${expected[@]}"; do
    echo "${out}" | grep -qxF "${line}" || fail "${label}: missing ${line} (got: ${out})"
  done
  pass "${label}"
}

assert_fails() {
  local label="$1"
  local suite="$2"
  local setup="$3"
  if "${SCRIPT}" "${suite}" "${setup}" >/dev/null 2>&1; then
    fail "${label}: expected non-zero exit"
  fi
  pass "${label} rejects invalid combo"
}

assert_output "full-stack defaults" "" "sso-external" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=false" \
  "skip_keycloak=false" \
  "xwiki_enabled=true" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test,xwiki.preview.test"

assert_output "mcp oauth2 op-only" "mcp" "oauth2" \
  "stack_profile=op-only" \
  "skip_nextcloud=true" \
  "skip_xwiki=true" \
  "skip_keycloak=true" \
  "xwiki_enabled=false" \
  "proxy_tls_hosts="

assert_output "mcp sso-external op-keycloak" "mcp" "sso-external" \
  "stack_profile=op-keycloak" \
  "skip_nextcloud=true" \
  "skip_xwiki=true" \
  "skip_keycloak=false" \
  "xwiki_enabled=false" \
  "proxy_tls_hosts=keycloak.preview.test"

assert_fails "mcp sso-nextcloud" "mcp" "sso-nextcloud"
assert_fails "mcp unknown setup" "mcp" "bogus"

echo "[PASS] resolve-stack-topology"
