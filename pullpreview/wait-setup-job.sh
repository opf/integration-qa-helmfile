#!/usr/bin/env bash
# Wait until the integration setup-job completes (same gate as local README).
set -euo pipefail

namespace="${1:?namespace required}"
timeout="${2:-10m}"

echo "[pullpreview] Waiting for setup-job in namespace ${namespace} (timeout ${timeout})..."

if ! kubectl get job setup-job -n "${namespace}" >/dev/null 2>&1; then
  echo "::error::setup-job was not found in namespace ${namespace}"
  kubectl get jobs -n "${namespace}" 2>&1 || true
  exit 1
fi

if ! kubectl wait --for=condition=complete "job/setup-job" -n "${namespace}" --timeout="${timeout}"; then
  echo "::error::setup-job did not complete within ${timeout}"
  echo "[pullpreview] setup-job pod logs:"
  kubectl logs -n "${namespace}" -l job-name=setup-job --all-containers=true --tail=200 2>&1 || true
  kubectl describe job setup-job -n "${namespace}" 2>&1 || true
  exit 1
fi

echo "[pullpreview] setup-job completed successfully."
