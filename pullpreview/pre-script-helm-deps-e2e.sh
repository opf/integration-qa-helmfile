#!/usr/bin/env bash
set -euo pipefail

export PULLPREVIEW_HELM_TIMEOUT=75m

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  _pre_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [[ -f /app/pullpreview/pre-script-helm-deps.sh ]]; then
  _pre_script_dir="/app/pullpreview"
elif [[ -f pullpreview/pre-script-helm-deps.sh ]]; then
  _pre_script_dir="pullpreview"
else
  echo "::error::Cannot locate pre-script-helm-deps.sh (cwd=$(pwd))"
  exit 1
fi

source "${_pre_script_dir}/pre-script-helm-deps.sh"
