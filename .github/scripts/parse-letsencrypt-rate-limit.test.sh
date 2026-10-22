#!/usr/bin/env bash
# Self-check for parse-letsencrypt-rate-limit.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/parse-letsencrypt-rate-limit.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

fixture="$(
  cat <<'EOF'
{"level":"error","msg":"could not get certificate from issuer","error":"HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates (50) already issued for \"opf.run\" in the last 168h0m0s, retry after 2026-10-22 13:03:38 UTC: see https://letsencrypt.org/docs/rate-limits/#new-certificates-per-registered-domain"}
{"level":"error","msg":"could not get certificate from issuer","error":"HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates (50) already issued for \"opf.run\" in the last 168h0m0s, retry after 2026-10-22 13:05:27 UTC: see https://letsencrypt.org/docs/rate-limits/#new-certificates-per-registered-domain"}
{"level":"error","msg":"could not get certificate from issuer","error":"HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates (50) already issued for \"opf.run\" in the last 168h0m0s, retry after 2026-10-22 13:05:21 UTC: see https://letsencrypt.org/docs/rate-limits/#new-certificates-per-registered-domain"}
EOF
)"

out="$(printf '%s\n' "${fixture}" | bash "${SCRIPT}")" || fail "expected exit 0 for rateLimited fixture"
[[ "${out}" == "LetsEncrypt limit hit, reset 22.10.26 at 15:05:27 CEST" ]] \
  || fail "unexpected output: ${out}"
pass "picks max retry-after and formats Europe/Berlin"

if printf '%s\n' 'no rate limit here' | bash "${SCRIPT}"; then
  fail "expected exit 1 when no rateLimited"
fi
pass "exit 1 when absent"

echo "[PASS] parse-letsencrypt-rate-limit"
