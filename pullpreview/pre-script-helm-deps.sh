#!/usr/bin/env bash
set -euo pipefail

echo "[pullpreview pre_script] Building Helm dependencies on the instance..."
cd /app
echo "[pullpreview pre_script] Ensuring Helm repos are configured..."

helm repo add --force-update nextcloud https://nextcloud.github.io/helm
helm repo add --force-update bitnami https://charts.bitnami.com/bitnami
helm repo add --force-update traefik https://traefik.github.io/charts

helm repo update

helm dependency build charts/pullpreview-stack

# Upstream pullpreview/action currently hardcodes Helm --timeout 15m.
# Keep this local to the preview instance until the org-owned fork is available.
helm_timeout="${PULLPREVIEW_HELM_TIMEOUT:-30m}"
if [[ ! "${helm_timeout}" =~ ^([0-9]+(ns|us|ms|s|m|h))+$ ]]; then
  echo "::error::PULLPREVIEW_HELM_TIMEOUT must be a Go duration such as 30m."
  exit 1
fi
helm_path="$(command -v helm)"
real_helm_path="${helm_path}.pullpreview-real"
printf '%s\n' "${helm_timeout}" > "${helm_path}.pullpreview-timeout"
if [[ ! -e "${real_helm_path}" ]]; then
  mv "${helm_path}" "${real_helm_path}"
  cat > "${helm_path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

real_helm="${BASH_SOURCE[0]}.pullpreview-real"
helm_timeout="$(cat "${BASH_SOURCE[0]}.pullpreview-timeout")"
args=()
replace_next_timeout=false
had_atomic=false
has_wait=false

redact_stream() {
  sed -E \
    -e 's#postgres(ql)?://[^[:space:]"'\''<>]+#postgresql://[REDACTED]#g' \
    -e 's#(Authorization: Bearer )[A-Za-z0-9._~+/-]+#\1[REDACTED]#Ig' \
    -e 's#((password|token|secret|cookie)[A-Za-z0-9_ -]*(=|:))[[:space:]]*[^[:space:]"'\''<>]+#\1 [REDACTED]#Ig'
}

flag_value() {
  local flag="$1"
  local next=false

  shift
  for arg in "$@"; do
    if [[ "${next}" == "true" ]]; then
      printf '%s\n' "${arg}"
      return 0
    fi

    if [[ "${arg}" == "${flag}" ]]; then
      next=true
      continue
    fi

    if [[ "${arg}" == "${flag}="* ]]; then
      printf '%s\n' "${arg#*=}"
      return 0
    fi
  done
}

release_name() {
  local skip_next=false

  shift
  for arg in "$@"; do
    if [[ "${skip_next}" == "true" ]]; then
      skip_next=false
      continue
    fi

    case "${arg}" in
      --namespace|--timeout|-n|-f|--values|--set|--set-string|--set-json|--kubeconfig)
        skip_next=true
        continue
        ;;
      --namespace=*|--timeout=*|-f=*|--values=*|--set=*|--set-string=*|--set-json=*|--kubeconfig=*)
        continue
        ;;
      --*)
        continue
        ;;
      *)
        printf '%s\n' "${arg}"
        return 0
        ;;
    esac
  done
}

collect_diagnostics() {
  local release="$1"
  local namespace="$2"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "[pullpreview helm] kubectl is unavailable; skipping Kubernetes diagnostics."
    return 0
  fi

  echo "[pullpreview helm] Kubernetes resource status:"
  kubectl get pods,jobs,deployments,statefulsets,pvc -n "${namespace}" 2>&1 | redact_stream || true

  if [[ -n "${release}" ]]; then
    echo "[pullpreview helm] Helm release status:"
    "${real_helm}" status "${release}" -n "${namespace}" 2>&1 | redact_stream || true
  fi

  echo "[pullpreview helm] Recent Kubernetes events:"
  kubectl get events -n "${namespace}" --sort-by=.lastTimestamp 2>&1 | tail -n 100 | redact_stream || true

  if kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1; then
    echo "[pullpreview helm] OpenProject source build log tail:"
    kubectl logs job/op-buildsource-job -n "${namespace}" --all-containers=true --tail=160 2>&1 | redact_stream || true
  fi
}

for arg in "$@"; do
  if [[ "${arg}" == "--wait" ]]; then
    has_wait=true
  fi

  if [[ "${arg}" == "--atomic" ]] && [[ "${1:-}" =~ ^(install|upgrade)$ ]]; then
    had_atomic=true
    continue
  fi

  if [[ "${arg}" == "--timeout=15m" ]]; then
    args+=("--timeout=${helm_timeout}")
    continue
  fi

  if [[ "${replace_next_timeout}" == "true" ]]; then
    if [[ "${arg}" == "15m" ]]; then
      args+=("${helm_timeout}")
    else
      args+=("${arg}")
    fi
    replace_next_timeout=false
    continue
  fi

  args+=("${arg}")
  if [[ "${arg}" == "--timeout" ]]; then
    replace_next_timeout=true
  fi
done

if [[ "${had_atomic}" == "true" && "${has_wait}" != "true" ]]; then
  args+=("--wait")
fi

if [[ "${had_atomic}" != "true" ]]; then
  exec "${real_helm}" "${args[@]}"
fi

set +e
"${real_helm}" "${args[@]}"
status=$?
set -e

if [[ "${status}" -ne 0 ]]; then
  namespace="$(flag_value "--namespace" "${args[@]}")"
  if [[ -z "${namespace}" ]]; then
    namespace="$(flag_value "-n" "${args[@]}")"
  fi
  namespace="${namespace:-default}"
  release="$(release_name "${args[@]}")"

  echo "[pullpreview helm] Helm deploy failed; collecting limited diagnostics before cleanup."
  collect_diagnostics "${release}" "${namespace}"

  if [[ -n "${release}" ]]; then
    echo "[pullpreview helm] Cleaning up failed Helm release."
    "${real_helm}" uninstall "${release}" -n "${namespace}" --wait --timeout 10m >/dev/null 2>&1 || true
  fi
fi

exit "${status}"
EOF
  chmod +x "${helm_path}"
fi
echo "[pullpreview pre_script] Done."
