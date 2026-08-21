#!/usr/bin/env bash
# Shared diagnostics helper for PullPreview scripts.
# Source this file; it exports redact_stream and collect_diagnostics.
# Safe to source multiple times (guarded by PULLPREVIEW_DIAGNOSTICS_LOADED).
[[ -n "${PULLPREVIEW_DIAGNOSTICS_LOADED:-}" ]] && return 0
PULLPREVIEW_DIAGNOSTICS_LOADED=1

redact_stream() {
  sed -E \
    -e 's#postgres(ql)?://[^[:space:]"'\''<>]+#postgresql://[REDACTED]#g' \
    -e 's#(Authorization: Bearer )[A-Za-z0-9._~+/-]+#\1[REDACTED]#Ig' \
    -e 's#((password|token|secret|cookie)[A-Za-z0-9_ -]*(=|:))[[:space:]]*[^[:space:]"'\''<>]+#\1 [REDACTED]#Ig'
}

# collect_diagnostics CONTEXT NAMESPACE [RELEASE]
#
# Emits a GitHub Actions ::group:: block with: pod/job/deployment/PVC listing,
# recent events, op-buildsource-job log tail, setup-job log tail + describe,
# Nextcloud log tail, and XWiki log tail.  All output is piped through
# redact_stream to avoid leaking secrets in CI logs.
#
# CONTEXT  - free-text label shown in the group header
# NAMESPACE - Kubernetes namespace to inspect
# RELEASE   - (optional) Helm release name; if provided, `helm status` is printed
collect_diagnostics() {
  local context="${1:?context required}"
  local namespace="${2:?namespace required}"
  local release="${3:-}"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "[pullpreview] kubectl unavailable; skipping diagnostics."
    return 0
  fi

  echo "::group::Diagnostics: ${context}"

  kubectl get pods,jobs,deployments,statefulsets,pvc -n "${namespace}" 2>&1 | redact_stream || true

  if [[ -n "${release}" ]] && command -v helm >/dev/null 2>&1; then
    echo "[pullpreview] Helm release status:"
    helm status "${release}" -n "${namespace}" 2>&1 | redact_stream || true
  fi

  echo "[pullpreview] Recent Kubernetes events:"
  kubectl get events -n "${namespace}" --sort-by=.lastTimestamp 2>&1 \
    | tail -n 100 | redact_stream || true

  if kubectl get job op-buildsource-job -n "${namespace}" >/dev/null 2>&1; then
    echo "[pullpreview] op-buildsource-job log tail:"
    kubectl logs -n "${namespace}" -l job-name=op-buildsource-job \
      --all-containers=true --tail=160 2>&1 | redact_stream || true
  fi

  if kubectl get job setup-job -n "${namespace}" >/dev/null 2>&1; then
    echo "[pullpreview] setup-job log tail:"
    kubectl logs -n "${namespace}" -l job-name=setup-job \
      --all-containers=true --tail=200 2>&1 | redact_stream || true
    kubectl describe job setup-job -n "${namespace}" 2>&1 | redact_stream || true
  fi

  local nc_pod=""
  nc_pod="$(kubectl get pods -n "${namespace}" -l "app.kubernetes.io/name=nextcloud" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${nc_pod}" ]]; then
    echo "[pullpreview] Nextcloud presetup init container log tail (${nc_pod}):"
    kubectl logs "${nc_pod}" -n "${namespace}" -c presetup --tail=120 2>&1 | redact_stream || true
    echo "[pullpreview] Nextcloud main container log tail (${nc_pod}):"
    kubectl logs "${nc_pod}" -n "${namespace}" -c nextcloud --tail=160 2>&1 | redact_stream || true
    echo "[pullpreview] Nextcloud main container previous log tail (${nc_pod}):"
    kubectl logs "${nc_pod}" -n "${namespace}" -c nextcloud --previous --tail=160 2>&1 | redact_stream || true
  fi

  local xwiki_pod=""
  xwiki_pod="$(kubectl get pods -n "${namespace}" -l "app.kubernetes.io/name=xwiki" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${xwiki_pod}" ]]; then
    echo "[pullpreview] XWiki pod log tail (${xwiki_pod}):"
    kubectl logs "${xwiki_pod}" -n "${namespace}" -c xwiki --tail=200 2>&1 | redact_stream || true
    echo "[pullpreview] XWiki pod previous log tail (${xwiki_pod}):"
    kubectl logs "${xwiki_pod}" -n "${namespace}" -c xwiki --previous --tail=200 2>&1 | redact_stream || true
  fi

  local caddy_pod=""
  caddy_pod="$(kubectl get pods -n "${namespace}" -l "app.kubernetes.io/name=pullpreview-caddy" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "${caddy_pod}" ]]; then
    caddy_pod="$(kubectl get pods -n "${namespace}" -l "app=pullpreview-caddy" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  fi
  if [[ -n "${caddy_pod}" ]]; then
    echo "[pullpreview] Caddy pod log tail (${caddy_pod}):"
    kubectl logs "${caddy_pod}" -n "${namespace}" --tail=200 2>&1 | redact_stream || true
  fi

  echo "::endgroup::"
}
