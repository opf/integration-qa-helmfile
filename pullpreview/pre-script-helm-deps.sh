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

for arg in "$@"; do
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

exec "${real_helm}" "${args[@]}"
EOF
  chmod +x "${helm_path}"
fi
echo "[pullpreview pre_script] Done."
