#!/usr/bin/env bash
# Wait until the integration setup-job completes (same gate as local README).
# Exits early when the job reaches the Failed condition (backoffLimit exhausted
# or podFailurePolicy FailJob on a deterministic error) instead of waiting out
# the full timeout. Individual failed pods do not set the Failed condition, so
# transient retries keep waiting as before.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/collect-diagnostics.sh"

namespace="${1:?namespace required}"
timeout="${2:-10m}"

if [[ ! "${timeout}" =~ ^[0-9]+[smh]?$ ]]; then
  echo "::error::wait-setup-job: timeout must be a single-unit duration such as 10m, 600s, or 1h (got: ${timeout})"
  exit 1
fi

case "${timeout}" in
  *h) timeout_secs=$(( ${timeout%h} * 3600 )) ;;
  *m) timeout_secs=$(( ${timeout%m} * 60 )) ;;
  *s) timeout_secs=${timeout%s} ;;
  *)  timeout_secs=${timeout} ;;
esac

# Minimal targeted dump: only setup-job logs so helmfile-sync.sh's subsequent
# full collect_diagnostics call does not double-print the same data.
dump_diagnostics() {
  echo "[pullpreview] setup-job pod logs:"
  kubectl logs -n "${namespace}" -l job-name=setup-job \
    --all-containers=true --tail=200 2>&1 | redact_stream || true
}

job_condition() {
  local condition_type="$1"
  kubectl get job setup-job -n "${namespace}" \
    -o jsonpath="{.status.conditions[?(@.type==\"${condition_type}\")].status}" 2>/dev/null || true
}

echo "[pullpreview] Waiting for setup-job in namespace ${namespace} (timeout ${timeout})..."

if ! kubectl get job setup-job -n "${namespace}" >/dev/null 2>&1; then
  echo "::error::setup-job was not found in namespace ${namespace}"
  kubectl get jobs -n "${namespace}" 2>&1 || true
  exit 1
fi

deadline=$(( $(date +%s) + timeout_secs ))
while true; do
  if [[ "$(job_condition Complete)" == "True" ]]; then
    echo "[pullpreview] setup-job completed successfully."
    exit 0
  fi

  if [[ "$(job_condition Failed)" == "True" ]]; then
    echo "::error::setup-job failed (job reached the Failed condition)"
    dump_diagnostics
    exit 1
  fi

  if (( $(date +%s) >= deadline )); then
    echo "::error::setup-job did not complete within ${timeout}"
    dump_diagnostics
    exit 1
  fi

  sleep 10
done
