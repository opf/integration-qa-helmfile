#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/collect-diagnostics.sh"

input='{"nextcloud_client_secret":"client-secret-value","openproject_user_app_password":"pa\\\"ss,<>!","nextcloud_client_id":"public-id"}'
output="$(printf '%s\n' "${input}" | redact_stream)"

[[ "${output}" == *'"nextcloud_client_secret":"[REDACTED]"'* ]]
[[ "${output}" == *'"openproject_user_app_password":"[REDACTED]"'* ]]
[[ "${output}" == *'"nextcloud_client_id":"public-id"'* ]]
[[ "${output}" != *'client-secret-value'* ]]
[[ "${output}" != *'pa\\\"ss,<>!'* ]]

echo "[PASS] PullPreview diagnostics redact generated Nextcloud credentials"
