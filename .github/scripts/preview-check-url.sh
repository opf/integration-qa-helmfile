#!/usr/bin/env bash
# Check a preview HTTPS endpoint and append results to GITHUB_STEP_SUMMARY.
# Usage: preview-check-url.sh <service_name> <url> <expected_status> [attempts] [sleep_seconds] [follow_redirects]
set -euo pipefail

name="${1:?service name required}"
url="${2:?url required}"
expected_status="${3:?expected HTTP status required}"
attempts="${4:-12}"
sleep_seconds="${5:-10}"
follow_redirects="${6:-false}"

status=""
curl_exit=0
ok=false

for attempt in $(seq 1 "${attempts}"); do
  set +e
  status="$(
    /usr/bin/curl -skS -o /dev/null \
      --connect-timeout 10 \
      --write-out '%{http_code}' \
      $([[ "${follow_redirects}" == "true" ]] && echo -n "-L") \
      "${url}" 2>/dev/null
  )"
  curl_exit=$?
  set -e

  if [[ "${curl_exit}" -eq 0 ]]; then
    if [[ "${attempt}" -eq 1 ]]; then
      echo "${name}: ${url} -> ${status} (attempt ${attempt}/${attempts})"
    else
      echo "${name}: ${status} (attempt ${attempt}/${attempts})"
    fi
    if [[ "${status}" == "${expected_status}" ]]; then
      ok=true
      break
    fi
  else
    status="curl-exit-${curl_exit}"
    if [[ "${attempt}" -eq 1 ]]; then
      echo "${name}: ${url} -> ${status} (attempt ${attempt}/${attempts})"
    else
      echo "${name}: ${status} (attempt ${attempt}/${attempts})"
    fi
  fi

  if [[ "${attempt}" -lt "${attempts}" ]]; then
    sleep "${sleep_seconds}"
  fi
done

summary_file="${GITHUB_STEP_SUMMARY:-}"
if [[ -n "${summary_file}" ]]; then
  if [[ "${ok}" == "true" ]]; then
    echo "- **${name}:** ${url} — HTTP ${status}" >> "${summary_file}"
  else
    echo "- **${name}:** ${url} — failed (expected HTTP ${expected_status}, last: ${status})" >> "${summary_file}"
  fi
fi

if [[ "${ok}" != "true" ]]; then
  echo "::group::Debug: status check for ${name}"
  set +e
  status="$(
    /usr/bin/curl -skS -o /dev/null \
      --connect-timeout 10 \
      --write-out '%{http_code}' \
      "${url}" 2>/dev/null
  )"
  curl_exit=$?
  set -e
  if [[ "${curl_exit}" -eq 0 ]]; then
    echo "${name}: ${status}"
  else
    echo "${name}: curl-exit-${curl_exit}"
  fi
  echo "::endgroup::"
  echo "::error::${name} endpoint was not ready: ${url} expected HTTP ${expected_status}, last result ${status}"
  exit 1
fi
