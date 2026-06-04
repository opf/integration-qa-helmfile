#!/usr/bin/env bash
# Print preview host (no scheme/path/port) from PREVIEW_URL on stdout.
set -euo pipefail

preview_url="${PREVIEW_URL:?PREVIEW_URL is required}"
preview_host="${preview_url#https://}"
preview_host="${preview_host#http://}"
preview_host="${preview_host%%/*}"
preview_host="${preview_host%%:*}"
printf '%s\n' "${preview_host}"
