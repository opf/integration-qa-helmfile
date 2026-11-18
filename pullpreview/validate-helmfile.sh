#!/usr/bin/env bash
# Validate PullPreview helmfile: state build + values/chart render for critical releases.
set -euo pipefail

cd "$(dirname "$0")/.."

export PULLPREVIEW_NAMESPACE="${PULLPREVIEW_NAMESPACE:-opnc-integration}"
export PULLPREVIEW_PUBLIC_DNS="${PULLPREVIEW_PUBLIC_DNS:-preview.example.com}"
# Never use a real token from the environment; build would print rendered values.
unset OPENPROJECT_ENTERPRISE_TOKEN
export OPENPROJECT_ENTERPRISE_TOKEN="validate-only-dummy"
export PULLPREVIEW_ADMIN_PASSWORD="${PULLPREVIEW_ADMIN_PASSWORD:-validate-only-admin01}"
export PULLPREVIEW_USER_PASSWORD="${PULLPREVIEW_USER_PASSWORD:-validate-only-user01}"
export PULLPREVIEW_MCP_TOKEN="${PULLPREVIEW_MCP_TOKEN:-validate-only-mcp-token}"
export PULLPREVIEW_OP_DB_PASSWORD="${PULLPREVIEW_OP_DB_PASSWORD:-validate-only-op-db}"
export PULLPREVIEW_NC_DB_PASSWORD="${PULLPREVIEW_NC_DB_PASSWORD:-validate-only-nc-db}"
export PULLPREVIEW_GITLAB_DB_PASSWORD="${PULLPREVIEW_GITLAB_DB_PASSWORD:-validate-only-gl-db}"
export PULLPREVIEW_GITLAB_REDIS_PASSWORD="${PULLPREVIEW_GITLAB_REDIS_PASSWORD:-validate-only-gl-redis}"
export PULLPREVIEW_NC_OIDC_SECRET="${PULLPREVIEW_NC_OIDC_SECRET:-validate-only-nc-oidc}"
export PULLPREVIEW_OP_NC_OIDC_SECRET="${PULLPREVIEW_OP_NC_OIDC_SECRET:-validate-only-opnc-oidc}"
export PULLPREVIEW_OP_KC_OIDC_SECRET="${PULLPREVIEW_OP_KC_OIDC_SECRET:-validate-only-opkc-oidc}"
export PULLPREVIEW_XWIKI_OAUTH_SECRET="${PULLPREVIEW_XWIKI_OAUTH_SECRET:-validate-only-xwiki}"
export PULLPREVIEW_XWIKI_DB_PASSWORD="${PULLPREVIEW_XWIKI_DB_PASSWORD:-validate-only-xwiki-db}"
export PULLPREVIEW_KC_DB_PASSWORD="${PULLPREVIEW_KC_DB_PASSWORD:-validate-only-kc-db}"

helmfile_path="pullpreview/helmfile.yaml.gotmpl"
helmfile_common=(helmfile -f "${helmfile_path}" -e pullpreview)

echo "[validate-pullpreview] helmfile build"
"${helmfile_common[@]}" build >/dev/null

echo "[validate-pullpreview] ensuring chart repos (for template render)"
helm repo add --force-update nextcloud https://nextcloud.github.io/helm >/dev/null 2>&1 || true
helm repo add --force-update bitnami https://charts.bitnami.com/bitnami >/dev/null 2>&1 || true
helm repo add --force-update traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo add --force-update xwiki-helm https://xwiki-contrib.github.io/xwiki-helm >/dev/null 2>&1 || true
helm repo add --force-update gitlab https://charts.gitlab.io >/dev/null 2>&1 || true
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

if [[ -d charts/gitlab/charts ]]; then
  echo "[validate-pullpreview] helmfile template release=gitlab"
  GITLAB_ENABLED=true "${helmfile_common[@]}" -l "name=gitlab" template --skip-deps >/dev/null
else
  echo "[validate-pullpreview] skip gitlab template (run: helm dependency build charts/gitlab)"
fi

echo "[validate-pullpreview] helmfile template release=squashtm"
SQUASHTM_ENABLED=true SQUASHTM_ADMIN_PASSWORD='validate-only-dummy' \
  "${helmfile_common[@]}" -l "name=squashtm" template --skip-deps >/dev/null

echo "[validate-pullpreview] guard: no Bitnami images / shared login defaults in render"
render="$("${helmfile_common[@]}" template --skip-deps 2>/dev/null || true)"
if printf '%s\n' "${render}" | grep -E 'bitnamilegacy/|image:.*bitnami/' >/dev/null; then
  echo "[validate-pullpreview] FAIL: Bitnami image still present in rendered manifests" >&2
  printf '%s\n' "${render}" | grep -E 'bitnamilegacy/|image:.*bitnami/' >&2 || true
  exit 1
fi
# Shared defaults must not appear as live credential values on PullPreview
# (usernames may still be "admin"; passwords / tokens / OIDC secrets must not).
bad_cred_re='admin-password: "admin"|password: "admin"|db-password: "admin"|value: "1234"|bob_ai_mcp_test_token|nextcloud-secret|openproject-secret|xwiki-client-secret|r00t#dev'
if printf '%s\n' "${render}" | grep -E "${bad_cred_re}" >/dev/null; then
  echo "[validate-pullpreview] FAIL: shared default credential still rendered for PullPreview" >&2
  printf '%s\n' "${render}" | grep -E "${bad_cred_re}" >&2 || true
  exit 1
fi
if ! printf '%s\n' "${render}" | grep -F 'validate-only-admin01' >/dev/null; then
  echo "[validate-pullpreview] FAIL: expected PULLPREVIEW_ADMIN_PASSWORD to render" >&2
  exit 1
fi

echo "[validate-pullpreview] OK"
