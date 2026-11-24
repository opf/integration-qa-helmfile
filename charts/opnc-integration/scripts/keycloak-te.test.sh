#!/usr/bin/env bash
# Fixture-driven checks for inject_standard_token_exchange_attrs (keycloak.sh).
# Keep the inject_* body in sync with charts/opnc-integration/scripts/keycloak.sh.
set -euo pipefail

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

# Mirror of keycloak.sh inject_standard_token_exchange_attrs (POSIX case/sed).
inject_standard_token_exchange_attrs() {
  body="$1"
  case "${body}" in
    *"\"standard.token.exchange.enabled\""*)
      printf '%s' "${body}"
      return 0
      ;;
  esac
  case "${body}" in
    *"\"attributes\":{}"*)
      printf '%s' "${body}" | sed \
        's/"attributes":{}/"attributes":{"standard.token.exchange.enabled":"true","standard.token.exchange.enableRefreshRequestedTokenType":"SAME_SESSION"}/'
      ;;
    *)
      printf '%s' "${body}" | sed \
        's/"attributes":{/"attributes":{"standard.token.exchange.enabled":"true","standard.token.exchange.enableRefreshRequestedTokenType":"SAME_SESSION",/'
      ;;
  esac
}

assert_json() {
  local label="$1"
  local json="$2"
  python3 -c 'import json,sys; json.loads(sys.argv[1])' "${json}" \
    || fail "${label}: invalid JSON: ${json}"
}

empty_attrs='{"id":"abc","clientId":"nextcloud","attributes":{}}'
got="$(inject_standard_token_exchange_attrs "${empty_attrs}")"
assert_json "empty attributes" "${got}"
printf '%s' "${got}" | grep -q 'standard.token.exchange.enabled' \
  || fail "empty attributes: TE key missing"
pass "empty attributes:{}"

populated='{"id":"abc","attributes":{"oauth2.device.authorization.grant.enabled":"true"}}'
got="$(inject_standard_token_exchange_attrs "${populated}")"
assert_json "populated attributes" "${got}"
printf '%s' "${got}" | grep -q 'oauth2.device.authorization.grant.enabled' \
  || fail "populated attributes: preserved device grant"
pass "populated attributes"

already='{"id":"abc","attributes":{"standard.token.exchange.enabled":"true"}}'
got="$(inject_standard_token_exchange_attrs "${already}")"
[[ "${got}" == "${already}" ]] || fail "already-set TE should be a no-op"
pass "already has TE attrs"

echo "[PASS] keycloak-te"
