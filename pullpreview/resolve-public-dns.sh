#!/usr/bin/env bash
# Resolve PULLPREVIEW_PUBLIC_DNS from env or rendered PullPreview chart values.
# Safe to source: uses return when sourced, exit only when executed directly.
set -euo pipefail

if [[ -n "${PULLPREVIEW_PUBLIC_DNS:-}" ]]; then
  if [[ "${BASH_SOURCE[0]:-}" != "${0}" ]]; then
    return 0
  fi
  exit 0
fi

values_file="${1:-}"
if [[ -n "${values_file}" && -f "${values_file}" ]]; then
  host=""
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
    if [[ "${BASH_SOURCE[0]:-}" != "${0}" ]]; then
      return 0
    fi
    exit 0
  fi
fi

echo "::error::PULLPREVIEW_PUBLIC_DNS is not set and could not be resolved from chart values."
if [[ "${BASH_SOURCE[0]:-}" != "${0}" ]]; then
  return 1
fi
exit 1
