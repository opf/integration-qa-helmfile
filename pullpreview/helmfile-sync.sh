#!/usr/bin/env bash
# DAG helmfile deploy for PullPreview (aligned with local releases; see pullpreview/docs/README.md).
set -euo pipefail

cd /app

namespace="${PULLPREVIEW_NAMESPACE:?PULLPREVIEW_NAMESPACE is required}"
values_file="${PULLPREVIEW_VALUES_FILE:-}"

source pullpreview/resolve-pullpreview-env.sh "${values_file}"

echo "[pullpreview helmfile] namespace=${namespace} values_file=${values_file:-<none>} public_dns=${PULLPREVIEW_PUBLIC_DNS:-<unset>}"

helmfile_path="pullpreview/helmfile.yaml.gotmpl"
helmfile_common=(helmfile -f "${helmfile_path}" -e pullpreview)
# cpx42 (16 vCPU / 64 GB RAM) handles 4 concurrent Helm releases without contention.
# Lower this via PULLPREVIEW_HELMFILE_CONCURRENCY if running on a smaller instance.
helmfile_concurrency="${PULLPREVIEW_HELMFILE_CONCURRENCY:-4}"

declare -a PP_TIMING_ROWS=()
pp_deploy_start=$(date +%s)

record_pp_timing() {
  local phase="$1"
  local started_at="$2"
  PP_TIMING_ROWS+=("${phase} $(( $(date +%s) - started_at ))")
}

print_pp_timing() {
  echo "::group::PullPreview timings (seconds)"
  printf '%-20s %8s\n' "PHASE" "SECONDS"
  local row
  for row in "${PP_TIMING_ROWS[@]}"; do
    printf '%-20s %8s\n' "${row% *}" "${row##* }"
  done
  printf '%-20s %8s\n' "TOTAL" "$(( $(date +%s) - pp_deploy_start ))"
  echo "::endgroup::"
}

collect_deploy_diagnostics() {
  local context="$1"

  echo "::group::Diagnostics: ${context}"
  if command -v kubectl >/dev/null 2>&1; then
    kubectl get pods,jobs,deployments,statefulsets,pvc -n "${namespace}" 2>&1 || true
    kubectl get events -n "${namespace}" --sort-by=.lastTimestamp 2>&1 | tail -n 100 || true

    if kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1; then
      echo "[pullpreview helmfile] op-buildsource-job log tail:"
      kubectl logs -n "${namespace}" -l job-name=op-buildsource-job \
        --all-containers=true --tail=160 2>&1 || true
    fi

    if kubectl get job setup-job -n "${namespace}" >/dev/null 2>&1; then
      echo "[pullpreview helmfile] setup-job log tail:"
      kubectl logs -n "${namespace}" -l job-name=setup-job \
        --all-containers=true --tail=200 2>&1 || true
      kubectl describe job setup-job -n "${namespace}" 2>&1 || true
    fi

    local nc_pod=""
    nc_pod="$(kubectl get pods -n "${namespace}" -l "app.kubernetes.io/name=nextcloud" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "${nc_pod}" ]]; then
      echo "[pullpreview helmfile] Nextcloud pod log tail (${nc_pod}):"
      kubectl logs "${nc_pod}" -n "${namespace}" -c nextcloud --tail=160 2>&1 || true
      kubectl logs "${nc_pod}" -n "${namespace}" -c presetup --tail=120 2>&1 || true
    fi

    local xwiki_pod=""
    xwiki_pod="$(kubectl get pods -n "${namespace}" -l "app.kubernetes.io/name=xwiki" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "${xwiki_pod}" ]]; then
      echo "[pullpreview helmfile] XWiki pod log tail (${xwiki_pod}):"
      kubectl logs "${xwiki_pod}" -n "${namespace}" -c xwiki --tail=200 2>&1 || true
      echo "[pullpreview helmfile] XWiki pod previous log tail (${xwiki_pod}):"
      kubectl logs "${xwiki_pod}" -n "${namespace}" -c xwiki --previous --tail=200 2>&1 || true
    fi
  fi
  echo "::endgroup::"
}

buildsource_job_failed() {
  local job_failed
  job_failed="$(kubectl get job op-buildsource-job -n "${namespace}" \
    -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"
  [[ "${job_failed}" == "True" ]]
}

watch_buildsource_job() {
  local sync_pid="$1"
  local poll_interval=15

  sleep "${poll_interval}"

  while kill -0 "${sync_pid}" 2>/dev/null; do
    if ! kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1; then
      sleep "${poll_interval}"
      continue
    fi

    if buildsource_job_failed; then
      echo "::error::[pullpreview helmfile] op-buildsource-job failed; aborting Helmfile sync."
      echo "[pullpreview helmfile] op-buildsource-job log tail:"
      kubectl logs -n "${namespace}" -l job-name=op-buildsource-job \
        --all-containers=true --tail=120 2>&1 || true
      kill "${sync_pid}" 2>/dev/null || true
      return 1
    fi

    local job_complete
    job_complete="$(kubectl get job op-buildsource-job -n "${namespace}" \
      -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || true)"
    if [[ "${job_complete}" == "True" ]]; then
      return 0
    fi

    sleep "${poll_interval}"
  done

  return 0
}

destroy_partial_deploy() {
  echo "[pullpreview helmfile] Destroying partial deploy after failure."
  "${helmfile_common[@]}" destroy --skip-deps || true
}

helmfile_sync_supports_flag() {
  local flag="$1"
  local help_output
  help_output="$("${helmfile_common[@]}" sync --help 2>/dev/null || true)"
  [[ "${help_output}" == *"${flag}"* ]]
}

run_helmfile_dag_sync() {
  local sync_started_at
  sync_started_at="$(date +%s)"
  local sync_args=(sync --concurrency "${helmfile_concurrency}")

  if helmfile_sync_supports_flag "--enforce-needs-are-installed"; then
    sync_args+=(--enforce-needs-are-installed)
  else
    echo "[pullpreview helmfile] Installed Helmfile does not support --enforce-needs-are-installed; full-state sync still applies the needs DAG."
  fi

  echo "::group::Helmfile DAG sync"
  echo "[pullpreview helmfile] Running Helmfile DAG sync in namespace ${namespace} (concurrency=${helmfile_concurrency})."

  set +e
  "${helmfile_common[@]}" "${sync_args[@]}" &
  local sync_pid=$!
  watch_buildsource_job "${sync_pid}" &
  local watcher_pid=$!

  wait "${sync_pid}"
  local sync_status=$?

  if kill -0 "${watcher_pid}" 2>/dev/null; then
    kill "${watcher_pid}" 2>/dev/null || true
  fi
  wait "${watcher_pid}"
  local watcher_status=$?
  set -e

  if [[ "${watcher_status}" -eq 143 || "${watcher_status}" -eq 137 ]]; then
    watcher_status=0
  fi

  if [[ "${watcher_status}" -ne 0 && "${sync_status}" -eq 0 ]]; then
    sync_status="${watcher_status}"
  fi

  if [[ "${sync_status}" -eq 0 ]] && kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1 && buildsource_job_failed; then
    echo "::error::[pullpreview helmfile] op-buildsource-job failed after Helmfile sync completed."
    sync_status=1
  fi

  record_pp_timing "helmfile-sync" "${sync_started_at}"
  echo "::endgroup::"
  return "${sync_status}"
}

echo "[pullpreview helmfile] DAG deploy starting (namespace=${namespace}, host=${PULLPREVIEW_PUBLIC_DNS}, concurrency=${helmfile_concurrency})"

set +e
run_helmfile_dag_sync
sync_rc=$?
set -e
if [[ "${sync_rc}" -ne 0 ]]; then
  echo "::error::Helmfile DAG sync failed"
  collect_deploy_diagnostics "helmfile-sync failure"
  destroy_partial_deploy
  print_pp_timing
  exit "${sync_rc}"
fi

setup_started_at="$(date +%s)"
set +e
pullpreview/wait-setup-job.sh "${namespace}" "${PULLPREVIEW_SETUP_JOB_TIMEOUT:-10m}"
setup_rc=$?
set -e
record_pp_timing "wait-setup-job" "${setup_started_at}"

if [[ "${setup_rc}" -ne 0 ]]; then
  collect_deploy_diagnostics "setup-job failure"
  destroy_partial_deploy
  print_pp_timing
  exit "${setup_rc}"
fi

if [[ "${PULLPREVIEW_VERIFY_XWIKI_FROM_OP_POD:-true}" == "true" && -n "${PULLPREVIEW_PUBLIC_DNS:-}" ]]; then
  verify_started_at="$(date +%s)"
  set +e
  pullpreview/verify-xwiki-from-op-pod.sh "${namespace}" "${PULLPREVIEW_PUBLIC_DNS}"
  verify_rc=$?
  set -e
  record_pp_timing "verify-xwiki-from-op" "${verify_started_at}"

  if [[ "${verify_rc}" -ne 0 ]]; then
    collect_deploy_diagnostics "xwiki metadata unreachable from OpenProject pod"
    destroy_partial_deploy
    print_pp_timing
    exit "${verify_rc}"
  fi
fi

if [[ "${PULLPREVIEW_SUCCESS_DIAGNOSTICS:-false}" == "true" ]]; then
  collect_deploy_diagnostics "successful deploy"
fi

print_pp_timing

echo "[pullpreview helmfile] DAG deploy finished successfully."
