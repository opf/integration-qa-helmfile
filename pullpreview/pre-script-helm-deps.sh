#!/usr/bin/env bash
set -euo pipefail

echo "[pullpreview pre_script] Building Helm dependencies on the instance..."
cd /app
helm dependency build charts/pullpreview-stack
echo "[pullpreview pre_script] Done."

