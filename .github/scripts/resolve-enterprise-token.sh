#!/usr/bin/env bash
# Resolve the OpenProject enterprise token for the corporate tier.
#
# Inputs (env vars):
#   ENTERPRISE_TOKEN_TIER  — must be "corporate"
#   TOKEN_CORPORATE        — secret OPENPROJECT_ENTERPRISE_TOKEN
#
# Output:
#   GITHUB_OUTPUT: token=<value>   (auto-masked when sourced from secrets)
set -euo pipefail

tier="${ENTERPRISE_TOKEN_TIER:-corporate}"

if [[ "${tier}" != "corporate" ]]; then
  echo "::error::Enterprise token tier must be 'corporate' (got: '${tier}'). Integration stack deploys require the Corporate plan."
  exit 1
fi

token="${TOKEN_CORPORATE:-}"
if [[ -z "${token}" ]]; then
  echo "::error::Enterprise token for tier 'corporate' is empty. Set the GitHub secret OPENPROJECT_ENTERPRISE_TOKEN."
  exit 1
fi

echo "::notice::Resolved enterprise token tier: corporate"

delim="EOF_$(openssl rand -hex 8)"
printf 'token<<%s\n%s\n%s\n' "${delim}" "${token}" "${delim}" >> "${GITHUB_OUTPUT}"
