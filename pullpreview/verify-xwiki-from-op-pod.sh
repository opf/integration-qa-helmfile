#!/usr/bin/env bash
# Verify OpenProject can reach XWiki metadata from inside the web pod (server-side check).
set -euo pipefail

namespace="${1:?namespace required}"
public_dns="${2:?public DNS host required}"
xwiki_host="xwiki.${public_dns}"
metadata_url="https://${xwiki_host}/rest/openproject/metadata"
attempts="${3:-12}"
sleep_seconds="${4:-10}"

op_pod=""
for _ in $(seq 1 "${attempts}"); do
  op_pod="$(
    kubectl get pods -n "${namespace}" -l "openproject/process=web" \
      -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' 2>/dev/null \
      | awk '{print $1}'
  )"
  [[ -n "${op_pod}" ]] && break
  sleep "${sleep_seconds}"
done

if [[ -z "${op_pod}" ]]; then
  echo "::error::OpenProject web pod not found in namespace ${namespace}"
  exit 1
fi

echo "[pullpreview] Verifying XWiki metadata from OpenProject pod ${op_pod}: ${metadata_url}"

status=""
body=""
for attempt in $(seq 1 "${attempts}"); do
  set +e
  response="$(
    kubectl exec -n "${namespace}" "${op_pod}" -c openproject -- \
      curl -skS --connect-timeout 10 --max-time 20 \
      "${metadata_url}" -w $'\nHTTP_CODE:%{http_code}' 2>/dev/null
  )"
  exec_rc=$?
  set -e

  if [[ "${exec_rc}" -eq 0 ]]; then
    status="${response##*HTTP_CODE:}"
    body="${response%HTTP_CODE:*}"
  else
    status="curl-failed"
    body=""
  fi

  if [[ "${status}" == "200" && "${body}" == *instanceId* ]]; then
    echo "[pullpreview] OpenProject pod reached XWiki metadata successfully."
    exit 0
  fi

  echo "[pullpreview] Attempt ${attempt}/${attempts}: status=${status} body=${body:0:120}"
  if [[ "${attempt}" -lt "${attempts}" ]]; then
    sleep "${sleep_seconds}"
  fi
done

echo "::error::OpenProject pod could not reach ${metadata_url} (last status: ${status})"
echo "[pullpreview] hostAliases on ${op_pod}:"
kubectl get pod "${op_pod}" -n "${namespace}" -o jsonpath='{.spec.hostAliases}' 2>&1 || true
echo
echo "[pullpreview] /etc/hosts inside pod:"
kubectl exec -n "${namespace}" "${op_pod}" -c openproject -- cat /etc/hosts 2>&1 || true
exit 1
