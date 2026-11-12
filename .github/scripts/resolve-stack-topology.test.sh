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
  local xwiki_enabled="$4"
  local gitlab_enabled="$5"
  local squashtm_enabled="$6"
  local standalone="$7"
  shift 7
  local -a expected=("$@")
  local out
  out="$(
    IN_XWIKI_ENABLED="${xwiki_enabled}" \
    IN_GITLAB_ENABLED="${gitlab_enabled}" \
    IN_SQUASHTM_ENABLED="${squashtm_enabled}" \
    IN_STANDALONE="${standalone}" \
    "${SCRIPT}" "${suite}" "${setup}" "preview.test"
  )"
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
  local standalone="${4:-false}"
  if IN_STANDALONE="${standalone}" "${SCRIPT}" "${suite}" "${setup}" >/dev/null 2>&1; then
    fail "${label}: expected non-zero exit"
  fi
  pass "${label} rejects invalid combo"
}

assert_output "defaults all off" "" "sso-external" "false" "false" "false" "false" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=true" \
  "skip_keycloak=false" \
  "skip_gitlab=true" \
  "skip_squashtm=true" \
  "xwiki_enabled=false" \
  "gitlab_enabled=false" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test"

assert_output "xwiki only" "" "sso-external" "true" "false" "false" "false" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=false" \
  "skip_keycloak=false" \
  "skip_gitlab=true" \
  "skip_squashtm=true" \
  "xwiki_enabled=true" \
  "gitlab_enabled=false" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test,xwiki.preview.test"

assert_output "gitlab only" "" "sso-external" "false" "true" "false" "false" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=true" \
  "skip_keycloak=false" \
  "skip_gitlab=false" \
  "skip_squashtm=true" \
  "xwiki_enabled=false" \
  "gitlab_enabled=true" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test,gitlab.preview.test"

assert_output "squashtm only" "" "sso-external" "false" "false" "true" "false" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=true" \
  "skip_keycloak=false" \
  "skip_gitlab=true" \
  "skip_squashtm=false" \
  "xwiki_enabled=false" \
  "gitlab_enabled=false" \
  "squashtm_enabled=true" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test,squashtm.preview.test"

assert_output "all optional on" "" "sso-external" "true" "true" "true" "false" \
  "stack_profile=" \
  "skip_nextcloud=false" \
  "skip_xwiki=false" \
  "skip_keycloak=false" \
  "skip_gitlab=false" \
  "skip_squashtm=false" \
  "xwiki_enabled=true" \
  "gitlab_enabled=true" \
  "squashtm_enabled=true" \
  "proxy_tls_hosts=nextcloud.preview.test,keycloak.preview.test,xwiki.preview.test,gitlab.preview.test,squashtm.preview.test"

assert_output "mcp oauth2 forces optional off" "mcp" "oauth2" "true" "true" "true" "false" \
  "stack_profile=op-only" \
  "skip_nextcloud=true" \
  "skip_xwiki=true" \
  "skip_keycloak=true" \
  "skip_gitlab=true" \
  "skip_squashtm=true" \
  "xwiki_enabled=false" \
  "gitlab_enabled=false" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts="

assert_output "mcp sso-external forces optional off" "mcp" "sso-external" "true" "true" "true" "false" \
  "stack_profile=op-keycloak" \
  "skip_nextcloud=true" \
  "skip_xwiki=true" \
  "skip_keycloak=false" \
  "skip_gitlab=true" \
  "skip_squashtm=true" \
  "xwiki_enabled=false" \
  "gitlab_enabled=false" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts=keycloak.preview.test"

assert_output "standalone oauth2" "" "oauth2" "false" "false" "false" "true" \
  "stack_profile=op-only" \
  "skip_nextcloud=true" \
  "skip_xwiki=true" \
  "skip_keycloak=true" \
  "skip_gitlab=true" \
  "skip_squashtm=true" \
  "xwiki_enabled=false" \
  "gitlab_enabled=false" \
  "squashtm_enabled=false" \
  "proxy_tls_hosts="

assert_output "standalone sso-external + xwiki + squashtm" "" "sso-external" "true" "false" "true" "true" \
  "stack_profile=op-keycloak" \
  "skip_nextcloud=true" \
  "skip_xwiki=false" \
  "skip_keycloak=false" \
  "skip_gitlab=true" \
  "skip_squashtm=false" \
  "xwiki_enabled=true" \
  "gitlab_enabled=false" \
  "squashtm_enabled=true" \
  "proxy_tls_hosts=keycloak.preview.test,xwiki.preview.test,squashtm.preview.test"

assert_fails "mcp sso-nextcloud" "mcp" "sso-nextcloud"
assert_fails "mcp unknown setup" "mcp" "bogus"
assert_fails "standalone sso-nextcloud" "" "sso-nextcloud" "true"

echo "[PASS] resolve-stack-topology"
