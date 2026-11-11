#!/usr/bin/env bash
# Assert in-cluster API gate + identity URL rewrite helpers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=setup-integration.sh
source "${ROOT}/setup-integration.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

should_use_incluster_api "http://nextcloud/status.php" || fail "http wait URL should enable in-cluster API"
if should_use_incluster_api "https://nextcloud.example/status.php"; then
  fail "https wait URL should not enable in-cluster API"
fi
if should_use_incluster_api ""; then
  fail "empty wait URL should not enable in-cluster API"
fi
pass "should_use_incluster_api gate"

tmp="$(mktemp)"
trap 'rm -f "${tmp}" "${tmp}.bak"' EXIT

cat >"${tmp}" <<'EOF'
  "redirectUri": "$OP_HOST/*",
      "href": "${NC_HOST}"
    "openproject_instance_url": "$OP_HOST",
      "href":"${NEXTCLOUD_HOST}"
    "openproject_instance_url":"${OPENPROJECT_HOST}",
      "href": "urn:openproject-org:api:v3:storages:Nextcloud"
EOF

USE_INCLUSTER_API=false
NC_PUBLIC='https://nc.example'
OP_PUBLIC='https://op.example'
patch_integration_script_public_identity "${tmp}"
grep -q '\$OP_HOST' "${tmp}" || fail "rewrite must no-op when USE_INCLUSTER_API=false"
pass "identity rewrite no-op when disabled"

USE_INCLUSTER_API=true
patch_integration_script_public_identity "${tmp}"
grep -Fq '"redirectUri": "https://op.example/*"' "${tmp}" || fail "oidc redirectUri not rewritten"
grep -Fq '"href": "https://nc.example"' "${tmp}" || fail "oidc storage href not rewritten"
grep -Fq '"openproject_instance_url": "https://op.example"' "${tmp}" || fail "oidc openproject_instance_url not rewritten"
grep -Fq '"href":"https://nc.example"' "${tmp}" || fail "oauth2 storage href not rewritten"
grep -Fq '"openproject_instance_url":"https://op.example"' "${tmp}" || fail "oauth2 openproject_instance_url not rewritten"
grep -Fq '"href": "urn:openproject-org:api:v3:storages:Nextcloud"' "${tmp}" || fail "non-identity href was rewritten"
pass "identity rewrite to public HTTPS"

echo "[PASS] setup-integration in-cluster helpers"
