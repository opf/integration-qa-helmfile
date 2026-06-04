#!/usr/bin/env bash
# Validate PullPreview helmfile: state build + values/chart render for critical releases.
set -euo pipefail

cd "$(dirname "$0")/.."

export PULLPREVIEW_NAMESPACE="${PULLPREVIEW_NAMESPACE:-opnc-integration}"
export PULLPREVIEW_PUBLIC_DNS="${PULLPREVIEW_PUBLIC_DNS:-preview.example.com}"
# Never use a real token from the environment; build would print rendered values.
unset OPENPROJECT_ENTERPRISE_TOKEN
export OPENPROJECT_ENTERPRISE_TOKEN="validate-only-dummy"

helmfile_path="pullpreview/helmfile.yaml.gotmpl"
helmfile_common=(helmfile -f "${helmfile_path}" -e pullpreview)

echo "[validate-pullpreview] helmfile build"
"${helmfile_common[@]}" build >/dev/null

echo "[validate-pullpreview] ensuring chart repos (for template render)"
helm repo add --force-update nextcloud https://nextcloud.github.io/helm >/dev/null 2>&1 || true
helm repo add --force-update bitnami https://charts.bitnami.com/bitnami >/dev/null 2>&1 || true
helm repo add --force-update traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo add --force-update xwiki-helm https://xwiki-contrib.github.io/xwiki-helm >/dev/null 2>&1 || true
helm repo update >/dev/null 2>&1 || true

critical_releases=(opnc-integration openproject keycloak nextcloud-pvc nextcloud opnc-setup-job)
for release in "${critical_releases[@]}"; do
  echo "[validate-pullpreview] helmfile template release=${release}"
  "${helmfile_common[@]}" -l "name=${release}" template --skip-deps >/dev/null
done

echo "[validate-pullpreview] helm template opnc-nextcloud-pvc chart (git-source PVC)"
helm template validate-nc-pvc charts/opnc-nextcloud-pvc \
  --set persistence.storageClassName=local-path \
  --set 'persistence.accessModes={ReadWriteOnce}' \
  --set persistence.size=8Gi >/dev/null

if command -v kustomize >/dev/null 2>&1; then
  echo "[validate-pullpreview] helmfile template release=xwiki (requires kustomize)"
  "${helmfile_common[@]}" -l "name=xwiki" template --skip-deps >/dev/null
else
  echo "[validate-pullpreview] skip xwiki template (install kustomize for strategicMergePatches)"
fi

echo "[validate-pullpreview] OK"
