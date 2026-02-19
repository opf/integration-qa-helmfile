#!/usr/bin/env bash
# Run Playwright E2E tests in Docker.
# Usage: ./run-tests.sh [--build] [--no-open-report] [playwright args...]
# E2E_ENV=edge|stage|local (default: local). Report opens on host after run; use --no-open-report to skip.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

get_playwright_version() {
  if [ -f package-lock.json ]; then
    sed -n '/"node_modules\/@playwright\/test"/,/}/p' package-lock.json \
      | grep '"version"' \
      | head -1 \
      | sed 's/.*"version": "\([^"]*\)".*/\1/'
  fi
}
PW_VERSION="$(get_playwright_version)"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-v${PW_VERSION:-1.58.2}}"
export PLAYWRIGHT_VERSION

echo "E2E_ENV=${E2E_ENV:-local} | image=${PLAYWRIGHT_VERSION} | platform=$(uname -s)/$(uname -m)"

PLAYWRIGHT_ARGS=()
BUILD_FLAG=""
OPEN_REPORT=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD_FLAG="--build" ;;
    --no-open-report) OPEN_REPORT="" ;;
    *) PLAYWRIGHT_ARGS+=("$arg") ;;
  esac
done

mkdir -p test-results playwright-report

EXTRA_MOUNTS=()
if [ -f opnc-root-ca.crt ]; then
  EXTRA_MOUNTS+=(--volume "$(pwd)/opnc-root-ca.crt:/app/opnc-root-ca.crt:ro")
  export NODE_EXTRA_CA_CERTS=/app/opnc-root-ca.crt
fi

run_cmd=(docker compose run --rm $BUILD_FLAG e2e)
if [ ${#EXTRA_MOUNTS[@]} -gt 0 ]; then
  run_cmd=(docker compose run --rm "${EXTRA_MOUNTS[@]}" $BUILD_FLAG e2e)
fi
[ ${#PLAYWRIGHT_ARGS[@]} -gt 0 ] && run_cmd+=("${PLAYWRIGHT_ARGS[@]}")
"${run_cmd[@]}"
exitcode=$?
if [ -n "${OPEN_REPORT:-}" ]; then
  latest_report="$(ls -td playwright-report/run-*/report/index.html 2>/dev/null | head -1)"
  if [ -n "$latest_report" ]; then
    echo "Opening report: $latest_report"
    if [ "$(uname -s)" = "Darwin" ]; then
      open "$latest_report"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$latest_report"
    else
      echo "Report saved at $latest_report"
    fi
  fi
fi
exit $exitcode
