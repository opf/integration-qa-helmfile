#!/usr/bin/env bash
# Resolve PullPreview stack topology from suite + setupMethod.
#
# oauth2 -> op-only is correct for suite=mcp: MCP auth uses a Doorkeeper OAuth
# token (setup-mcp.rb), not Keycloak SSO.
#
# Usage: resolve-stack-topology.sh <suite> <setupMethod> [dns_placeholder]
#   suite           e.g. mcp, smoke, all (empty string for non-mcp defaults)
#   setupMethod     oauth2 | sso-external | sso-nextcloud
#   dns_placeholder default: {{ pullpreview_public_dns }}
#
# Output (stdout, key=value lines for GITHUB_OUTPUT):
#   stack_profile, skip_nextcloud, skip_xwiki, skip_keycloak,
#   xwiki_enabled, proxy_tls_hosts
set -euo pipefail

suite="${1:-}"
setup_method="${2:?setupMethod required}"
_default_dns='{{ pullpreview_public_dns }}'
dns_placeholder="${3:-${_default_dns}}"

stack_profile=""
skip_nextcloud="false"
skip_xwiki="false"
skip_keycloak="false"
proxy_tls_hosts="nextcloud.${dns_placeholder},keycloak.${dns_placeholder},xwiki.${dns_placeholder}"
xwiki_enabled="true"

if [[ "${suite}" == "mcp" ]]; then
  skip_nextcloud="true"
  skip_xwiki="true"
  xwiki_enabled="false"
  case "${setup_method}" in
    oauth2)
      stack_profile="op-only"
      skip_keycloak="true"
      proxy_tls_hosts=""
      ;;
    sso-external)
      stack_profile="op-keycloak"
      skip_keycloak="false"
      proxy_tls_hosts="keycloak.${dns_placeholder}"
      ;;
    sso-nextcloud)
      echo "::error::suite=mcp requires oauth2 or sso-external setupMethod (not sso-nextcloud)."
      exit 1
      ;;
    *)
      echo "::error::Unknown setupMethod for suite=mcp: ${setup_method}"
      exit 1
      ;;
  esac
fi

echo "stack_profile=${stack_profile}"
echo "skip_nextcloud=${skip_nextcloud}"
echo "skip_xwiki=${skip_xwiki}"
echo "skip_keycloak=${skip_keycloak}"
echo "xwiki_enabled=${xwiki_enabled}"
echo "proxy_tls_hosts=${proxy_tls_hosts}"
