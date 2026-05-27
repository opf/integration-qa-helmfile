#!/usr/bin/env bash
set -euo pipefail

export PULLPREVIEW_HELM_TIMEOUT=45m
source pullpreview/pre-script-helm-deps.sh
