#!/usr/bin/env bash
# DAG helmfile deploy for PullPreview (aligned with local releases; see pullpreview/docs/README.md).
set -euo pipefail

cd /app

namespace="${PULLPREVIEW_NAMESPACE:?PULLPREVIEW_NAMESPACE is required}"
values_file="${PULLPREVIEW_VALUES_FILE:-}"

source pullpreview/collect-diagnostics.sh
source pullpreview/resolve-pullpreview-env.sh "${values_file}"

# Machine secrets stay in-cluster across redeploys; humans use GitHub secrets.
ensure_pullpreview_generated_secrets() {
  local secret_name="pullpreview-generated"
  local -a keys=(
    PULLPREVIEW_OP_DB_PASSWORD
    PULLPREVIEW_NC_DB_PASSWORD
    PULLPREVIEW_GITLAB_DB_PASSWORD
    PULLPREVIEW_GITLAB_REDIS_PASSWORD
    PULLPREVIEW_NC_OIDC_SECRET
    PULLPREVIEW_OP_NC_OIDC_SECRET
    PULLPREVIEW_OP_KC_OIDC_SECRET
    PULLPREVIEW_XWIKI_OAUTH_SECRET
    PULLPREVIEW_XWIKI_DB_PASSWORD
    PULLPREVIEW_KC_DB_PASSWORD
  )
  local key existing value args=()
  local secret_err secret_json=""
  secret_err="$(mktemp)"

  # Fail on API errors; only treat NotFound as "generate fresh keys".
  if kubectl get secret "${secret_name}" -n "${namespace}" -o json >"${secret_err}.json" 2>"${secret_err}"; then
    secret_json="$(cat "${secret_err}.json")"
  elif ! grep -qiE 'NotFound|not found' "${secret_err}"; then
    echo "::error::[pullpreview helmfile] failed to read secret ${secret_name} in ${namespace}:" >&2
    cat "${secret_err}" >&2
    rm -f "${secret_err}" "${secret_err}.json"
    exit 1
  fi
  rm -f "${secret_err}" "${secret_err}.json"

  for key in "${keys[@]}"; do
    existing=""
    if [[ -n "${secret_json}" ]]; then
      existing="$(printf '%s' "${secret_json}" | python3 -c \
        'import json,sys; print(json.load(sys.stdin).get("data",{}).get(sys.argv[1],""))' \
        "${key}")"
    fi
    if [[ -n "${existing}" ]]; then
      value="$(printf '%s' "${existing}" | base64 -d)"
    else
      value="$(openssl rand -hex 24)"
    fi
    export "${key}=${value}"
    args+=(--from-literal="${key}=${value}")
  done

  kubectl get namespace "${namespace}" >/dev/null 2>&1 || \
    kubectl create namespace "${namespace}" >/dev/null
  kubectl create secret generic "${secret_name}" -n "${namespace}" \
    "${args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "[pullpreview helmfile] Ensured ${secret_name} (${#keys[@]} keys) in ${namespace}"
}

ensure_pullpreview_generated_secrets

echo "[pullpreview helmfile] namespace=${namespace} values_file=${values_file:-<none>} public_dns=${PULLPREVIEW_PUBLIC_DNS:-<unset>}"

helmfile_path="pullpreview/helmfile.yaml.gotmpl"
helmfile_common=(helmfile -f "${helmfile_path}" -e pullpreview)
# cpx42 (8 vCPU / 16 GB RAM) handles 4 concurrent Helm releases without heavy contention.
# Lower this via PULLPREVIEW_HELMFILE_CONCURRENCY if running on a smaller instance.
helmfile_concurrency="${PULLPREVIEW_HELMFILE_CONCURRENCY:-4}"
sync_log="$(mktemp)"
trap 'rm -f "${sync_log}"' EXIT

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

buildsource_job_failed() {
  local job_failed
  job_failed="$(kubectl get job op-buildsource-job -n "${namespace}" \
    -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"
  [[ "${job_failed}" == "True" ]]
}

buildsource_job_oomkilled() {
  local reasons
  reasons="$(kubectl get pods -n "${namespace}" -l job-name=op-buildsource-job \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[*].lastState.terminated.reason}{"\n"}{.status.containerStatuses[*].state.terminated.reason}{"\n"}{end}' \
    2>/dev/null || true)"
  [[ "${reasons}" == *OOMKilled* ]]
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
      if buildsource_job_oomkilled; then
        echo "::error::[pullpreview helmfile] op-buildsource-job was OOMKilled (node memory pressure during OpenProject source build); aborting Helmfile sync."
      else
        echo "::error::[pullpreview helmfile] op-buildsource-job failed; aborting Helmfile sync."
      fi
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

# Prefer -c seeder only: --all-containers --previous fails when check-db-ready
# has no previous termination and hides the real seed exception.
dump_openproject_seeder_logs() {
  local seeder_job="${1:-}"
  local reason="${2:-seeder failure}"
  local seeder_log=""
  echo "::error::[pullpreview helmfile] ${reason}"
  if [[ -n "${seeder_job}" ]]; then
    echo "[pullpreview helmfile] ${seeder_job} describe:"
    kubectl describe job "${seeder_job}" -n "${namespace}" 2>&1 || true
    echo "[pullpreview helmfile] ${seeder_job} pods describe:"
    kubectl describe pods -n "${namespace}" -l "job-name=${seeder_job}" 2>&1 || true
  fi
  # -l defaults to --tail=10; force full logs so the seed exception is not truncated.
  echo "[pullpreview helmfile] seeder container logs:"
  seeder_log="$(kubectl logs -n "${namespace}" -l "openproject/process=seeder" \
    -c seeder --tail=-1 2>&1 || true)"
  printf '%s\n' "${seeder_log}"
  echo "[pullpreview helmfile] seeder container log error extract:"
  printf '%s\n' "${seeder_log}" \
    | grep -nE 'rake aborted|Error|Exception|Caused by|seed failed|Initializing|Executing database' \
    || true
  echo "[pullpreview helmfile] seeder container previous logs:"
  seeder_log="$(kubectl logs -n "${namespace}" -l "openproject/process=seeder" \
    -c seeder --previous --tail=-1 2>&1 || true)"
  printf '%s\n' "${seeder_log}"
  echo "[pullpreview helmfile] seeder container previous log error extract:"
  printf '%s\n' "${seeder_log}" \
    | grep -nE 'rake aborted|Error|Exception|Caused by|seed failed|Initializing|Executing database' \
    || true
}

dump_gitlab_migrations_logs() {
  local mig_job="${1:-}"
  local reason="${2:-migrations failure}"
  echo "::error::[pullpreview helmfile] ${reason}"
  if [[ -n "${mig_job}" ]]; then
    echo "[pullpreview helmfile] ${mig_job} describe:"
    kubectl describe job "${mig_job}" -n "${namespace}" 2>&1 || true
    echo "[pullpreview helmfile] ${mig_job} pods describe:"
    kubectl describe pods -n "${namespace}" -l "job-name=${mig_job}" 2>&1 || true
  fi
  echo "[pullpreview helmfile] migrations container logs:"
  kubectl logs -n "${namespace}" -l "app=migrations,release=gitlab" \
    -c migrations --tail=-1 2>&1 || true
  echo "[pullpreview helmfile] migrations container previous logs:"
  kubectl logs -n "${namespace}" -l "app=migrations,release=gitlab" \
    -c migrations --previous --tail=-1 2>&1 || true
  echo "[pullpreview helmfile] gitlab-postgresql log tail:"
  kubectl logs -n "${namespace}" gitlab-postgresql-0 -c postgresql --tail=80 2>&1 || true
  echo "[pullpreview helmfile] gitlab-redis log tail:"
  kubectl logs -n "${namespace}" gitlab-redis-0 -c redis --tail=40 2>&1 || true
}

# Migrations pods are deleted on BackoffLimitExceeded; dump logs on first failure
# and abort Helm sync so we do not burn the full 45m gitlab --wait.
watch_gitlab_migrations_job() {
  local sync_pid="$1"
  local poll_interval=15
  local dumped=0

  sleep "${poll_interval}"

  while kill -0 "${sync_pid}" 2>/dev/null; do
    local mig_job=""
    mig_job="$(kubectl get jobs -n "${namespace}" -l "app=migrations,release=gitlab" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -z "${mig_job}" ]]; then
      sleep "${poll_interval}"
      continue
    fi

    local term_reasons=""
    term_reasons="$(kubectl get pods -n "${namespace}" -l "job-name=${mig_job}" \
      -o jsonpath='{range .items[*]}{.status.containerStatuses[?(@.name=="migrations")].lastState.terminated.reason}{"\n"}{.status.containerStatuses[?(@.name=="migrations")].state.terminated.reason}{"\n"}{end}' \
      2>/dev/null || true)"
    local job_failed=""
    job_failed="$(kubectl get job "${mig_job}" -n "${namespace}" \
      -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"

    if [[ "${dumped}" -eq 0 ]]; then
      if [[ "${term_reasons}" == *Error* || "${term_reasons}" == *OOMKilled* || "${job_failed}" == "True" ]]; then
        dumped=1
        dump_gitlab_migrations_logs "${mig_job}" \
          "${mig_job} failed (${term_reasons:-BackoffLimitExceeded}); dumping logs before pods are GC'd."
        echo "::error::[pullpreview helmfile] aborting Helmfile sync after GitLab migrations failure."
        kill "${sync_pid}" 2>/dev/null || true
        return 1
      fi
    fi

    sleep "${poll_interval}"
  done

  return 0
}

# Seeder pods are deleted on BackoffLimitExceeded (restartPolicy OnFailure); dump
# logs on first container failure and again when the Job fails.
watch_openproject_seeder_job() {
  local sync_pid="$1"
  local poll_interval=15
  local dumped=0

  sleep "${poll_interval}"

  while kill -0 "${sync_pid}" 2>/dev/null; do
    local seeder_job=""
    seeder_job="$(kubectl get jobs -n "${namespace}" \
      -l app.kubernetes.io/component=seeder \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -z "${seeder_job}" ]]; then
      sleep "${poll_interval}"
      continue
    fi

    local term_reasons=""
    term_reasons="$(kubectl get pods -n "${namespace}" -l "job-name=${seeder_job}" \
      -o jsonpath='{range .items[*]}{.status.containerStatuses[?(@.name=="seeder")].lastState.terminated.reason}{"\n"}{.status.containerStatuses[?(@.name=="seeder")].state.terminated.reason}{"\n"}{end}' \
      2>/dev/null || true)"
    local job_failed=""
    job_failed="$(kubectl get job "${seeder_job}" -n "${namespace}" \
      -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"

    if [[ "${dumped}" -eq 0 ]]; then
      if [[ "${term_reasons}" == *Error* || "${term_reasons}" == *OOMKilled* || "${job_failed}" == "True" ]]; then
        dumped=1
        dump_openproject_seeder_logs "${seeder_job}" \
          "${seeder_job} failed (${term_reasons:-BackoffLimitExceeded}); dumping logs before pods are GC'd."
      fi
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
  "${helmfile_common[@]}" "${sync_args[@]}" > >(tee "${sync_log}") 2>&1 &
  local sync_pid=$!
  watch_buildsource_job "${sync_pid}" &
  local watcher_pid=$!
  watch_openproject_seeder_job "${sync_pid}" &
  local seeder_watcher_pid=$!
  watch_gitlab_migrations_job "${sync_pid}" &
  local gitlab_mig_watcher_pid=$!

  wait "${sync_pid}"
  local sync_status=$?

  if kill -0 "${watcher_pid}" 2>/dev/null; then
    kill "${watcher_pid}" 2>/dev/null || true
  fi
  wait "${watcher_pid}"
  local watcher_status=$?
  if kill -0 "${seeder_watcher_pid}" 2>/dev/null; then
    kill "${seeder_watcher_pid}" 2>/dev/null || true
  fi
  wait "${seeder_watcher_pid}" 2>/dev/null || true
  if kill -0 "${gitlab_mig_watcher_pid}" 2>/dev/null; then
    kill "${gitlab_mig_watcher_pid}" 2>/dev/null || true
  fi
  wait "${gitlab_mig_watcher_pid}" 2>/dev/null
  local gitlab_mig_watcher_status=$?
  set -e

  if [[ "${watcher_status}" -eq 143 || "${watcher_status}" -eq 137 ]]; then
    watcher_status=0
  fi
  if [[ "${gitlab_mig_watcher_status}" -eq 143 || "${gitlab_mig_watcher_status}" -eq 137 ]]; then
    gitlab_mig_watcher_status=0
  fi

  if [[ "${watcher_status}" -ne 0 && "${sync_status}" -eq 0 ]]; then
    sync_status="${watcher_status}"
  fi
  # Watcher returns 1 after dumping migrate logs and killing helmfile; keep that failure.
  if [[ "${gitlab_mig_watcher_status}" -ne 0 ]]; then
    sync_status="${gitlab_mig_watcher_status}"
  fi
  if [[ "${sync_status}" -eq 0 ]] && kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1 && buildsource_job_failed; then
    if buildsource_job_oomkilled; then
      echo "::error::[pullpreview helmfile] op-buildsource-job was OOMKilled after Helmfile sync completed (node memory pressure during OpenProject source build)."
    else
      echo "::error::[pullpreview helmfile] op-buildsource-job failed after Helmfile sync completed."
    fi
    sync_status=1
  fi

  record_pp_timing "helmfile-sync" "${sync_started_at}"
  echo "::endgroup::"
  return "${sync_status}"
}

echo "[pullpreview helmfile] DAG deploy starting (namespace=${namespace}, host=${PULLPREVIEW_PUBLIC_DNS}, concurrency=${helmfile_concurrency})"

# PullPreview reuses k3s nodes. A prior Traefik/Gateway install can leave
# ValidatingAdmissionPolicy safe-upgrades.gateway.networking.k8s.io, which
# rejects Traefik ~39's bundled Gateway CRDs (< v1.5.0). We only use Ingress.
if kubectl get validatingadmissionpolicy safe-upgrades.gateway.networking.k8s.io >/dev/null 2>&1; then
  echo "[pullpreview helmfile] Removing leftover Gateway API safe-upgrades ValidatingAdmissionPolicy (blocks Traefik CRD install)."
  kubectl delete validatingadmissionpolicybinding safe-upgrades.gateway.networking.k8s.io --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete validatingadmissionpolicy safe-upgrades.gateway.networking.k8s.io --ignore-not-found >/dev/null 2>&1 || true
fi

set +e
run_helmfile_dag_sync
sync_rc=$?
if [[ "${sync_rc}" -ne 0 ]] && is_transient_network_failure "${sync_log}"; then
  echo "::warning::[pullpreview helmfile] Helmfile sync hit a transient network/DNS error; retrying once in 30s."
  sleep 30
  run_helmfile_dag_sync
  sync_rc=$?
fi
set -e
if [[ "${sync_rc}" -ne 0 ]]; then
  echo "::error::Helmfile DAG sync failed"
  collect_diagnostics "helmfile-sync failure" "${namespace}"
  destroy_partial_deploy
  print_pp_timing
  exit "${sync_rc}"
fi

# Warm public TLS endpoints in background so Caddy begins on-demand ACME negotiation
if [[ -n "${PULLPREVIEW_PUBLIC_DNS:-}" ]]; then
  for host in "${PULLPREVIEW_PUBLIC_DNS}" "nextcloud.${PULLPREVIEW_PUBLIC_DNS}" "keycloak.${PULLPREVIEW_PUBLIC_DNS}"; do
    curl -sk --connect-timeout 5 --max-time 15 "https://${host}" >/dev/null 2>&1 &
  done
fi

setup_started_at="$(date +%s)"
set +e
pullpreview/wait-setup-job.sh "${namespace}" "${PULLPREVIEW_SETUP_JOB_TIMEOUT:-15m}"
setup_rc=$?
set -e
record_pp_timing "wait-setup-job" "${setup_started_at}"

if [[ "${setup_rc}" -ne 0 ]]; then
  collect_diagnostics "setup-job failure" "${namespace}"
  destroy_partial_deploy
  print_pp_timing
  exit "${setup_rc}"
fi

if [[ "${PULLPREVIEW_VERIFY_XWIKI_FROM_OP_POD:-true}" == "true" && "${XWIKI_ENABLED:-true}" == "true" && -n "${PULLPREVIEW_PUBLIC_DNS:-}" ]]; then
  verify_started_at="$(date +%s)"
  set +e
  pullpreview/verify-xwiki-from-op-pod.sh "${namespace}" "${PULLPREVIEW_PUBLIC_DNS}"
  verify_rc=$?
  set -e
  record_pp_timing "verify-xwiki-from-op" "${verify_started_at}"

  if [[ "${verify_rc}" -ne 0 ]]; then
    collect_diagnostics "xwiki metadata unreachable from OpenProject pod" "${namespace}"
    destroy_partial_deploy
    print_pp_timing
    exit "${verify_rc}"
  fi
fi

if [[ "${PULLPREVIEW_SUCCESS_DIAGNOSTICS:-false}" == "true" ]]; then
  collect_diagnostics "successful deploy" "${namespace}"
fi

if kubectl get deployment pullpreview-caddy -n "${namespace}" >/dev/null 2>&1; then
  echo "::group::PullPreview Caddy status"
  kubectl logs -n "${namespace}" deploy/pullpreview-caddy --tail=100 2>&1 | redact_stream || true
  echo "::endgroup::"
fi

print_pp_timing

echo "[pullpreview helmfile] DAG deploy finished successfully."
