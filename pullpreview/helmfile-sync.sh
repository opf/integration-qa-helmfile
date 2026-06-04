#!/usr/bin/env bash
# Phased helmfile deploy for PullPreview (aligned with local releases; see pullpreview/docs/README.md).
set -euo pipefail

cd /app

namespace="${PULLPREVIEW_NAMESPACE:?PULLPREVIEW_NAMESPACE is required}"
values_file="${PULLPREVIEW_VALUES_FILE:-}"

source pullpreview/resolve-pullpreview-env.sh "${values_file}"

echo "[pullpreview helmfile] namespace=${namespace} values_file=${values_file:-<none>} public_dns=${PULLPREVIEW_PUBLIC_DNS:-<unset>}"

helmfile_path="pullpreview/helmfile.yaml.gotmpl"
helmfile_common=(helmfile -f "${helmfile_path}" -e pullpreview)

collect_phase_diagnostics() {
  local phase="$1"
  echo "::group::Diagnostics after ${phase}"
  if command -v kubectl >/dev/null 2>&1; then
    kubectl get pods,jobs,deployments,statefulsets,pvc -n "${namespace}" 2>&1 || true
    kubectl get events -n "${namespace}" --sort-by=.lastTimestamp 2>&1 | tail -n 80 || true
  fi
  echo "::endgroup::"
}

sync_release() {
  local release="$1"
  echo "::group::Helmfile release: ${release}"
  echo "[pullpreview helmfile] Syncing release ${release} in namespace ${namespace}"
  set +e
  "${helmfile_common[@]}" -l "name=${release}" sync
  local status=$?
  set -e
  if [[ "${status}" -ne 0 ]]; then
    echo "::error::Helmfile release ${release} failed"
    collect_phase_diagnostics "${release}"
    echo "[pullpreview helmfile] Destroying partial deploy after failure."
    "${helmfile_common[@]}" destroy --skip-deps || true
    echo "::endgroup::"
    return "${status}"
  fi
  collect_phase_diagnostics "${release}"
  echo "::endgroup::"
  return 0
}

echo "[pullpreview helmfile] Phased deploy starting (namespace=${namespace}, host=${PULLPREVIEW_PUBLIC_DNS})"

releases=(traefik opnc-integration openproject keycloak nextcloud opnc-setup-job xwiki)
for release in "${releases[@]}"; do
  sync_release "${release}" || exit 1
done

pullpreview/wait-setup-job.sh "${namespace}" "${PULLPREVIEW_SETUP_JOB_TIMEOUT:-30m}"

echo "[pullpreview helmfile] Phased deploy finished successfully."
