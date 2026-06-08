#!/usr/bin/env bash
# Backward-compatible entry point; resolves DNS and enterprise token for helmfile.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/resolve-pullpreview-env.sh" "${1:-}"
