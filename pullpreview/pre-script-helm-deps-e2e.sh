#!/usr/bin/env bash
set -euo pipefail

export PULLPREVIEW_HELM_TIMEOUT=75m
source "$(dirname "${BASH_SOURCE[0]}")/pre-script-helm-deps.sh"
