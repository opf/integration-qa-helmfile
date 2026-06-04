#!/usr/bin/env bash
# Resolve PullPreview env vars needed by helmfile on the preview VM.
# Safe to source: uses return when sourced, exit only when executed directly.
set -euo pipefail

_resolve_env_finish() {
  local code="${1:?}"
  if [[ "${BASH_SOURCE[0]:-}" != "${0}" ]]; then
    return "${code}"
  fi
  exit "${code}"
}

values_file="${1:-}"

_resolve_public_dns() {
  if [[ -n "${PULLPREVIEW_PUBLIC_DNS:-}" ]]; then
    return 0
  fi

  if [[ -z "${values_file}" || ! -f "${values_file}" ]]; then
    return 1
  fi

  local host=""
  if command -v python3 >/dev/null 2>&1; then
    set +e
    host="$(
      python3 - "${values_file}" <<'PY'
import sys

try:
    import yaml
except ImportError:
    raise SystemExit(2)

with open(sys.argv[1], encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}

host = (
    data.get("openproject", {}).get("openproject", {}).get("host")
    or data.get("openproject", {}).get("host")
)
if not host:
    raise SystemExit("openproject host not found in values file")
print(host)
PY
    )"
    py_status=$?
    set -e
    if [[ "${py_status}" -eq 2 ]]; then
      host=""
    elif [[ "${py_status}" -ne 0 ]]; then
      echo "[pullpreview] Warning: could not parse values file with python3 (${py_status})"
      host=""
    fi
  fi

  if [[ -z "${host}" ]]; then
    host="$(
      awk '
        /^openproject:/ { in_op=1; next }
        in_op && /^  openproject:/ { in_nested=1; next }
        in_nested && /host:/ {
          gsub(/["'\'']/, "", $2)
          print $2
          exit
        }
        in_op && /^[^ ]/ && !/^  / { exit }
      ' "${values_file}"
    )"
  fi

  if [[ -n "${host}" ]]; then
    export PULLPREVIEW_PUBLIC_DNS="${host}"
    echo "[pullpreview] Resolved public DNS from values file: ${PULLPREVIEW_PUBLIC_DNS}"
    return 0
  fi
  return 1
}

_resolve_enterprise_token() {
  if [[ -n "${OPENPROJECT_ENTERPRISE_TOKEN:-}" ]]; then
    return 0
  fi

  if [[ -z "${values_file}" || ! -f "${values_file}" ]]; then
    return 1
  fi

  local token=""
  if command -v python3 >/dev/null 2>&1; then
    set +e
    token="$(
      python3 - "${values_file}" <<'PY'
import sys

try:
    import yaml
except ImportError:
    raise SystemExit(2)

with open(sys.argv[1], encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}

op = data.get("openproject", {}) or {}
env = op.get("environment", {}) or op.get("openproject", {}).get("environment", {}) or {}
token = env.get("OPENPROJECT_SEED__ENTERPRISE__TOKEN")
if token is None:
    token = op.get("openproject", {}).get("environment", {}).get("OPENPROJECT_SEED__ENTERPRISE__TOKEN")
if not token or not str(token).strip():
    raise SystemExit("enterprise token not found in values file")
print(str(token).strip("\n"))
PY
    )"
    py_status=$?
    set -e
    if [[ "${py_status}" -ne 0 ]]; then
      token=""
    fi
  fi

  if [[ -n "${token}" ]]; then
    export OPENPROJECT_ENTERPRISE_TOKEN="${token}"
    echo "[pullpreview] Resolved OPENPROJECT_ENTERPRISE_TOKEN from rendered values file"
    return 0
  fi
  return 1
}

if ! _resolve_public_dns; then
  echo "::error::PULLPREVIEW_PUBLIC_DNS is not set and could not be resolved from chart values."
  _resolve_env_finish 1
fi

if ! _resolve_enterprise_token; then
  echo "::error::OPENPROJECT_ENTERPRISE_TOKEN is not set and could not be resolved from rendered chart values."
  _resolve_env_finish 1
fi

_resolve_env_finish 0
