#!/usr/bin/env bash
# Assert MCP Bob_AI provisioning contract (setup-mcp.rb + setup-job wiring).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CHART="$ROOT/charts/opnc-integration"
SCRIPT="$CHART/scripts/setup-mcp.rb"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

grep -q 'login: "Bob_AI"' "$SCRIPT" || fail "setup-mcp.rb must provision login Bob_AI"
grep -q 'bob.ai@example.net' "$SCRIPT" || fail "setup-mcp.rb must use bob.ai@example.net"
grep -q 'bob_ai_mcp_test_token_1234567890' "$SCRIPT" || fail "setup-mcp.rb default token mismatch"
grep -q 'login: "brian"' "$SCRIPT" && fail "setup-mcp.rb must not create OpenProject login brian" || true
grep -q 'brian@example.net' "$SCRIPT" && fail "setup-mcp.rb must not use brian@example.net" || true
grep -q 'brian_mcp_test_token' "$SCRIPT" && fail "setup-mcp.rb must not use old brian_mcp token" || true
grep -q 'Token::API' "$SCRIPT" && fail "setup-mcp.rb must not provision unused Token::API" || true
grep -q 'Doorkeeper::Application' "$SCRIPT" || fail "setup-mcp.rb must provision a Doorkeeper application for MCP tokens"
grep -q 'application_id' "$SCRIPT" || fail "setup-mcp.rb must set application_id on the OAuth token"
grep -q 'update_column' "$SCRIPT" || fail "setup-mcp.rb must update_column the hashed token (bypass token= hashing)"
grep -E '\.token[[:space:]]*=' "$SCRIPT" && fail "setup-mcp.rb must not assign to token= (Doorkeeper hashes the setter)" || true
pass "setup-mcp.rb Bob_AI contract"

RENDER="$(mktemp)"
trap 'rm -f "$RENDER"' EXIT

helm template mcp-check "$CHART" \
  --set openproject.standalone=false \
  --set setupJob.enabled=true \
  --set setupJob.defer=false \
  --set mcp.enabled=true \
  --set mcp.oauthToken=bob_ai_mcp_test_token_1234567890 \
  --set environment.DATABASE_URL=postgres://op:op@db/op \
  --set environment.DATABASE_HOST=db \
  --set xwiki.enabled=false \
  >"$RENDER"

grep -q 'name: mcp-setup' "$RENDER" || fail "rendered setup-job missing mcp-setup initContainer"
grep -q 'name: MCP_OAUTH_TOKEN' "$RENDER" || fail "rendered mcp-setup missing MCP_OAUTH_TOKEN env"
grep -q 'bob_ai_mcp_test_token_1234567890' "$RENDER" || fail "rendered mcp-setup missing oauth token value"
grep -q 'setup-mcp.rb' "$RENDER" || fail "rendered job missing setup-mcp.rb mount"
pass "helm template wires MCP_OAUTH_TOKEN and mcp-setup"

helm template mcp-check-off "$CHART" \
  --set openproject.standalone=false \
  --set setupJob.enabled=true \
  --set setupJob.defer=false \
  --set mcp.enabled=false \
  --set environment.DATABASE_URL=postgres://op:op@db/op \
  --set environment.DATABASE_HOST=db \
  --set xwiki.enabled=false \
  | grep -q 'name: mcp-setup' && fail "mcp.enabled=false must omit mcp-setup" || true
pass "mcp.enabled=false omits mcp-setup"

helm template mcp-check-standalone "$CHART" \
  --set openproject.standalone=true \
  --set setupJob.enabled=true \
  --set setupJob.defer=false \
  --set mcp.enabled=true \
  --set mcp.oauthToken=bob_ai_mcp_test_token_1234567890 \
  --set environment.DATABASE_URL=postgres://op:op@db/op \
  --set environment.DATABASE_HOST=db \
  --set xwiki.enabled=false \
  >"$RENDER"
grep -q 'name: mcp-setup' "$RENDER" || fail "standalone must still render mcp-setup"
grep -q 'name: setup-integration' "$RENDER" && fail "standalone must omit setup-integration" || true
grep -q 'name: setup-complete' "$RENDER" || fail "standalone must render setup-complete main container"
pass "standalone keeps mcp-setup, skips integration"

echo "[PASS] MCP Bob_AI setup check"
