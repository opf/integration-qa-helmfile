#!/usr/bin/env bash
set -euo pipefail

echo "[pullpreview pre_script] Building Helm dependencies on the instance..."
cd /app
echo "[pullpreview pre_script] Ensuring Helm repos are configured..."

helm repo add --force-update nextcloud https://nextcloud.github.io/helm
helm repo add --force-update bitnami https://charts.bitnami.com/bitnami
helm repo add --force-update traefik https://traefik.github.io/charts

helm repo update

helm dependency build charts/pullpreview-stack
echo "[pullpreview pre_script] Done."

