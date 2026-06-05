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

_resolve_deploy_inputs() {
  if [[ -z "${values_file}" || ! -f "${values_file}" ]]; then
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[pullpreview] Warning: python3 unavailable; helmfile may use default image tags/branches"
    return 0
  fi

  local resolved=""
  set +e
  resolved="$(
    python3 - "${values_file}" <<'PY'
import sys

try:
    import yaml
except ImportError:
    raise SystemExit(2)

with open(sys.argv[1], encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}

opnc = data.get("opnc-integration", {}) or {}
op = data.get("openproject", {}) or {}
nc = data.get("nextcloud", {}) or {}
kc = data.get("keycloak", {}) or {}
xw = data.get("xwiki", {}) or {}

values = {}

setup_method = opnc.get("integrationSetupMethod")
if setup_method:
    values["INTEGRATION_SETUP_METHOD"] = str(setup_method)

op_version = (op.get("image") or {}).get("tag") or (opnc.get("openproject") or {}).get("dockerTag")
if op_version:
    values["OPENPROJECT_VERSION"] = str(op_version)

op_branch = (opnc.get("openproject") or {}).get("gitSourceBranch")
if op_branch:
    values["OPENPROJECT_BRANCH"] = str(op_branch)

nc_version = (nc.get("image") or {}).get("tag")
if nc_version:
    values["NEXTCLOUD_VERSION"] = str(nc_version)

nc_branch = (opnc.get("nextcloud") or {}).get("gitSourceBranch")
if not nc_branch:
    for env_var in (nc.get("nextcloud") or {}).get("extraEnv") or []:
        if env_var.get("name") == "NC_GIT_SOURCE_BRANCH" and env_var.get("value"):
            nc_branch = env_var["value"]
            break
if nc_branch:
    values["NEXTCLOUD_BRANCH"] = str(nc_branch)

kc_version = (kc.get("image") or {}).get("tag")
if kc_version:
    values["KEYCLOAK_VERSION"] = str(kc_version)

for app in (opnc.get("nextcloud") or {}).get("enableApps") or []:
    if app.get("name") != "integration_openproject":
        continue
    if app.get("version"):
        values["INTEGRATION_OPENPROJECT_VERSION"] = str(app["version"])
    if app.get("gitBranch"):
        values["INTEGRATION_OPENPROJECT_GIT_BRANCH"] = str(app["gitBranch"])
    break

xwiki_version = (xw.get("image") or {}).get("tag")
if xwiki_version:
    values["XWIKI_VERSION"] = str(xwiki_version)

for env_var in xw.get("extraEnvVars") or []:
    if env_var.get("name") == "EXTENSION_OPENPROJECT_VERSION" and env_var.get("value"):
        values["XWIKI_EXTENSION_OPENPROJECT_VERSION"] = str(env_var["value"])
        break

for key, value in values.items():
    print(f"{key}={value}")
PY
  )"
  local py_status=$?
  set -e

  if [[ "${py_status}" -eq 2 ]]; then
    echo "[pullpreview] Warning: PyYAML unavailable; helmfile may use default image tags/branches"
    return 0
  fi
  if [[ "${py_status}" -ne 0 ]]; then
    echo "[pullpreview] Warning: could not parse deploy inputs from values file (${py_status})"
    return 0
  fi

  local line key value exported=0
  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    if [[ -z "${!key:-}" ]]; then
      export "${key}=${value}"
      exported=$((exported + 1))
    fi
  done <<< "${resolved}"

  if [[ "${exported}" -gt 0 ]]; then
    echo "[pullpreview] Resolved ${exported} deploy input(s) from rendered values file"
  fi
}

if ! _resolve_public_dns; then
  echo "::error::PULLPREVIEW_PUBLIC_DNS is not set and could not be resolved from chart values."
  _resolve_env_finish 1
fi

if ! _resolve_enterprise_token; then
  echo "::error::OPENPROJECT_ENTERPRISE_TOKEN is not set and could not be resolved from rendered chart values."
  _resolve_env_finish 1
fi

_resolve_deploy_inputs

_resolve_env_finish 0
