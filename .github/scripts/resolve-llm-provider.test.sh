#!/usr/bin/env bash
# Assert resolve-llm-provider.sh presets and overrides.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/resolve-llm-provider.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

assert_output() {
  local label="$1"
  local provider="$2"
  shift 2
  local -a env_vars=()
  local -a expected=()
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      expected=("$@")
      break
    fi
    env_vars+=("$1")
    shift
  done
  local out
  out="$(env -i PATH="${PATH}" "${env_vars[@]}" "${SCRIPT}" "${provider}")"
  local line
  for line in "${expected[@]}"; do
    echo "${out}" | grep -qxF "${line}" || fail "${label}: missing ${line} (got: ${out})"
  done
  pass "${label}"
}

assert_fails() {
  local label="$1"
  local provider="$2"
  shift 2
  if env -i PATH="${PATH}" "$@" "${SCRIPT}" "${provider}" >/dev/null 2>&1; then
    fail "${label}: expected non-zero exit"
  fi
  pass "${label}"
}

assert_output "llm-stack defaults" llm-stack \
  LLM_STACK_API_KEY=stack-key \
  -- \
  "llm_provider=llm-stack" \
  "llm_api_key=stack-key" \
  "llm_base_url=https://llm-stack.openproject-edge.eu/v1" \
  "llm_model=Llama-3.3-70b-instruct"

assert_output "llm-stack provider-default" llm-stack \
  LLM_STACK_API_KEY=stack-key \
  LLM_MODEL=provider-default \
  -- \
  "llm_model=Llama-3.3-70b-instruct"

assert_output "llm-stack LLM_API_KEY wins" llm-stack \
  LLM_API_KEY=generic-key \
  LLM_STACK_API_KEY=stack-key \
  -- \
  "llm_api_key=generic-key"

assert_output "llm-stack URL override via LLM_STACK_URL" llm-stack \
  LLM_STACK_API_KEY=k \
  LLM_STACK_URL=https://custom-stack.example/v1 \
  -- \
  "llm_base_url=https://custom-stack.example/v1"

assert_output "llm-stack remaps OpenRouter llama id" llm-stack \
  LLM_STACK_API_KEY=k \
  LLM_MODEL=meta-llama/llama-3.3-70b-instruct \
  -- \
  "llm_model=Llama-3.3-70b-instruct"

assert_fails "llm-stack rejects non-llama" llm-stack \
  LLM_STACK_API_KEY=k \
  LLM_MODEL=openai/gpt-4o-mini

assert_output "openrouter defaults" openrouter \
  OPENROUTER_API_KEY=or-key \
  -- \
  "llm_provider=openrouter" \
  "llm_api_key=or-key" \
  "llm_base_url=https://openrouter.ai/api/v1" \
  "llm_model=meta-llama/llama-3.3-70b-instruct"

assert_output "openrouter provider-default" openrouter \
  OPENROUTER_API_KEY=or-key \
  LLM_MODEL=provider-default \
  -- \
  "llm_model=meta-llama/llama-3.3-70b-instruct"

assert_output "openrouter model override" openrouter \
  OPENROUTER_API_KEY=or-key \
  LLM_MODEL=openai/gpt-4o-mini \
  -- \
  "llm_model=openai/gpt-4o-mini"

assert_output "openrouter remaps legacy llama id" openrouter \
  OPENROUTER_API_KEY=or-key \
  LLM_MODEL=Llama-3.3-70b-instruct \
  -- \
  "llm_model=meta-llama/llama-3.3-70b-instruct"

assert_fails "bogus provider" bogus

export_out="$(env -i PATH="${PATH}" OPENROUTER_API_KEY=or-key "${SCRIPT}" --export openrouter)"
echo "${export_out}" | grep -qxF "export LLM_PROVIDER=openrouter" || fail "export missing LLM_PROVIDER"
echo "${export_out}" | grep -qxF "export LLM_API_KEY=or-key" || fail "export missing LLM_API_KEY"
echo "${export_out}" | grep -qxF "export LLM_BASE_URL=https://openrouter.ai/api/v1" || fail "export missing LLM_BASE_URL"
echo "${export_out}" | grep -qxF "export LLM_MODEL=meta-llama/llama-3.3-70b-instruct" || fail "export missing LLM_MODEL"
pass "--export openrouter"

echo "[PASS] resolve-llm-provider"
