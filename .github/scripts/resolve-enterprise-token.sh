#!/usr/bin/env bash
# Resolve the OpenProject enterprise token for the chosen tier.
#
# Inputs (env vars):
#   ENTERPRISE_TOKEN_TIER  — one of: basic, professional, premium, corporate, legacy
#   TOKEN_BASIC            — secret OPENPROJECT_TOKEN_BASIC
#   TOKEN_PROFESSIONAL     — secret OPENPROJECT_TOKEN_PROFESSIONAL
#   TOKEN_PREMIUM          — secret OPENPROJECT_TOKEN_PREMIUM
#   TOKEN_CORPORATE        — secret OPENPROJECT_TOKEN_CORPORATE
#   TOKEN_LEGACY           — secret OPENPROJECT_ENTERPRISE_TOKEN
#
# Output:
#   GITHUB_OUTPUT: token=<value>   (masked via ::add-mask::)
set -euo pipefail

tier="${ENTERPRISE_TOKEN_TIER:-}"

case "${tier}" in
  basic)        token="${TOKEN_BASIC:-}";        secret_name="OPENPROJECT_TOKEN_BASIC" ;;
  professional) token="${TOKEN_PROFESSIONAL:-}"; secret_name="OPENPROJECT_TOKEN_PROFESSIONAL" ;;
  premium)      token="${TOKEN_PREMIUM:-}";      secret_name="OPENPROJECT_TOKEN_PREMIUM" ;;
  corporate)    token="${TOKEN_CORPORATE:-}";    secret_name="OPENPROJECT_TOKEN_CORPORATE" ;;
  legacy)       token="${TOKEN_LEGACY:-}";       secret_name="OPENPROJECT_ENTERPRISE_TOKEN" ;;
  *)
    echo "::error::Unknown enterprise_token_tier value: '${tier}'. Must be one of: basic, professional, premium, corporate, legacy."
    exit 1
    ;;
esac

if [[ -z "${token}" ]]; then
  echo "::error::Enterprise token for tier '${tier}' is empty. Set the GitHub secret ${secret_name}."
  exit 1
fi

echo "::add-mask::${token}"
echo "::notice::Resolved enterprise token tier: ${tier}"

delim="EOF_$(openssl rand -hex 8)"
printf 'token<<%s\n%s\n%s\n' "${delim}" "${token}" "${delim}" >> "${GITHUB_OUTPUT}"
