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

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT
echo 'Error: Get "https://github.com/nextcloud/helm/releases/download/nextcloud-9.2.7/nextcloud-9.2.7.tgz": dial tcp: lookup github.com on 127.0.0.53:53: read udp 127.0.0.1:39452->127.0.0.53:53: i/o timeout' >"${log}"
is_transient_network_failure "${log}"
echo 'executing "stringTemplate" at <.Values.mcp>: map has no entry for key "mcp"' >"${log}"
! is_transient_network_failure "${log}"

echo "[PASS] Transient network failures are detected for Helmfile retry"
